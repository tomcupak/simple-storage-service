import { S3Client } from '@aws-sdk/client-s3'
import { Injectable, Logger } from '@nestjs/common'
import {
	BucketVersioning,
	coreSchema,
	DbProvider,
	MigrationBucketMode,
	MigrationBucketStatus,
	MigrationJobStatus,
} from '@storage/database'
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm'

import { BucketsService } from '../buckets/buckets.service'
import { BucketsTypes } from '../buckets/buckets.types'
import { CryptographicService } from '../cryptographic/cryptographic.service'
import { ObjectsService } from '../objects/objects.service'
import { ObjectsTypes } from '../objects/objects.types'
import { PoliciesService } from '../policies/policies.service'
import { MigrationService } from './migration.service'
import { MigrationTypes } from './migration.types'
import { MigrationSourceService } from './migration-source.service'

type Job = typeof coreSchema.migrationJob.$inferSelect
type BucketRow = typeof coreSchema.migrationJobBucket.$inferSelect

/** State shared by everything one running job does. */
interface JobContext {
	job: Job
	client: S3Client
	/** Errors itemised so far, kept in memory so the cap needs no query per failure. */
	errorCount: number
	/** Set by the heartbeat when the job is no longer ours to run (cancelled, or taken over). */
	stopped: boolean
}

interface Tally {
	done: number
	failed: number
	skipped: number
	bytes: number
}

type Target = ObjectsTypes.BucketContext

/** Copies the buckets of a migration job, in the background of `apps/api`.
 *
 *  A job is claimed with one atomic `UPDATE ... FOR UPDATE SKIP LOCKED`, and the owner proves it
 *  is alive with a heartbeat. A `running` job whose heartbeat went stale - its process died or
 *  was restarted - is simply claimed again, and the work resumes from the last persisted page.
 *  Resuming is safe because every object is first compared with what is already stored: an
 *  object of the same size and modification time is a copy that already happened. */
@Injectable()
export class MigrationWorker {
	private logger = new Logger(MigrationWorker.name)
	private timer?: NodeJS.Timeout
	private destroyed = false

	constructor(
		private readonly config: MigrationTypes.Config,
		private readonly db: DbProvider,
		private readonly cryptographic: CryptographicService,
		private readonly source: MigrationSourceService,
		private readonly migrationService: MigrationService,
		private readonly bucketsService: BucketsService,
		private readonly policiesService: PoliciesService,
		private readonly objectsService: ObjectsService,
	) {}

	onApplicationBootstrap(): void {
		if (!this.config.enabled) {
			this.logger.warn('Migration worker is disabled - queued jobs will not be processed')
			return
		}

		this.schedule()
	}

	/** Stops polling. A job in progress is not finished here; its heartbeat goes stale and
	 *  whichever worker starts next resumes it. */
	onModuleDestroy(): void {
		this.destroyed = true
		clearTimeout(this.timer)
	}

	/** One poll: claim a job if there is one and run it to the end. The next poll is only
	 *  scheduled afterwards, so an instance never runs two jobs at once. */
	async tick(): Promise<void> {
		try {
			const job = await this.claimNext()
			if (job) await this.run(job)
		} catch (err) {
			this.logger.error('Migration worker tick failed', err instanceof Error ? err.stack : undefined)
		} finally {
			this.schedule()
		}
	}

	/** Atomically takes the oldest queued job, or a running one whose heartbeat is stale. */
	async claimNext(): Promise<Job | null> {
		const claimed = await this.db.core.execute<{ guid: string }>(sql`
			UPDATE migration_job
			SET status = 'running', heartbeat_at = now(), started_at = coalesce(started_at, now()), updated_at = now()
			WHERE guid = (
				SELECT guid FROM migration_job
				WHERE status = 'queued'
					OR (status = 'running' AND heartbeat_at < now() - make_interval(secs => ${MigrationTypes.STALE_AFTER_SECONDS}::double precision))
				ORDER BY created_at
				LIMIT 1
				FOR UPDATE SKIP LOCKED
			)
			RETURNING guid
		`)

		const guid = claimed.rows[0]?.guid
		if (!guid) return null

		const [job] = await this.db.core.select().from(coreSchema.migrationJob).where(eq(coreSchema.migrationJob.guid, guid)).limit(1)
		return job ?? null
	}

	/** Runs a claimed job to a final state. Never throws: whatever goes wrong ends up on the job. */
	async run(job: Job): Promise<void> {
		const client = this.source.open({
			endpoint: job.sourceEndpoint,
			region: job.sourceRegion,
			accessKeyId: job.sourceAccessKeyId,
			secretAccessKey: this.cryptographic.decrypt(job.sourceSecret),
		})
		const ctx: JobContext = { job, client, errorCount: await this.countErrors(job.guid), stopped: false }
		const heartbeat = setInterval(() => void this.beat(ctx), MigrationTypes.HEARTBEAT_INTERVAL_MS)

		try {
			const buckets = await this.db.core
				.select()
				.from(coreSchema.migrationJobBucket)
				.where(and(
					eq(coreSchema.migrationJobBucket.jobGuid, job.guid),
					inArray(coreSchema.migrationJobBucket.status, [MigrationBucketStatus.pending, MigrationBucketStatus.running]),
				))
				.orderBy(coreSchema.migrationJobBucket.sourceName)

			for (const bucket of buckets) {
				// Checked before each bucket, not only inside one: otherwise a job cancelled between
				// two buckets would still create the next one before noticing.
				if (await this.isCancelled(ctx) || await this.migrateBucket(ctx, bucket) === 'cancelled') {
					await this.markUnfinishedBuckets({ jobGuid: job.guid, status: MigrationBucketStatus.cancelled })
					return
				}
			}

			await this.finish({ jobGuid: job.guid, status: MigrationJobStatus.completed })
		} catch (err) {
			const reason = this.reasonOf(err)
			this.logger.error(`Migration ${job.guid} failed: ${reason}`, err instanceof Error ? err.stack : undefined)

			await this.markUnfinishedBuckets({ jobGuid: job.guid, status: MigrationBucketStatus.failed, onlyRunning: true, error: reason })
			await this.markUnfinishedBuckets({ jobGuid: job.guid, status: MigrationBucketStatus.cancelled })
			await this.finish({ jobGuid: job.guid, status: MigrationJobStatus.failed, error: reason })
		} finally {
			clearInterval(heartbeat)
			this.source.close(client)
		}
	}

	private schedule(): void {
		if (this.destroyed) return
		this.timer = setTimeout(() => void this.tick(), this.config.pollIntervalMs)
	}

	/** Refreshes the heartbeat. An update that touches nothing means the job is no longer
	 *  `running` - it was cancelled - which is how a worker learns to stop mid-page. */
	private async beat(ctx: JobContext): Promise<void> {
		try {
			const alive = await this.db.core
				.update(coreSchema.migrationJob)
				.set({ heartbeatAt: new Date() })
				.where(and(eq(coreSchema.migrationJob.guid, ctx.job.guid), eq(coreSchema.migrationJob.status, MigrationJobStatus.running)))
				.returning({ guid: coreSchema.migrationJob.guid })

			if (alive.length === 0) ctx.stopped = true
		} catch (err) {
			this.logger.warn(`Heartbeat of migration ${ctx.job.guid} failed: ${this.reasonOf(err)}`)
		}
	}

	private async isCancelled(ctx: JobContext): Promise<boolean> {
		if (ctx.stopped) return true

		const [job] = await this.db.core
			.select({ status: coreSchema.migrationJob.status })
			.from(coreSchema.migrationJob)
			.where(eq(coreSchema.migrationJob.guid, ctx.job.guid))
			.limit(1)

		ctx.stopped = job?.status !== MigrationJobStatus.running
		return ctx.stopped
	}

	/** One source bucket, start to finish. A problem with the bucket itself fails that bucket and
	 *  moves on; only a lost source (unreachable, credentials revoked) ends the whole job. */
	private async migrateBucket(ctx: JobContext, initial: BucketRow): Promise<'done' | 'cancelled'> {
		let row = await this.updateBucket(initial.guid, { status: MigrationBucketStatus.running })

		try {
			const target = await this.prepareTarget(ctx, row)
			if (!target) return 'done'

			if (!row.totalsComputed) {
				if (await this.analyse(ctx, row) === 'cancelled') return 'cancelled'
				row = await this.updateBucket(row.guid, {})
			}

			await this.migratePolicy({ ctx, row, target })

			if (await this.copyObjects({ ctx, row, target }) === 'cancelled') return 'cancelled'

			await this.applyVersioning({ ctx, row, target })
			await this.updateBucket(row.guid, { status: MigrationBucketStatus.completed })
			return 'done'
		} catch (err) {
			if (this.isSourceLost(err)) throw err

			this.logger.error(`Bucket ${row.sourceName} of migration ${ctx.job.guid} failed: ${this.reasonOf(err)}`)
			await this.updateBucket(row.guid, { status: MigrationBucketStatus.failed, error: this.reasonOf(err) })
			return 'done'
		}
	}

	/** Resolves the local bucket, creating it when the plan says so. Returns null - after
	 *  marking the bucket failed - when it cannot be had. */
	private async prepareTarget(ctx: JobContext, row: BucketRow): Promise<Target | null> {
		if (row.targetBucketGuid) {
			const existing = await this.loadBucket(row.targetBucketGuid)
			if (existing) return existing

			await this.failBucket(row, 'bucket_not_found')
			return null
		}

		if (row.mode === MigrationBucketMode.merge) {
			const found = await this.bucketsService.findByName(row.sourceName)
			if (!found) {
				await this.failBucket(row, 'bucket_not_found')
				return null
			}

			await this.updateBucket(row.guid, { targetBucketGuid: found.guid })
			return found
		}

		if (!this.bucketsService.isValidName(row.sourceName)) {
			await this.failBucket(row, 'invalid_bucket_name')
			return null
		}

		let created: BucketsTypes.BucketItem
		try {
			created = await this.bucketsService.create({
				name: row.sourceName,
				ownerUserGuid: ctx.job.createdByUserGuid,
				region: ctx.job.sourceRegion,
			})
		} catch (err) {
			// A bucket this very job created before its process died is ours to carry on with.
			const found = err instanceof BucketsTypes.BucketAlreadyExistsError
				? await this.bucketsService.findByName(row.sourceName)
				: null
			if (!found || found.ownerUserGuid !== ctx.job.createdByUserGuid) {
				await this.failBucket(row, (err as { code?: string }).code ?? 'bucket_create_failed')
				return null
			}
			created = found
		}

		await this.updateBucket(row.guid, { targetBucketGuid: created.guid })
		return created
	}

	/** Counts the whole source bucket so progress has a denominator. */
	private async analyse(ctx: JobContext, row: BucketRow): Promise<'done' | 'cancelled'> {
		let objects = 0
		let bytes = 0
		let token: string | undefined

		do {
			if (await this.isCancelled(ctx)) return 'cancelled'

			const page = await this.source.listObjects({ client: ctx.client, bucket: row.sourceName, token })
			objects += page.objects.length
			bytes += page.objects.reduce((sum, object) => sum + object.size, 0)
			token = page.nextToken
		} while (token)

		await this.updateBucket(row.guid, { objectsTotal: objects, bytesTotal: bytes, totalsComputed: true })
		return 'done'
	}

	/** Brings the policy over: always into a bucket this job created, and into an existing one
	 *  only when it has none - a policy somebody set here is not ours to replace. */
	private async migratePolicy({ ctx, row, target }: { ctx: JobContext, row: BucketRow, target: Target }): Promise<void> {
		if (row.policyMigrated) return

		const analysis = this.migrationService.analysePolicy(await this.source.getPolicy({ client: ctx.client, bucket: row.sourceName }))
		const warnings = [...analysis.warnings]
		let migrated = false

		if (analysis.document) {
			const alreadyHasOne = row.mode === MigrationBucketMode.merge && await this.policiesService.get(target.guid) !== null

			if (alreadyHasOne) {
				warnings.push(MigrationTypes.POLICY_NOT_OVERWRITTEN)
			} else {
				await this.policiesService.set({ bucketGuid: target.guid, document: analysis.document, updatedByUserGuid: ctx.job.createdByUserGuid })
				migrated = true
			}
		}

		await this.updateBucket(row.guid, { policyMigrated: migrated, policyWarnings: warnings })
	}

	/** Pages through the bucket from the persisted continuation token. Progress is written once a
	 *  page is entirely processed, never before: a crash mid-page repeats that page, which the
	 *  skip rule in `decide` makes harmless. */
	private async copyObjects({ ctx, row, target }: { ctx: JobContext, row: BucketRow, target: Target }): Promise<'done' | 'cancelled'> {
		let token = row.continuationToken ?? undefined

		for (;;) {
			if (await this.isCancelled(ctx)) return 'cancelled'

			const page = await this.source.listObjects({ client: ctx.client, bucket: row.sourceName, token })
			const tally: Tally = { done: 0, failed: 0, skipped: 0, bytes: 0 }

			await this.forEachConcurrent(page.objects, async (object) => {
				if (!ctx.stopped) await this.copyOne({ ctx, row, target, object, tally })
			})

			await this.db.core
				.update(coreSchema.migrationJobBucket)
				.set({
					objectsDone: sql`${coreSchema.migrationJobBucket.objectsDone} + ${tally.done}`,
					objectsFailed: sql`${coreSchema.migrationJobBucket.objectsFailed} + ${tally.failed}`,
					objectsSkipped: sql`${coreSchema.migrationJobBucket.objectsSkipped} + ${tally.skipped}`,
					bytesDone: sql`${coreSchema.migrationJobBucket.bytesDone} + ${tally.bytes}`,
					continuationToken: page.nextToken ?? null,
					updatedAt: new Date(),
				})
				.where(eq(coreSchema.migrationJobBucket.guid, row.guid))

			if (ctx.stopped) return 'cancelled'

			token = page.nextToken
			if (!token) return 'done'
		}
	}

	/** One object. Its failure is recorded and counted but never stops the job - except a failure
	 *  of the source itself, which would only repeat for every object after it. */
	private async copyOne({ ctx, row, target, object, tally }: {
		ctx: JobContext
		row: BucketRow
		target: Target
		object: MigrationTypes.SourceObject
		tally: Tally
	}): Promise<void> {
		try {
			const existing = await this.findLocal(target.guid, object.key)
			const decision = this.decide({ existing, object, mode: row.mode, overwrite: row.overwrite })

			if (decision !== 'copy') {
				tally.skipped += 1
				tally.done += 1
				tally.bytes += object.size
				return
			}

			const body = await this.source.getObject({ client: ctx.client, bucket: row.sourceName, key: object.key })

			try {
				await this.objectsService.put({
					bucket: target,
					key: object.key,
					stream: body.stream,
					declaredLength: body.size,
					maxBytes: body.size,
					contentType: body.contentType,
					contentEncoding: body.contentEncoding,
					cacheControl: body.cacheControl,
					contentDisposition: body.contentDisposition,
					metadata: body.metadata,
					lastModified: object.lastModified,
				})
			} catch (err) {
				body.stream.destroy()
				throw err
			}

			tally.done += 1
			tally.bytes += object.size
		} catch (err) {
			if (this.isSourceLost(err)) throw err

			tally.failed += 1
			await this.recordError({ ctx, row, key: object.key, err })
		}
	}

	/** What to do with a source object given what is already stored under its key. ETags are
	 *  deliberately not compared: MinIO's multipart ETags (`md5-N`) are not ours. */
	private decide({ existing, object, mode, overwrite }: {
		existing: ObjectsTypes.ObjectVersionDetail | null
		object: MigrationTypes.SourceObject
		mode: MigrationBucketMode
		overwrite: boolean
	}): MigrationTypes.ObjectDecision {
		if (!existing || existing.isDeleteMarker) return 'copy'

		const sameSecond = Math.floor(existing.lastModified.getTime() / 1000) === Math.floor(object.lastModified.getTime() / 1000)
		if (existing.size === object.size && sameSecond) return 'skip-identical'

		if (mode === MigrationBucketMode.merge && !overwrite) return 'skip-existing'
		return 'copy'
	}

	/** Versioning goes on last, so the copy itself does not leave a version behind per object. */
	private async applyVersioning({ ctx, row, target }: { ctx: JobContext, row: BucketRow, target: Target }): Promise<void> {
		const versioning = await this.source.getVersioning({ client: ctx.client, bucket: row.sourceName })
		if (!versioning) return

		await this.bucketsService.setVersioning({
			guid: target.guid,
			versioning: versioning === 'Enabled' ? BucketVersioning.enabled : BucketVersioning.suspended,
		})
	}

	private async findLocal(bucketGuid: string, key: string): Promise<ObjectsTypes.ObjectVersionDetail | null> {
		try {
			return await this.objectsService.getVersion({ bucketGuid, key })
		} catch (err) {
			if (err instanceof ObjectsTypes.ObjectNotFoundError) return null
			throw err
		}
	}

	private async recordError({ ctx, row, key, err }: { ctx: JobContext, row: BucketRow, key: string, err: unknown }): Promise<void> {
		ctx.errorCount += 1
		if (ctx.errorCount > MigrationTypes.MAX_ERRORS_PER_JOB) return

		await this.db.core.insert(coreSchema.migrationJobError).values({
			jobGuid: ctx.job.guid,
			bucketGuid: row.guid,
			key,
			code: (err as { code?: string })?.code ?? (err instanceof Error ? err.name : 'unknown'),
			message: this.messageOf(err).slice(0, 500),
		})
	}

	/** Runs `task` over `items`, at most `concurrency` at a time. The first failure stops the
	 *  others from starting new items and is rethrown. */
	private async forEachConcurrent<T>(items: T[], task: (item: T) => Promise<void>): Promise<void> {
		let next = 0
		let failure: unknown

		const lane = async (): Promise<void> => {
			while (failure === undefined && next < items.length) {
				const item = items[next++]
				try {
					await task(item)
				} catch (err) {
					failure ??= err
				}
			}
		}

		await Promise.all(Array.from({ length: Math.max(1, this.config.concurrency) }, () => lane()))
		if (failure !== undefined) throw failure
	}

	private async loadBucket(guid: string): Promise<Target | null> {
		const [found] = await this.db.core
			.select()
			.from(coreSchema.bucket)
			.where(and(eq(coreSchema.bucket.guid, guid), isNull(coreSchema.bucket.deletedAt)))
			.limit(1)

		return found ?? null
	}

	private async countErrors(jobGuid: string): Promise<number> {
		const [row] = await this.db.core
			.select({ value: count() })
			.from(coreSchema.migrationJobError)
			.where(eq(coreSchema.migrationJobError.jobGuid, jobGuid))

		return row?.value ?? 0
	}

	private async updateBucket(guid: string, values: Partial<typeof coreSchema.migrationJobBucket.$inferInsert>): Promise<BucketRow> {
		const [updated] = await this.db.core
			.update(coreSchema.migrationJobBucket)
			.set({ ...values, updatedAt: new Date() })
			.where(eq(coreSchema.migrationJobBucket.guid, guid))
			.returning()

		return updated
	}

	private async failBucket(row: BucketRow, error: string): Promise<void> {
		await this.updateBucket(row.guid, { status: MigrationBucketStatus.failed, error })
	}

	/** Moves every bucket of the job that did not finish into `status`. */
	private async markUnfinishedBuckets({ jobGuid, status, onlyRunning, error }: {
		jobGuid: string
		status: MigrationBucketStatus
		onlyRunning?: boolean
		error?: string
	}): Promise<void> {
		await this.db.core
			.update(coreSchema.migrationJobBucket)
			.set({ status, ...(error ? { error } : {}), updatedAt: new Date() })
			.where(and(
				eq(coreSchema.migrationJobBucket.jobGuid, jobGuid),
				inArray(coreSchema.migrationJobBucket.status, onlyRunning
					? [MigrationBucketStatus.running]
					: [MigrationBucketStatus.pending, MigrationBucketStatus.running]),
			))
	}

	/** Conditional on `running`, so a job cancelled while the worker finished stays cancelled. */
	private async finish({ jobGuid, status, error }: { jobGuid: string, status: MigrationJobStatus, error?: string }): Promise<void> {
		await this.db.core
			.update(coreSchema.migrationJob)
			.set({ status, error: error ?? null, finishedAt: new Date(), updatedAt: new Date() })
			.where(and(eq(coreSchema.migrationJob.guid, jobGuid), eq(coreSchema.migrationJob.status, MigrationJobStatus.running)))
	}

	private isSourceLost(err: unknown): boolean {
		return err instanceof MigrationTypes.MigrationSourceUnreachableError
			|| err instanceof MigrationTypes.MigrationSourceAuthFailedError
	}

	private reasonOf(err: unknown): string {
		const code = (err as { code?: unknown })?.code
		if (typeof code === 'string') return code
		return this.messageOf(err)
	}

	private messageOf(err: unknown): string {
		return err instanceof Error ? err.message : JSON.stringify(err)
	}
}
