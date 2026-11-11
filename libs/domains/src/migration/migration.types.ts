import { MigrationBucketMode, MigrationBucketStatus, MigrationJobStatus } from '@storage/database'
import { Readable } from 'stream'

import { PoliciesTypes } from '../policies/policies.types'

export namespace MigrationTypes {
	export interface Config {
		/** Off leaves jobs queued and unprocessed; the API still accepts them. */
		enabled: boolean
		/** Objects copied at the same time within one job. */
		concurrency: number
		/** How often an idle worker looks for a job to claim. */
		pollIntervalMs: number
	}

	/** How often a running job proves its process is alive. */
	export const HEARTBEAT_INTERVAL_MS = 15_000
	/** A `running` job whose heartbeat is older than this is taken over by any worker. */
	export const STALE_AFTER_SECONDS = 60
	/** Per job. Past this, failures are still counted but no longer itemised. */
	export const MAX_ERRORS_PER_JOB = 1000
	/** Errors a job detail carries. */
	export const DETAIL_ERROR_LIMIT = 100
	export const JOB_LIST_LIMIT = 20
	export const DEFAULT_REGION = 'us-east-1'
	export const CONNECT_TIMEOUT_MS = 5000
	/** A socket that carries no bytes for this long is dropped - without it, a source that stops
	 *  sending mid-object would hold the job forever. A large object is fine as long as it flows. */
	export const SOCKET_IDLE_TIMEOUT_MS = 60_000

	/** What the admin typed in; turned into an endpoint URL by `MigrationService`. */
	export interface SourceInput {
		host: string
		port: number
		useSsl: boolean
		accessKeyId: string
		secretAccessKey: string
		region?: string
	}

	/** A source server as the S3 client needs it. */
	export interface SourceConfig {
		endpoint: string
		region: string
		accessKeyId: string
		secretAccessKey: string
	}

	export interface SourceObject {
		key: string
		size: number
		lastModified: Date
	}

	export interface SourceObjectPage {
		objects: SourceObject[]
		/** Token of the next page; undefined on the last one. */
		nextToken?: string
	}

	export interface SourceObjectBody {
		stream: Readable
		size: number
		contentType?: string
		contentEncoding?: string
		cacheControl?: string
		contentDisposition?: string
		metadata?: Record<string, string>
	}

	/** Versioning of a source bucket; null when it never had any. */
	export type SourceVersioning = 'Enabled' | 'Suspended' | null

	export interface InspectBucket {
		name: string
		objectCount: number
		totalBytes: number
		versioning: SourceVersioning
		hasPolicy: boolean
		policyWarnings: string[]
		nameValid: boolean
		existsLocally: boolean
	}

	export interface StartBucket {
		name: string
		overwrite?: boolean
	}

	export interface JobItem {
		guid: string
		status: MigrationJobStatus
		sourceEndpoint: string
		createdByUserGuid: string
		error: string | null
		startedAt: Date | null
		finishedAt: Date | null
		createdAt: Date
		bucketCount: number
		objectsTotal: number
		objectsDone: number
		objectsFailed: number
		objectsSkipped: number
		bytesTotal: number
		bytesDone: number
	}

	export interface BucketItem {
		guid: string
		sourceName: string
		mode: MigrationBucketMode
		overwrite: boolean
		status: MigrationBucketStatus
		objectsTotal: number
		objectsDone: number
		objectsFailed: number
		objectsSkipped: number
		bytesTotal: number
		bytesDone: number
		policyMigrated: boolean
		policyWarnings: string[]
		error: string | null
	}

	export interface ErrorItem {
		guid: string
		bucketName: string
		key: string
		code: string
		message: string
		createdAt: Date
	}

	export interface JobDetail extends JobItem {
		buckets: BucketItem[]
		errors: ErrorItem[]
	}

	/** A policy as read from the source: the parsed document when it is usable, and what is
	 *  wrong with it or lost in translation, as codes. */
	export interface PolicyAnalysis {
		present: boolean
		document: PoliciesTypes.PolicyDocument | null
		warnings: string[]
	}

	export const POLICY_INVALID = 'policy_invalid'
	export const POLICY_UNSUPPORTED_CONDITION = 'policy_unsupported_condition'
	export const POLICY_NOT_OVERWRITTEN = 'policy_not_overwritten'

	export type ObjectDecision = 'copy' | 'skip-identical' | 'skip-existing'

	export class MigrationSourceUnreachableError extends Error { public code = 'migration_source_unreachable' }
	export class MigrationSourceAuthFailedError extends Error { public code = 'migration_source_auth_failed' }
	export class MigrationNotFoundError extends Error { public code = 'migration_not_found' }
	export class MigrationAlreadyRunningError extends Error { public code = 'migration_already_running' }
	export class MigrationNotCancellableError extends Error { public code = 'migration_not_cancellable' }
	export class MigrationSourceBucketNotFoundError extends Error { public code = 'migration_source_bucket_not_found' }
}
