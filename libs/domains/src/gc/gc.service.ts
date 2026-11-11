import { Injectable, Logger } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'
import { coreSchema, DbProvider, MultipartUploadStatus } from '@storage/database'
import { CronJob } from 'cron'
import { and, eq, isNotNull, lt } from 'drizzle-orm'

import { ObjectsService } from '../objects/objects.service'
import { StorageService } from '../storage/storage.service'
import { GcTypes } from './gc.types'

const HOUR_MS = 60 * 60 * 1000

/** Reclaims what the write paths deliberately leave behind.
 *
 *  Metadata is always committed before its blob is deleted - a leftover blob is garbage, a
 *  missing one would be data loss - so the store accumulates blobs no row points at: a version
 *  replaced in an unversioned bucket, a part whose upload failed, a delete that raced a crash.
 *  The same goes for multipart uploads a client started and never finished or aborted.
 *
 *  The sweep is deliberately one-directional: it only removes what the database does not claim,
 *  and never writes a row to match a file it found. A blob without a row is garbage; a row
 *  without a blob is a fault to be investigated, not to be papered over here. */
@Injectable()
export class GcService {
	private static readonly JOB_NAME = 'storage-gc'

	private logger = new Logger(GcService.name)
	private running = false

	constructor(
		private readonly config: GcTypes.Config,
		private readonly db: DbProvider,
		private readonly storageService: StorageService,
		private readonly objectsService: ObjectsService,
		private readonly schedulerRegistry: SchedulerRegistry,
	) {}

	onApplicationBootstrap(): void {
		if (!this.config.enabled) {
			this.logger.warn('Blob garbage collection is disabled')
			return
		}

		// Registered by hand rather than with `@Cron`: the expression comes from configuration,
		// and a decorator can only carry a constant.
		const job = new CronJob(this.config.cron, () => void this.collect())
		this.schedulerRegistry.addCronJob(GcService.JOB_NAME, job)
		job.start()

		this.logger.log(`Blob garbage collection scheduled: ${this.config.cron}`)
	}

	onModuleDestroy(): void {
		if (this.schedulerRegistry.doesExist('cron', GcService.JOB_NAME)) {
			this.schedulerRegistry.deleteCronJob(GcService.JOB_NAME)
		}
	}

	/** One full sweep: abandoned uploads first, then the blobs nothing points at - in that
	 *  order, so the parts released by an abort are collected in the same run. */
	async collect(): Promise<GcTypes.Result> {
		if (this.running) {
			this.logger.warn('Garbage collection is already running - skipping this run')
			return { abortedUploads: 0, deletedBlobs: 0, reclaimedBytes: 0, skippedYoungBlobs: 0, durationMs: 0 }
		}

		this.running = true
		const startedAt = Date.now()

		try {
			const abortedUploads = await this.abortAbandonedUploads()
			const blobs = await this.collectOrphanedBlobs()

			const result: GcTypes.Result = { abortedUploads, ...blobs, durationMs: Date.now() - startedAt }
			this.logger.log(JSON.stringify(result))

			return result
		} finally {
			this.running = false
		}
	}

	/** Aborts every multipart upload left in progress past its deadline, through the same path
	 *  `AbortMultipartUpload` takes - so the parts, their blobs and the status all move together. */
	private async abortAbandonedUploads(): Promise<number> {
		const deadline = new Date(Date.now() - this.config.multipartMaxAgeHours * HOUR_MS)

		const stale = await this.db.core
			.select({ uploadId: coreSchema.multipartUpload.uploadId, bucketGuid: coreSchema.multipartUpload.bucketGuid })
			.from(coreSchema.multipartUpload)
			.where(and(
				eq(coreSchema.multipartUpload.status, MultipartUploadStatus.inProgress),
				lt(coreSchema.multipartUpload.createdAt, deadline),
			))

		let aborted = 0
		for (const upload of stale) {
			try {
				await this.objectsService.abortMultipartUpload({ bucketGuid: upload.bucketGuid, uploadId: upload.uploadId })
				aborted += 1
			} catch (err) {
				// One wedged upload must not end the sweep - the rest is still worth collecting.
				this.logger.error(`Could not abort abandoned upload ${upload.uploadId}`, this.stackOf(err))
			}
		}

		return aborted
	}

	/** Deletes blobs no row references.
	 *
	 *  The referenced set is read first and held in memory, then the disk is walked once: the
	 *  alternative, a query per file, turns a sweep of a large store into millions of
	 *  round trips. Reading references before listing files is what makes the order safe -
	 *  a blob written after the set was read is younger than the safety margin anyway, and a
	 *  row committed after the set was read can only have added a reference, never removed one. */
	private async collectOrphanedBlobs(): Promise<Pick<GcTypes.Result, 'deletedBlobs' | 'reclaimedBytes' | 'skippedYoungBlobs'>> {
		const referenced = await this.referencedStoragePaths()
		const youngerThan = new Date(Date.now() - this.config.blobMinAgeHours * HOUR_MS)

		let deletedBlobs = 0
		let reclaimedBytes = 0
		let skippedYoungBlobs = 0

		for await (const blob of this.storageService.listBlobs()) {
			if (referenced.has(blob.storagePath)) continue

			if (blob.modifiedAt > youngerThan) {
				skippedYoungBlobs += 1
				continue
			}

			try {
				await this.storageService.delete(blob.storagePath)
				deletedBlobs += 1
				reclaimedBytes += blob.size
			} catch (err) {
				this.logger.error(`Could not delete orphaned blob ${blob.storagePath}`, this.stackOf(err))
			}
		}

		return { deletedBlobs, reclaimedBytes, skippedYoungBlobs }
	}

	/** A thrown value is `unknown`; only an `Error` carries a stack worth logging. */
	private stackOf(err: unknown): string | undefined {
		return err instanceof Error ? err.stack : undefined
	}

	/** Every storage path the database still claims: object versions and multipart parts. */
	private async referencedStoragePaths(): Promise<Set<string>> {
		const referenced = new Set<string>()

		const versions = await this.db.core
			.select({ storagePath: coreSchema.objectVersion.storagePath })
			.from(coreSchema.objectVersion)
			.where(isNotNull(coreSchema.objectVersion.storagePath))

		for (const row of versions) {
			if (row.storagePath) referenced.add(row.storagePath)
		}

		const parts = await this.db.core
			.select({ storagePath: coreSchema.multipartPart.storagePath })
			.from(coreSchema.multipartPart)

		for (const row of parts) {
			referenced.add(row.storagePath)
		}

		return referenced
	}
}
