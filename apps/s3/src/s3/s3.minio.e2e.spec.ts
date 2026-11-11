import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// See s3.e2e.spec.ts: the app config reads `process.env` at import time.
const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 's3-minio-e2e-'))

process.env.POSTGRES_DB = process.env.TEST_POSTGRES_DB || 'core_test'
process.env.STORAGE_DATA_PATH = dataPath
process.env.STORAGE_ENCRYPTION = 'true'
process.env.STORAGE_ENCRYPTION_KEY = 'e2e-master-key-at-least-32-chars!'
process.env.CRYPTOGRAPHIC_PASSWORD = 'e2e-cryptographic-password-32-ch!'
process.env.RATE_LIMIT_ENABLED = 'false'
process.env.S3_ENDPOINT_DOMAIN = ''

import { INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { TestDatabase, TestSeed } from '@storage/database/testing'
import { AccessKeysService } from '@storage/domains/access-keys'
import { Client, S3Error } from 'minio'

/** A consumer backend using the `minio` npm client against our server: no region, path style,
 *  plain HTTP, public buckets via a `GetObject` policy and private ones via an empty policy. */
describe('S3 API (minio client)', () => {
	jest.setTimeout(60_000)

	let app: INestApplication
	let testDb: TestDatabase
	let client: Client
	let baseUrl: string

	const suffix = Date.now().toString(36)
	const publicBucket = `pdf-assets-${suffix}`
	const privateBucket = `contract-documents-${suffix}`
	const key = 'user-guid/file-guid.pdf'
	const payload = Buffer.from('%PDF-1.4 minio e2e payload éè')

	beforeAll(async () => {
		const { AppModule } = await import('../app.module')
		const { S3ExceptionFilter } = await import('./s3.exception-filter')

		testDb = await TestDatabase.connect()
		await testDb.truncate()

		app = await NestFactory.create(AppModule, { bodyParser: false, logger: false })
		app.useGlobalFilters(new S3ExceptionFilter())
		await app.listen(0)

		const port = (app.getHttpServer().address() as { port: number }).port
		baseUrl = `http://127.0.0.1:${port}`

		const user = await new TestSeed(testDb.db).user()
		const credentials = await app.get(AccessKeysService).create({ userGuid: user.guid })

		client = new Client({
			endPoint: '127.0.0.1',
			port,
			useSSL: false,
			accessKey: credentials.accessKeyId,
			secretKey: credentials.secretAccessKey,
		})
	})

	afterAll(async () => {
		await app?.close()
		await testDb?.close()
		await fs.promises.rm(dataPath, { recursive: true, force: true })
	})

	const codeOf = async (promise: Promise<unknown>): Promise<string> => {
		try {
			await promise
		} catch (err) {
			if (err instanceof S3Error) return err.code ?? ''
			throw err
		}
		throw new Error('expected the call to reject')
	}

	const readAll = async (stream: NodeJS.ReadableStream): Promise<Buffer> => {
		const chunks: Buffer[] = []
		for await (const chunk of stream) chunks.push(chunk as Buffer)
		return Buffer.concat(chunks)
	}

	const publicPolicy = (bucket: string): string =>
		JSON.stringify({
			Version: '2012-10-17',
			Statement: [
				{
					Sid: 'PublicGet',
					Effect: 'Allow',
					Principal: '*',
					Action: 's3:GetObject',
					Resource: [`arn:aws:s3:::${bucket}/*`, `arn:aws:s3:::${bucket}`],
				},
			],
		})

	const boot = async (): Promise<void> => {
		for (const bucket of [publicBucket, privateBucket]) {
			if (!(await client.bucketExists(bucket))) await client.makeBucket(bucket)
		}
		await client.setBucketPolicy(publicBucket, publicPolicy(publicBucket))
		await client.setBucketPolicy(privateBucket, '')
	}

	it('bucketExists is false for a bucket that does not exist', async () => {
		expect(await client.bucketExists(`nope-${suffix}`)).toBe(false)
	})

	it('boots idempotently', async () => {
		await boot()
		await boot()
		expect(await client.bucketExists(publicBucket)).toBe(true)
		expect(await client.bucketExists(privateBucket)).toBe(true)
	})

	it('puts, stats and gets an object under a slashed key', async () => {
		for (const bucket of [publicBucket, privateBucket]) {
			await client.putObject(bucket, key, payload)

			const stat = await client.statObject(bucket, key)
			expect(stat.size).toBe(payload.length)
			expect(stat.lastModified).toBeInstanceOf(Date)
			expect(Math.abs(Date.now() - stat.lastModified.getTime())).toBeLessThan(5 * 60_000)

			const bytes = await readAll(await client.getObject(bucket, key))
			expect(bytes.equals(payload)).toBe(true)
		}
	})

	it('serves anonymous reads on the public bucket only', async () => {
		const open = await fetch(`${baseUrl}/${publicBucket}/${key}`)
		expect(open.status).toBe(200)
		expect(Buffer.from(await open.arrayBuffer()).equals(payload)).toBe(true)

		const closed = await fetch(`${baseUrl}/${privateBucket}/${key}`)
		expect(closed.status).toBe(403)
	})

	it('reports a missing key as NotFound / NoSuchKey', async () => {
		expect(['NotFound', 'NoSuchKey']).toContain(await codeOf(client.statObject(privateBucket, 'missing/key.pdf')))
		expect(await codeOf(client.getObject(privateBucket, 'missing/key.pdf'))).toBe('NoSuchKey')
	})

	it('removeObject resolves for an existing and a missing key', async () => {
		await expect(client.removeObject(publicBucket, key)).resolves.toBeUndefined()
		await expect(client.removeObject(publicBucket, key)).resolves.toBeUndefined()
		expect(['NotFound', 'NoSuchKey']).toContain(await codeOf(client.statObject(publicBucket, key)))
	})
})
