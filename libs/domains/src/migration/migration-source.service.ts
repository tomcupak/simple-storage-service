import {
	GetBucketPolicyCommand,
	GetBucketVersioningCommand,
	GetObjectCommand,
	ListBucketsCommand,
	ListObjectsV2Command,
	S3Client,
} from '@aws-sdk/client-s3'
import { Injectable } from '@nestjs/common'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { Readable } from 'stream'

import { MigrationTypes } from './migration.types'

/** The only code that talks to the server being migrated from. It wraps the AWS S3 client and
 *  turns its failures into the two the caller has to tell apart - "cannot reach it" and
 *  "does not accept these credentials" - so no other class needs to know the SDK's error shapes. */
@Injectable()
export class MigrationSourceService {
	private static readonly AUTH_ERROR_NAMES = [
		'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'AccessDenied', 'InvalidToken', 'AuthorizationHeaderMalformed',
		'Forbidden', 'Unauthorized',
	]

	/** A client for one job or one request; call `close` when done. Path style, because MinIO
	 *  is addressed by host and port rather than by a wildcard DNS name. */
	open(config: MigrationTypes.SourceConfig): S3Client {
		return new S3Client({
			endpoint: config.endpoint,
			region: config.region,
			forcePathStyle: true,
			credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
			maxAttempts: 3,
			requestHandler: new NodeHttpHandler({
				connectionTimeout: MigrationTypes.CONNECT_TIMEOUT_MS,
				socketTimeout: MigrationTypes.SOCKET_IDLE_TIMEOUT_MS,
			}),
		})
	}

	close(client: S3Client): void {
		client.destroy()
	}

	async listBuckets(client: S3Client): Promise<string[]> {
		const result = await this.call(() => client.send(new ListBucketsCommand({})))
		return (result.Buckets ?? []).map((bucket) => bucket.Name).filter((name): name is string => Boolean(name))
	}

	async listObjects({ client, bucket, token }: {
		client: S3Client
		bucket: string
		token?: string
	}): Promise<MigrationTypes.SourceObjectPage> {
		const result = await this.call(() => client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token })))

		return {
			objects: (result.Contents ?? []).flatMap((item) => item.Key === undefined
				? []
				: [{ key: item.Key, size: item.Size ?? 0, lastModified: item.LastModified ?? new Date() }]),
			nextToken: result.IsTruncated ? result.NextContinuationToken : undefined,
		}
	}

	/** The policy document as the source returned it (JSON text), or null when there is none. */
	async getPolicy({ client, bucket }: { client: S3Client, bucket: string }): Promise<string | null> {
		try {
			const result = await this.call(() => client.send(new GetBucketPolicyCommand({ Bucket: bucket })))
			return result.Policy ?? null
		} catch (err) {
			if (this.isNamed(err, ['NoSuchBucketPolicy'])) return null
			throw err
		}
	}

	async getVersioning({ client, bucket }: { client: S3Client, bucket: string }): Promise<MigrationTypes.SourceVersioning> {
		const result = await this.call(() => client.send(new GetBucketVersioningCommand({ Bucket: bucket })))

		if (result.Status === 'Enabled') return 'Enabled'
		if (result.Status === 'Suspended') return 'Suspended'
		return null
	}

	async getObject({ client, bucket, key }: { client: S3Client, bucket: string, key: string }): Promise<MigrationTypes.SourceObjectBody> {
		const result = await this.call(() => client.send(new GetObjectCommand({ Bucket: bucket, Key: key })))
		if (!(result.Body instanceof Readable)) throw new Error('Source returned no readable body')

		return {
			stream: result.Body,
			size: result.ContentLength ?? 0,
			contentType: result.ContentType,
			contentEncoding: result.ContentEncoding,
			cacheControl: result.CacheControl,
			contentDisposition: result.ContentDisposition,
			metadata: result.Metadata,
		}
	}

	/** Runs one SDK call and maps its failure; anything that is neither a network problem nor a
	 *  credentials problem (a missing key, say) is passed on untouched for the caller to judge. */
	private async call<T>(request: () => Promise<T>): Promise<T> {
		try {
			return await request()
		} catch (err) {
			throw this.translate(err)
		}
	}

	private translate(err: unknown): unknown {
		if (err instanceof MigrationTypes.MigrationSourceAuthFailedError || err instanceof MigrationTypes.MigrationSourceUnreachableError) return err

		const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
		if (this.isNamed(err, MigrationSourceService.AUTH_ERROR_NAMES) || status === 401 || status === 403) {
			return new MigrationTypes.MigrationSourceAuthFailedError()
		}

		// A response with a status means the server was reached; no status means the request
		// never got an answer (refused, unresolved, timed out, TLS failure).
		if (status === undefined) return new MigrationTypes.MigrationSourceUnreachableError()
		// A non-S3 answer (a web server or proxy on that port) is as good as unreachable.
		if (this.isNamed(err, ['UnknownError', 'Unknown', 'DeserializationError'])) return new MigrationTypes.MigrationSourceUnreachableError()

		return err
	}

	private isNamed(err: unknown, names: string[]): boolean {
		const name = (err as { name?: string })?.name
		const code = (err as { Code?: string })?.Code
		return (name !== undefined && names.includes(name)) || (code !== undefined && names.includes(code))
	}
}
