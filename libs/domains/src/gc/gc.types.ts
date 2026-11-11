export namespace GcTypes {
	export interface Config {
		/** Off leaves the collector registered but never running - a deployment that would
		 *  rather sweep by hand can still call `collect()`. */
		enabled: boolean
		/** Cron expression for the scheduled sweep. */
		cron: string
		/** How long an unfinished multipart upload may sit before it is aborted. S3's own
		 *  lifecycle rules work the same way: parts occupy storage and are charged for it. */
		multipartMaxAgeHours: number
		/** How old a blob must be before it can be considered orphaned. A payload is written
		 *  to disk before its version row is committed, so anything younger than this may be
		 *  an upload still in flight rather than garbage. */
		blobMinAgeHours: number
	}

	export interface Result {
		/** Multipart uploads aborted for having been abandoned. */
		abortedUploads: number
		/** Blobs no row pointed at any more. */
		deletedBlobs: number
		/** Bytes those blobs occupied. */
		reclaimedBytes: number
		/** Blobs skipped only because they were younger than `blobMinAgeHours`. */
		skippedYoungBlobs: number
		durationMs: number
	}
}
