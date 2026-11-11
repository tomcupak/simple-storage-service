import { S3Client } from '@aws-sdk/client-s3'
import { Injectable } from '@nestjs/common'
import { coreSchema, DbProvider, MigrationBucketMode, MigrationBucketStatus, MigrationJobStatus } from '@storage/database'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import { BucketsService } from '../buckets/buckets.service'
import { CryptographicService } from '../cryptographic/cryptographic.service'
import { PoliciesService } from '../policies/policies.service'
import { PoliciesTypes } from '../policies/policies.types'
import { MigrationTypes } from './migration.types'
import { MigrationSourceService } from './migration-source.service'

/** Plans, starts and reports migrations. The copying itself is `MigrationWorker`'s job; this
 *  class only writes the job down and reads its progress back. */
@Injectable()
export class MigrationService {
	/** Serialises `start`, so two admins pressing the button at once cannot both pass the
	 *  "nothing is running" check. */
	private static readonly START_LOCK_KEY = 7_302_411

	constructor(
		private readonly db: DbProvider,
		private readonly cryptographic: CryptographicService,
		private readonly source: MigrationSourceService,
		private readonly bucketsService: BucketsService,
		private readonly policiesService: PoliciesService,
	) {}

	/** Connects to the source and reports, per bucket, what a migration would do. A full listing
	 *  pass per bucket is what makes the counts exact - and what makes this slow on big buckets. */
	async inspect(input: MigrationTypes.SourceInput): Promise<MigrationTypes.InspectBucket[]> {
		const client = this.source.open(this.toSourceConfig(input))

		try {
			const names = await this.source.listBuckets(client)
			const result: MigrationTypes.InspectBucket[] = []

			for (const name of names) {
				const totals = await this.count({ client, bucket: name })
				const policy = this.analysePolicy(await this.source.getPolicy({ client, bucket: name }))

				result.push({
					name,
					...totals,
					versioning: await this.source.getVersioning({ client, bucket: name }),
					hasPolicy: policy.present,
					policyWarnings: policy.warnings,
					nameValid: this.bucketsService.isValidName(name),
					existsLocally: (await this.bucketsService.findByName(name)) !== null,
				})
			}

			return result
		} finally {
			this.source.close(client)
		}
	}

	async start({ source, buckets, userGuid }: {
		source: MigrationTypes.SourceInput
		buckets: MigrationTypes.StartBucket[]
		userGuid: string
	}): Promise<MigrationTypes.JobDetail> {
		await this.assertNothingActive()

		const config = this.toSourceConfig(source)
		const client = this.source.open(config)
		let available: string[]

		try {
			available = await this.source.listBuckets(client)
		} finally {
			this.source.close(client)
		}

		const selected = [...new Map(buckets.map((bucket) => [bucket.name, bucket])).values()]
		for (const bucket of selected) {
			if (!available.includes(bucket.name)) throw new MigrationTypes.MigrationSourceBucketNotFoundError()
		}

		const targets = await Promise.all(selected.map(async (bucket) => ({
			bucket,
			local: await this.bucketsService.findByName(bucket.name),
		})))

		const jobGuid = await this.db.core.transaction(async (tx) => {
			await tx.execute(sql`SELECT pg_advisory_xact_lock(${MigrationService.START_LOCK_KEY})`)
			await this.assertNothingActive(tx)

			const [job] = await tx
				.insert(coreSchema.migrationJob)
				.values({
					sourceEndpoint: config.endpoint,
					sourceRegion: config.region,
					sourceAccessKeyId: config.accessKeyId,
					sourceSecret: this.cryptographic.encrypt(config.secretAccessKey),
					createdByUserGuid: userGuid,
				})
				.returning({ guid: coreSchema.migrationJob.guid })

			if (targets.length > 0) {
				await tx.insert(coreSchema.migrationJobBucket).values(targets.map(({ bucket, local }) => ({
					jobGuid: job.guid,
					sourceName: bucket.name,
					targetBucketGuid: local?.guid ?? null,
					mode: local ? MigrationBucketMode.merge : MigrationBucketMode.create,
					overwrite: bucket.overwrite ?? false,
				})))
			}

			return job.guid
		})

		return this.get(jobGuid)
	}

	/** The most recent jobs, each with its buckets' counters summed. */
	async list(): Promise<MigrationTypes.JobItem[]> {
		const jobs = await this.db.core
			.select()
			.from(coreSchema.migrationJob)
			.orderBy(desc(coreSchema.migrationJob.createdAt))
			.limit(MigrationTypes.JOB_LIST_LIMIT)

		if (jobs.length === 0) return []

		const totals = await this.db.core
			.select({
				jobGuid: coreSchema.migrationJobBucket.jobGuid,
				bucketCount: sql<number>`count(*)`.mapWith(Number),
				objectsTotal: sql<number>`coalesce(sum(${coreSchema.migrationJobBucket.objectsTotal}), 0)`.mapWith(Number),
				objectsDone: sql<number>`coalesce(sum(${coreSchema.migrationJobBucket.objectsDone}), 0)`.mapWith(Number),
				objectsFailed: sql<number>`coalesce(sum(${coreSchema.migrationJobBucket.objectsFailed}), 0)`.mapWith(Number),
				objectsSkipped: sql<number>`coalesce(sum(${coreSchema.migrationJobBucket.objectsSkipped}), 0)`.mapWith(Number),
				bytesTotal: sql<number>`coalesce(sum(${coreSchema.migrationJobBucket.bytesTotal}), 0)`.mapWith(Number),
				bytesDone: sql<number>`coalesce(sum(${coreSchema.migrationJobBucket.bytesDone}), 0)`.mapWith(Number),
			})
			.from(coreSchema.migrationJobBucket)
			.where(inArray(coreSchema.migrationJobBucket.jobGuid, jobs.map((job) => job.guid)))
			.groupBy(coreSchema.migrationJobBucket.jobGuid)

		return jobs.map((job) => {
			const sum = totals.find((row) => row.jobGuid === job.guid)

			return this.toJobItem(job, {
				bucketCount: sum?.bucketCount ?? 0,
				objectsTotal: sum?.objectsTotal ?? 0,
				objectsDone: sum?.objectsDone ?? 0,
				objectsFailed: sum?.objectsFailed ?? 0,
				objectsSkipped: sum?.objectsSkipped ?? 0,
				bytesTotal: sum?.bytesTotal ?? 0,
				bytesDone: sum?.bytesDone ?? 0,
			})
		})
	}

	/** One job with its buckets and its latest errors. The stored source secret is never read
	 *  into the result. */
	async get(guid: string): Promise<MigrationTypes.JobDetail> {
		const [job] = await this.db.core
			.select()
			.from(coreSchema.migrationJob)
			.where(eq(coreSchema.migrationJob.guid, guid))
			.limit(1)

		if (!job) throw new MigrationTypes.MigrationNotFoundError()

		const buckets = await this.db.core
			.select()
			.from(coreSchema.migrationJobBucket)
			.where(eq(coreSchema.migrationJobBucket.jobGuid, guid))
			.orderBy(coreSchema.migrationJobBucket.sourceName)

		const errors = await this.db.core
			.select({
				guid: coreSchema.migrationJobError.guid,
				bucketName: coreSchema.migrationJobBucket.sourceName,
				key: coreSchema.migrationJobError.key,
				code: coreSchema.migrationJobError.code,
				message: coreSchema.migrationJobError.message,
				createdAt: coreSchema.migrationJobError.createdAt,
			})
			.from(coreSchema.migrationJobError)
			.innerJoin(coreSchema.migrationJobBucket, eq(coreSchema.migrationJobError.bucketGuid, coreSchema.migrationJobBucket.guid))
			.where(eq(coreSchema.migrationJobError.jobGuid, guid))
			.orderBy(desc(coreSchema.migrationJobError.createdAt))
			.limit(MigrationTypes.DETAIL_ERROR_LIMIT)

		const sum = (field: 'objectsTotal' | 'objectsDone' | 'objectsFailed' | 'objectsSkipped' | 'bytesTotal' | 'bytesDone') =>
			buckets.reduce((total, bucket) => total + bucket[field], 0)

		return {
			...this.toJobItem(job, {
				bucketCount: buckets.length,
				objectsTotal: sum('objectsTotal'),
				objectsDone: sum('objectsDone'),
				objectsFailed: sum('objectsFailed'),
				objectsSkipped: sum('objectsSkipped'),
				bytesTotal: sum('bytesTotal'),
				bytesDone: sum('bytesDone'),
			}),
			buckets: buckets.map((bucket) => ({
				guid: bucket.guid,
				sourceName: bucket.sourceName,
				mode: bucket.mode,
				overwrite: bucket.overwrite,
				status: bucket.status,
				objectsTotal: bucket.objectsTotal,
				objectsDone: bucket.objectsDone,
				objectsFailed: bucket.objectsFailed,
				objectsSkipped: bucket.objectsSkipped,
				bytesTotal: bucket.bytesTotal,
				bytesDone: bucket.bytesDone,
				policyMigrated: bucket.policyMigrated,
				policyWarnings: bucket.policyWarnings,
				error: bucket.error,
			})),
			errors,
		}
	}

	/** Stops a queued or running job. A running worker notices on its next check; until then it
	 *  may still finish an object or two. */
	async cancel(guid: string): Promise<void> {
		const cancelled = await this.db.core
			.update(coreSchema.migrationJob)
			.set({ status: MigrationJobStatus.cancelled, finishedAt: new Date(), updatedAt: new Date() })
			.where(and(
				eq(coreSchema.migrationJob.guid, guid),
				inArray(coreSchema.migrationJob.status, [MigrationJobStatus.queued, MigrationJobStatus.running]),
			))
			.returning({ guid: coreSchema.migrationJob.guid })

		if (cancelled.length > 0) {
			// A queued job never reaches the worker again, so its buckets are closed here; a running
			// one is closed by the worker once it notices.
			await this.db.core
				.update(coreSchema.migrationJobBucket)
				.set({ status: MigrationBucketStatus.cancelled, updatedAt: new Date() })
				.where(and(
					eq(coreSchema.migrationJobBucket.jobGuid, guid),
					eq(coreSchema.migrationJobBucket.status, MigrationBucketStatus.pending),
				))
			return
		}

		const [existing] = await this.db.core
			.select({ guid: coreSchema.migrationJob.guid })
			.from(coreSchema.migrationJob)
			.where(eq(coreSchema.migrationJob.guid, guid))
			.limit(1)

		throw existing ? new MigrationTypes.MigrationNotCancellableError() : new MigrationTypes.MigrationNotFoundError()
	}

	/** Reads a source policy (JSON text) and reports what would be lost: an unparseable or invalid
	 *  document is not migrated at all, and one using condition operators this server cannot
	 *  evaluate would silently grant less than it did at the source. */
	analysePolicy(raw: string | null): MigrationTypes.PolicyAnalysis {
		if (raw === null) return { present: false, document: null, warnings: [] }

		try {
			const document = JSON.parse(raw) as PoliciesTypes.PolicyDocument
			this.policiesService.validate(document)

			return {
				present: true,
				document,
				warnings: this.policiesService.unsupportedConditionOperators(document)
					.map((operator) => `${MigrationTypes.POLICY_UNSUPPORTED_CONDITION}:${operator}`),
			}
		} catch {
			return { present: true, document: null, warnings: [MigrationTypes.POLICY_INVALID] }
		}
	}

	toSourceConfig(input: MigrationTypes.SourceInput): MigrationTypes.SourceConfig {
		return {
			endpoint: `${input.useSsl ? 'https' : 'http'}://${input.host}:${input.port}`,
			region: input.region || MigrationTypes.DEFAULT_REGION,
			accessKeyId: input.accessKeyId,
			secretAccessKey: input.secretAccessKey,
		}
	}

	private async count({ client, bucket }: {
		client: S3Client
		bucket: string
	}): Promise<{ objectCount: number, totalBytes: number }> {
		let objectCount = 0
		let totalBytes = 0
		let token: string | undefined

		do {
			const page = await this.source.listObjects({ client, bucket, token })
			objectCount += page.objects.length
			totalBytes += page.objects.reduce((sum, object) => sum + object.size, 0)
			token = page.nextToken
		} while (token)

		return { objectCount, totalBytes }
	}

	private async assertNothingActive(executor: Pick<DbProvider['core'], 'select'> = this.db.core): Promise<void> {
		const [active] = await executor
			.select({ guid: coreSchema.migrationJob.guid })
			.from(coreSchema.migrationJob)
			.where(inArray(coreSchema.migrationJob.status, [MigrationJobStatus.queued, MigrationJobStatus.running]))
			.limit(1)

		if (active) throw new MigrationTypes.MigrationAlreadyRunningError()
	}

	private toJobItem(
		job: typeof coreSchema.migrationJob.$inferSelect,
		totals: Pick<MigrationTypes.JobItem, 'bucketCount' | 'objectsTotal' | 'objectsDone' | 'objectsFailed' | 'objectsSkipped' | 'bytesTotal' | 'bytesDone'>,
	): MigrationTypes.JobItem {
		return {
			guid: job.guid,
			status: job.status,
			sourceEndpoint: job.sourceEndpoint,
			createdByUserGuid: job.createdByUserGuid,
			error: job.error,
			startedAt: job.startedAt,
			finishedAt: job.finishedAt,
			createdAt: job.createdAt,
			...totals,
		}
	}
}
