import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// The app config reads `process.env` when it is first imported, so the test environment has to
// be in place before the module graph is pulled in - hence the dynamic imports in `beforeAll`.
const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 's3-e2e-'))

process.env.POSTGRES_DB = process.env.TEST_POSTGRES_DB || 'core_test'
process.env.STORAGE_DATA_PATH = dataPath
process.env.STORAGE_ENCRYPTION = 'true'
process.env.STORAGE_ENCRYPTION_KEY = 'e2e-master-key-at-least-32-chars!'
process.env.CRYPTOGRAPHIC_PASSWORD = 'e2e-cryptographic-password-32-ch!'
// Counting requests against Valkey would make the suite depend on a second container and on
// how many requests it happens to make; the limiter has its own tests.
process.env.RATE_LIMIT_ENABLED = 'false'
process.env.S3_ENDPOINT_DOMAIN = ''

import {
	AbortMultipartUploadCommand,
	CompleteMultipartUploadCommand,
	CopyObjectCommand,
	CreateBucketCommand,
	CreateMultipartUploadCommand,
	DeleteBucketCommand,
	DeleteObjectCommand,
	DeleteObjectsCommand,
	GetBucketVersioningCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListMultipartUploadsCommand,
	ListObjectsV2Command,
	ListObjectVersionsCommand,
	PutBucketVersioningCommand,
	PutObjectCommand,
	S3Client,
	S3ServiceException,
	UploadPartCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { TestDatabase, TestSeed } from '@storage/database/testing'
import { AccessKeysService } from '@storage/domains/access-keys'
import { Readable } from 'stream'

/** The whole S3 app, driven by the client real users drive it with.
 *
 *  Everything below goes over HTTP through `@aws-sdk/client-s3`: SigV4 as the SDK signs it, the
 *  `aws-chunked` framing it uses for uploads, the XML it expects back, and the error codes it
 *  turns into exceptions. A unit test can show a handler is right; only this can show the SDK
 *  agrees. */
describe('S3 API (AWS SDK)', () => {
	jest.setTimeout(60_000)

	let app: INestApplication
	let client: S3Client
	let testDb: TestDatabase
	let endpoint: string

	beforeAll(async () => {
		const { AppModule } = await import('../app.module')
		const { S3ExceptionFilter } = await import('./s3.exception-filter')

		testDb = await TestDatabase.connect()
		await testDb.truncate()

		app = await NestFactory.create(AppModule, { bodyParser: false, logger: false })
		app.useGlobalFilters(new S3ExceptionFilter())
		await app.listen(0)

		const address = app.getHttpServer().address() as { port: number }
		endpoint = `http://127.0.0.1:${address.port}`

		const seed = new TestSeed(testDb.db)
		const user = await seed.user()
		const credentials = await app.get(AccessKeysService).create({ userGuid: user.guid })

		client = new S3Client({
			endpoint,
			region: 'us-east-1',
			// Path style: the test has no wildcard DNS for `<bucket>.<domain>`.
			forcePathStyle: true,
			credentials: {
				accessKeyId: credentials.accessKeyId,
				secretAccessKey: credentials.secretAccessKey,
			},
		})
	})

	afterAll(async () => {
		client?.destroy()
		await app?.close()
		await testDb?.close()
		await fs.promises.rm(dataPath, { recursive: true, force: true })
	})

	/** Bucket names have to be unique across the whole deployment, and the suite shares one
	 *  database - so each test names its own rather than truncating between tests, which would
	 *  also throw away the access key every request is signed with. */
	let bucketCounter = 0
	const makeBucket = async (): Promise<string> => {
		const Bucket = `e2e-${Date.now()}-${bucketCounter += 1}`
		await client.send(new CreateBucketCommand({ Bucket }))
		return Bucket
	}

	const body = async (stream: unknown): Promise<string> => {
		const chunks: Buffer[] = []
		for await (const chunk of stream as Readable) chunks.push(chunk as Buffer)
		return Buffer.concat(chunks).toString()
	}

	/** The S3 error code the SDK saw, which is what an SDK-using application branches on. */
	const errorCodeOf = async (send: Promise<unknown>): Promise<string> => {
		try {
			await send
		} catch (err) {
			if (err instanceof S3ServiceException) return err.name
			throw err
		}

		throw new Error('Expected the request to fail')
	}

	describe('buckets', () => {
		it('creates, finds and deletes a bucket', async () => {
			const Bucket = await makeBucket()

			const listed = await client.send(new ListObjectsV2Command({ Bucket }))
			expect(listed.KeyCount).toBe(0)

			await client.send(new DeleteBucketCommand({ Bucket }))
			expect(await errorCodeOf(client.send(new ListObjectsV2Command({ Bucket })))).toBe('NoSuchBucket')
		})

		it('refuses to delete a bucket that still holds a key', async () => {
			const Bucket = await makeBucket()
			await client.send(new PutObjectCommand({ Bucket, Key: 'a.txt', Body: 'hello' }))

			expect(await errorCodeOf(client.send(new DeleteBucketCommand({ Bucket })))).toBe('BucketNotEmpty')
		})

		it('refuses a name that is already taken', async () => {
			const Bucket = await makeBucket()
			expect(await errorCodeOf(client.send(new CreateBucketCommand({ Bucket })))).toBe('BucketAlreadyOwnedByYou')
		})
	})

	describe('objects', () => {
		it('round-trips a payload with its metadata', async () => {
			const Bucket = await makeBucket()

			const put = await client.send(new PutObjectCommand({
				Bucket,
				Key: 'notes/hello.txt',
				Body: 'hello world',
				ContentType: 'text/plain',
				Metadata: { author: 'someone' },
			}))

			expect(put.ETag).toBe('"5eb63bbbe01eeed093cb22bb8f5acdc3"')

			const got = await client.send(new GetObjectCommand({ Bucket, Key: 'notes/hello.txt' }))

			expect(await body(got.Body)).toBe('hello world')
			expect(got.ContentType).toBe('text/plain')
			expect(got.Metadata).toEqual({ author: 'someone' })
			expect(got.ContentLength).toBe(11)
		})

		it('reports encryption at rest on the responses', async () => {
			const Bucket = await makeBucket()

			const put = await client.send(new PutObjectCommand({ Bucket, Key: 'a.txt', Body: 'secret' }))
			expect(put.ServerSideEncryption).toBe('AES256')

			const head = await client.send(new HeadObjectCommand({ Bucket, Key: 'a.txt' }))
			expect(head.ServerSideEncryption).toBe('AES256')
		})

		it('refuses an encryption algorithm it does not implement', async () => {
			const Bucket = await makeBucket()

			expect(await errorCodeOf(client.send(new PutObjectCommand({
				Bucket, Key: 'a.txt', Body: 'x', ServerSideEncryption: 'aws:kms',
			})))).toBe('InvalidArgument')
		})

		it('answers a HEAD with the same headers as a GET, minus the payload', async () => {
			const Bucket = await makeBucket()
			await client.send(new PutObjectCommand({ Bucket, Key: 'a.txt', Body: 'hello world', ContentType: 'text/plain' }))

			const head = await client.send(new HeadObjectCommand({ Bucket, Key: 'a.txt' }))

			expect(head.ContentLength).toBe(11)
			expect(head.ContentType).toBe('text/plain')
			expect(head.ETag).toBe('"5eb63bbbe01eeed093cb22bb8f5acdc3"')
		})

		it('serves a byte range as a 206', async () => {
			const Bucket = await makeBucket()
			await client.send(new PutObjectCommand({ Bucket, Key: 'a.txt', Body: 'abcdefghij' }))

			const ranged = await client.send(new GetObjectCommand({ Bucket, Key: 'a.txt', Range: 'bytes=2-5' }))

			expect(await body(ranged.Body)).toBe('cdef')
			expect(ranged.ContentRange).toBe('bytes 2-5/10')
			expect(ranged.ContentLength).toBe(4)
		})

		it('serves a range that starts inside a cipher block', async () => {
			const Bucket = await makeBucket()
			const payload = Array.from({ length: 500 }, (_, index) => String.fromCharCode(97 + (index % 26))).join('')
			await client.send(new PutObjectCommand({ Bucket, Key: 'long.txt', Body: payload }))

			const ranged = await client.send(new GetObjectCommand({ Bucket, Key: 'long.txt', Range: 'bytes=5-100' }))

			expect(await body(ranged.Body)).toBe(payload.slice(5, 101))
		})

		it('honours a conditional request', async () => {
			const Bucket = await makeBucket()
			const put = await client.send(new PutObjectCommand({ Bucket, Key: 'a.txt', Body: 'hello' }))

			expect(await errorCodeOf(client.send(new GetObjectCommand({ Bucket, Key: 'a.txt', IfMatch: '"nope"' }))))
				.toBe('PreconditionFailed')

			const matched = await client.send(new GetObjectCommand({ Bucket, Key: 'a.txt', IfMatch: put.ETag }))
			expect(await body(matched.Body)).toBe('hello')
		})

		it('copies an object between buckets', async () => {
			const source = await makeBucket()
			const target = await makeBucket()
			await client.send(new PutObjectCommand({ Bucket: source, Key: 'a.txt', Body: 'content' }))

			await client.send(new CopyObjectCommand({
				Bucket: target, Key: 'copied.txt', CopySource: `${source}/a.txt`,
			}))

			const copied = await client.send(new GetObjectCommand({ Bucket: target, Key: 'copied.txt' }))
			expect(await body(copied.Body)).toBe('content')
		})

		it('deletes an object', async () => {
			const Bucket = await makeBucket()
			await client.send(new PutObjectCommand({ Bucket, Key: 'a.txt', Body: 'x' }))

			await client.send(new DeleteObjectCommand({ Bucket, Key: 'a.txt' }))

			expect(await errorCodeOf(client.send(new GetObjectCommand({ Bucket, Key: 'a.txt' })))).toBe('NoSuchKey')
		})

		it('deletes many objects in one request', async () => {
			const Bucket = await makeBucket()
			await client.send(new PutObjectCommand({ Bucket, Key: 'a.txt', Body: 'x' }))
			await client.send(new PutObjectCommand({ Bucket, Key: 'b.txt', Body: 'x' }))

			const deleted = await client.send(new DeleteObjectsCommand({
				Bucket,
				Delete: { Objects: [{ Key: 'a.txt' }, { Key: 'b.txt' }] },
			}))

			expect(deleted.Deleted).toHaveLength(2)
			expect((await client.send(new ListObjectsV2Command({ Bucket }))).KeyCount).toBe(0)
		})

		it('answers a missing key with NoSuchKey', async () => {
			const Bucket = await makeBucket()
			expect(await errorCodeOf(client.send(new GetObjectCommand({ Bucket, Key: 'never-written' })))).toBe('NoSuchKey')
		})
	})

	describe('listing', () => {
		it('collapses a delimiter into common prefixes', async () => {
			const Bucket = await makeBucket()
			for (const Key of ['docs/a.txt', 'docs/b.txt', 'images/c.png', 'root.txt']) {
				await client.send(new PutObjectCommand({ Bucket, Key, Body: 'x' }))
			}

			const listed = await client.send(new ListObjectsV2Command({ Bucket, Delimiter: '/' }))

			expect(listed.CommonPrefixes?.map((prefix) => prefix.Prefix)).toEqual(['docs/', 'images/'])
			expect(listed.Contents?.map((object) => object.Key)).toEqual(['root.txt'])
		})

		it('pages through the keys with a continuation token', async () => {
			const Bucket = await makeBucket()
			const keys = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt']
			for (const Key of keys) await client.send(new PutObjectCommand({ Bucket, Key, Body: 'x' }))

			const seen: string[] = []
			let ContinuationToken: string | undefined

			do {
				const page = await client.send(new ListObjectsV2Command({ Bucket, MaxKeys: 2, ContinuationToken }))
				seen.push(...(page.Contents ?? []).map((object) => object.Key ?? ''))
				ContinuationToken = page.NextContinuationToken
			} while (ContinuationToken)

			expect(seen).toEqual(keys)
		})

		it('restricts a listing to a prefix', async () => {
			const Bucket = await makeBucket()
			await client.send(new PutObjectCommand({ Bucket, Key: 'docs/a.txt', Body: 'x' }))
			await client.send(new PutObjectCommand({ Bucket, Key: 'other.txt', Body: 'x' }))

			const listed = await client.send(new ListObjectsV2Command({ Bucket, Prefix: 'docs/' }))

			expect(listed.Contents?.map((object) => object.Key)).toEqual(['docs/a.txt'])
		})
	})

	describe('versioning', () => {
		it('keeps every version once versioning is enabled', async () => {
			const Bucket = await makeBucket()
			await client.send(new PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: 'Enabled' } }))

			expect((await client.send(new GetBucketVersioningCommand({ Bucket }))).Status).toBe('Enabled')

			const first = await client.send(new PutObjectCommand({ Bucket, Key: 'a.txt', Body: 'one' }))
			const second = await client.send(new PutObjectCommand({ Bucket, Key: 'a.txt', Body: 'two' }))

			expect(first.VersionId).toBeDefined()
			expect(first.VersionId).not.toBe(second.VersionId)

			const latest = await client.send(new GetObjectCommand({ Bucket, Key: 'a.txt' }))
			expect(await body(latest.Body)).toBe('two')

			const older = await client.send(new GetObjectCommand({ Bucket, Key: 'a.txt', VersionId: first.VersionId }))
			expect(await body(older.Body)).toBe('one')
		})

		it('hides a deleted key behind a delete marker and lists it', async () => {
			const Bucket = await makeBucket()
			await client.send(new PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: 'Enabled' } }))
			await client.send(new PutObjectCommand({ Bucket, Key: 'a.txt', Body: 'one' }))

			await client.send(new DeleteObjectCommand({ Bucket, Key: 'a.txt' }))

			expect(await errorCodeOf(client.send(new GetObjectCommand({ Bucket, Key: 'a.txt' })))).toBe('NoSuchKey')

			const versions = await client.send(new ListObjectVersionsCommand({ Bucket }))
			expect(versions.DeleteMarkers).toHaveLength(1)
			expect(versions.Versions).toHaveLength(1)
		})
	})

	describe('multipart upload', () => {
		// Every part but the last has to be at least 5 MiB, as in S3.
		const PART = Buffer.alloc(5 * 1024 * 1024, 'a')

		it('uploads, completes and serves the assembled object', async () => {
			const Bucket = await makeBucket()
			const created = await client.send(new CreateMultipartUploadCommand({ Bucket, Key: 'big.bin', ContentType: 'application/octet-stream' }))
			const UploadId = created.UploadId

			const first = await client.send(new UploadPartCommand({ Bucket, Key: 'big.bin', UploadId, PartNumber: 1, Body: PART }))
			const second = await client.send(new UploadPartCommand({ Bucket, Key: 'big.bin', UploadId, PartNumber: 2, Body: Buffer.from('tail') }))

			const completed = await client.send(new CompleteMultipartUploadCommand({
				Bucket,
				Key: 'big.bin',
				UploadId,
				MultipartUpload: { Parts: [{ PartNumber: 1, ETag: first.ETag }, { PartNumber: 2, ETag: second.ETag }] },
			}))

			expect(completed.ETag).toMatch(/-2"?$/)

			const head = await client.send(new HeadObjectCommand({ Bucket, Key: 'big.bin' }))
			expect(head.ContentLength).toBe(PART.length + 4)

			const got = await client.send(new GetObjectCommand({ Bucket, Key: 'big.bin', Range: `bytes=${PART.length}-` }))
			expect(await body(got.Body)).toBe('tail')
		})

		it('lists an upload in progress and forgets it once aborted', async () => {
			const Bucket = await makeBucket()
			const created = await client.send(new CreateMultipartUploadCommand({ Bucket, Key: 'big.bin' }))

			const listed = await client.send(new ListMultipartUploadsCommand({ Bucket }))
			expect(listed.Uploads?.map((upload) => upload.Key)).toEqual(['big.bin'])

			await client.send(new AbortMultipartUploadCommand({ Bucket, Key: 'big.bin', UploadId: created.UploadId }))

			const after = await client.send(new ListMultipartUploadsCommand({ Bucket }))
			expect(after.Uploads ?? []).toHaveLength(0)
		})
	})

	describe('presigned URLs', () => {
		it('serves an object to a link signed by the SDK', async () => {
			const Bucket = await makeBucket()
			await client.send(new PutObjectCommand({ Bucket, Key: 'shared.txt', Body: 'shared content' }))

			const url = await getSignedUrl(client, new GetObjectCommand({ Bucket, Key: 'shared.txt' }), { expiresIn: 60 })
			const response = await fetch(url)

			expect(response.status).toBe(200)
			expect(await response.text()).toBe('shared content')
		})

		it('refuses the same link once its signature has been altered', async () => {
			const Bucket = await makeBucket()
			await client.send(new PutObjectCommand({ Bucket, Key: 'shared.txt', Body: 'shared content' }))

			const url = await getSignedUrl(client, new GetObjectCommand({ Bucket, Key: 'shared.txt' }), { expiresIn: 60 })
			const response = await fetch(url.replace(/.$/, (last) => (last === 'a' ? 'b' : 'a')))

			expect(response.status).toBe(403)
		})
	})

	describe('authorisation', () => {
		it('refuses an unsigned request to a private bucket', async () => {
			const Bucket = await makeBucket()
			await client.send(new PutObjectCommand({ Bucket, Key: 'a.txt', Body: 'x' }))

			const response = await fetch(`${endpoint}/${Bucket}/a.txt`)

			expect(response.status).toBe(403)
			expect(await response.text()).toContain('<Code>AccessDenied</Code>')
		})

		it('refuses a request signed with the wrong secret', async () => {
			const Bucket = await makeBucket()
			const impostor = new S3Client({
				endpoint,
				region: 'us-east-1',
				forcePathStyle: true,
				credentials: { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'not-the-real-secret' },
			})

			try {
				expect(await errorCodeOf(impostor.send(new ListObjectsV2Command({ Bucket })))).toBe('InvalidAccessKeyId')
			} finally {
				impostor.destroy()
			}
		})

		it('answers an unimplemented sub-resource with NotImplemented', async () => {
			const Bucket = await makeBucket()
			await client.send(new PutObjectCommand({ Bucket, Key: 'a.txt', Body: 'x' }))

			const response = await fetch(`${endpoint}/${Bucket}/a.txt?tagging`)

			expect(response.status).toBe(501)
			expect(await response.text()).toContain('<Code>NotImplemented</Code>')
		})
	})

	describe('health', () => {
		it('answers the readiness probe outside the S3 protocol', async () => {
			const response = await fetch(`${endpoint}/_ready`)

			expect(response.status).toBe(200)
			expect(await response.json()).toEqual({ status: 'ok', database: 'ok', storage: 'ok' })
		})
	})
})
