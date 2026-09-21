import { BucketVersioning, DbProvider } from '@storage/database'
import { TestDatabase, TestSeed } from '@storage/database/testing'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Readable } from 'stream'

import { StorageService } from '../storage/storage.service'
import { UsageService } from '../usage/usage.service'
import { UsageTypes } from '../usage/usage.types'
import { ObjectsService } from './objects.service'
import { ObjectsTypes } from './objects.types'

const mockDb = { core: {} } as unknown as DbProvider
const mockStorageService = { write: jest.fn(), read: jest.fn(), delete: jest.fn() }
const mockUsageService = { assertQuota: jest.fn() }

const bucket: ObjectsTypes.BucketContext = {
	guid: 'bucket-guid',
	versioning: BucketVersioning.disabled,
	ownerUserGuid: 'owner-guid',
	quotaBytes: null,
}

describe('ObjectsService', () => {
	let service: ObjectsService

	beforeEach(() => {
		jest.clearAllMocks()
		service = new ObjectsService(
			mockDb,
			mockStorageService as unknown as StorageService,
			mockUsageService as unknown as UsageService,
		)
	})

	/** These guards all run before the first DB or disk access, which is exactly the point:
	 *  a malformed request must not reach storage at all. */
	describe('key validation', () => {
		it('refuses an empty key', async () => {
			await expect(service.put({ bucket, key: '', stream: Readable.from([]) })).rejects.toThrow(ObjectsTypes.InvalidKeyError)
			expect(mockStorageService.write).not.toHaveBeenCalled()
		})

		it('refuses a key longer than S3 allows', async () => {
			await expect(service.put({ bucket, key: 'a'.repeat(1025), stream: Readable.from([]) })).rejects.toThrow(ObjectsTypes.InvalidKeyError)
		})

		it('refuses a key carrying control characters', async () => {
			const key = `a${String.fromCharCode(0)}b`
			await expect(service.put({ bucket, key, stream: Readable.from([]) })).rejects.toThrow(ObjectsTypes.InvalidKeyError)
		})

		it('accepts a key at the limit', async () => {
			mockUsageService.assertQuota.mockResolvedValue(undefined)
			mockStorageService.write.mockRejectedValue(new Error('storage reached'))

			// Getting as far as the storage write is what proves the key passed validation.
			await expect(service.put({ bucket, key: 'a'.repeat(1024), stream: Readable.from([]) })).rejects.toThrow('storage reached')
		})
	})

	describe('deleteByPrefix', () => {
		it('refuses an empty prefix rather than emptying the bucket', async () => {
			await expect(service.deleteByPrefix({ bucket, prefix: '' })).rejects.toThrow(ObjectsTypes.InvalidKeyError)
		})
	})

	describe('copyKeys', () => {
		it('refuses a copy onto itself', async () => {
			await expect(service.copyKeys({ source: bucket, target: bucket, sourceKey: 'a.txt', targetKey: 'a.txt' }))
				.rejects.toThrow(ObjectsTypes.InvalidKeyError)
		})

		it('refuses a folder moved inside itself', async () => {
			await expect(service.copyKeys({ source: bucket, target: bucket, sourceKey: 'docs/', targetKey: 'docs/archive/' }))
				.rejects.toThrow(ObjectsTypes.InvalidKeyError)
		})

		it('refuses an empty source or target', async () => {
			await expect(service.copyKeys({ source: bucket, target: bucket, sourceKey: '', targetKey: 'b.txt' }))
				.rejects.toThrow(ObjectsTypes.InvalidKeyError)
			await expect(service.copyKeys({ source: bucket, target: bucket, sourceKey: 'a.txt', targetKey: '' }))
				.rejects.toThrow(ObjectsTypes.InvalidKeyError)
		})

		it('allows the same key in a different bucket', async () => {
			const other: ObjectsTypes.BucketContext = { ...bucket, guid: 'other-guid' }
			jest.spyOn(service, 'getVersion').mockRejectedValue(new ObjectsTypes.ObjectNotFoundError())

			// Reaching the lookup means the guards let it through; the lookup itself is not the subject.
			await expect(service.copyKeys({ source: bucket, target: other, sourceKey: 'a.txt', targetKey: 'a.txt' }))
				.rejects.toThrow(ObjectsTypes.ObjectNotFoundError)
		})
	})
})

describe('DB', () => {
	let testDb: TestDatabase
	let seed: TestSeed
	let service: ObjectsService
	let storageService: StorageService
	let dataPath: string
	let owner: Awaited<ReturnType<TestSeed['user']>>

	const provider = () => ({ core: testDb.db }) as unknown as DbProvider

	beforeAll(async () => {
		testDb = await TestDatabase.connect()
	})

	afterAll(async () => {
		await testDb.close()
	})

	beforeEach(async () => {
		await testDb.truncate()
		dataPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'objects-test-'))

		seed = new TestSeed(testDb.db)
		owner = await seed.user()
		storageService = new StorageService({ dataPath, encryption: { enabled: false, masterKey: 'test-master-key-32-characters!!!' } })
		await storageService.onApplicationBootstrap()
		service = new ObjectsService(provider(), storageService, new UsageService(provider()))
	})

	afterEach(async () => {
		await fs.promises.rm(dataPath, { recursive: true, force: true })
	})

	/** The bucket the service is given, rather than the row - `put` takes a context, not a guid. */
	const makeBucket = async (versioning = BucketVersioning.disabled, quotaBytes: number | null = null) => {
		const row = await seed.bucket({ ownerUserGuid: owner.guid, versioning, quotaBytes })
		return { guid: row.guid, versioning, ownerUserGuid: owner.guid, quotaBytes, name: row.name }
	}

	const put = (context: ObjectsTypes.BucketContext, key: string, body = 'x') =>
		service.put({ bucket: context, key, stream: Readable.from([Buffer.from(body)]), declaredLength: body.length })

	const readAll = async (storagePath: string) => {
		const { stream } = await storageService.read(storagePath)
		const chunks: Buffer[] = []
		for await (const chunk of stream) chunks.push(chunk as Buffer)
		return Buffer.concat(chunks).toString()
	}

	describe('put', () => {
		it('records the version and makes it the key\'s latest', async () => {
			const context = await makeBucket()
			const written = await put(context, 'notes/a.txt', 'hello')

			const version = await service.getVersion({ bucketGuid: context.guid, key: 'notes/a.txt' })

			expect(version).toEqual(expect.objectContaining({
				key: 'notes/a.txt',
				versionId: ObjectsTypes.NULL_VERSION_ID,
				size: 5,
				etag: written.etag,
				isLatest: true,
				isDeleteMarker: false,
			}))
			expect(await readAll(version.storagePath ?? '')).toBe('hello')
		})

		/** An unversioned bucket keeps one row per key, so the second write has to replace the
		 *  first - and take its blob with it, or the disk grows on every overwrite. */
		it('replaces the null version in an unversioned bucket and drops the old blob', async () => {
			const context = await makeBucket()
			const first = await put(context, 'a.txt', 'first')
			const firstVersion = await service.getVersion({ bucketGuid: context.guid, key: 'a.txt' })

			await put(context, 'a.txt', 'second')
			const secondVersion = await service.getVersion({ bucketGuid: context.guid, key: 'a.txt' })

			expect(await service.listVersions({ bucketGuid: context.guid, key: 'a.txt' })).toHaveLength(1)
			expect(await readAll(secondVersion.storagePath ?? '')).toBe('second')
			expect(first.versionId).toBe(ObjectsTypes.NULL_VERSION_ID)
			await expect(storageService.size(firstVersion.storagePath ?? '')).rejects.toThrow()
		})

		it('keeps every version in a versioned bucket', async () => {
			const context = await makeBucket(BucketVersioning.enabled)
			const first = await put(context, 'a.txt', 'one')
			const second = await put(context, 'a.txt', 'two')

			expect(first.versionId).not.toBe(second.versionId)

			const versions = await service.listVersions({ bucketGuid: context.guid, key: 'a.txt' })
			expect(versions).toHaveLength(2)
			expect(versions.filter((version) => version.isLatest)).toHaveLength(1)

			const older = await service.getVersion({ bucketGuid: context.guid, key: 'a.txt', versionId: first.versionId })
			expect(await readAll(older.storagePath ?? '')).toBe('one')
		})

		it('refuses a payload whose Content-MD5 does not match, and stores nothing', async () => {
			const context = await makeBucket()

			await expect(service.put({
				bucket: context,
				key: 'a.txt',
				stream: Readable.from([Buffer.from('hello')]),
				contentMd5: Buffer.from('0'.repeat(32), 'hex').toString('base64'),
			})).rejects.toThrow(ObjectsTypes.BadDigestError)

			await expect(service.getVersion({ bucketGuid: context.guid, key: 'a.txt' })).rejects.toThrow(ObjectsTypes.ObjectNotFoundError)
		})

		it('refuses a write that would exceed the bucket quota', async () => {
			const context = await makeBucket(BucketVersioning.disabled, 4)

			await expect(put(context, 'a.txt', 'far too long')).rejects.toThrow(UsageTypes.BucketQuotaExceededError)
		})
	})

	describe('getVersion', () => {
		it('reports a missing key and a missing version differently', async () => {
			const context = await makeBucket(BucketVersioning.enabled)
			await put(context, 'a.txt')

			await expect(service.getVersion({ bucketGuid: context.guid, key: 'nope.txt' })).rejects.toThrow(ObjectsTypes.ObjectNotFoundError)
			await expect(service.getVersion({ bucketGuid: context.guid, key: 'a.txt', versionId: 'made-up' })).rejects.toThrow(ObjectsTypes.VersionNotFoundError)
		})
	})

	describe('delete', () => {
		it('removes the key outright in an unversioned bucket', async () => {
			const context = await makeBucket()
			await put(context, 'a.txt')

			const result = await service.delete({ bucket: context, key: 'a.txt' })

			expect(result.isDeleteMarker).toBe(false)
			await expect(service.getVersion({ bucketGuid: context.guid, key: 'a.txt' })).rejects.toThrow(ObjectsTypes.ObjectNotFoundError)
			await expect(service.countKeys(context.guid)).resolves.toBe(0)
		})

		it('hides the key behind a delete marker in a versioned bucket', async () => {
			const context = await makeBucket(BucketVersioning.enabled)
			await put(context, 'a.txt', 'content')

			const result = await service.delete({ bucket: context, key: 'a.txt' })

			expect(result.isDeleteMarker).toBe(true)
			const latest = await service.getVersion({ bucketGuid: context.guid, key: 'a.txt' })
			expect(latest.isDeleteMarker).toBe(true)
			// The content is still there, one version down.
			expect(await service.listVersions({ bucketGuid: context.guid, key: 'a.txt' })).toHaveLength(2)
		})

		it('removes one named version and points the key at what is left', async () => {
			const context = await makeBucket(BucketVersioning.enabled)
			const first = await put(context, 'a.txt', 'one')
			await put(context, 'a.txt', 'two')

			await service.delete({ bucket: context, key: 'a.txt', versionId: first.versionId })

			const versions = await service.listVersions({ bucketGuid: context.guid, key: 'a.txt' })
			expect(versions).toHaveLength(1)
			expect(versions[0].isLatest).toBe(true)
		})

		it('treats deleting a key that is not there as a success', async () => {
			const context = await makeBucket()
			await expect(service.delete({ bucket: context, key: 'never-existed' })).resolves.toEqual({ isDeleteMarker: false })
		})

		it('deletes every key under a prefix', async () => {
			const context = await makeBucket()
			await put(context, 'docs/a.txt')
			await put(context, 'docs/b.txt')
			await put(context, 'other.txt')

			const result = await service.deleteByPrefix({ bucket: context, prefix: 'docs/' })

			expect(result.deletedCount).toBe(2)
			await expect(service.countKeys(context.guid)).resolves.toBe(1)
		})
	})

	describe('list', () => {
		/** S3 orders by raw UTF-8 bytes; Postgres' default collation does not, which is why
		 *  every key comparison is forced to `COLLATE "C"`. These keys sort differently under
		 *  the two, so the assertion fails the moment the collation is dropped. */
		it('orders keys by their bytes and not by the database locale', async () => {
			const context = await makeBucket()
			for (const key of ['b.txt', 'B.txt', 'a.txt', 'A.txt', '_x.txt']) await put(context, key)

			const result = await service.list({ bucketGuid: context.guid })

			expect(result.objects.map((object) => object.key)).toEqual(['A.txt', 'B.txt', '_x.txt', 'a.txt', 'b.txt'])
		})

		it('restricts a listing to a prefix', async () => {
			const context = await makeBucket()
			await put(context, 'docs/a.txt')
			await put(context, 'images/b.png')

			const result = await service.list({ bucketGuid: context.guid, prefix: 'docs/' })

			expect(result.objects.map((object) => object.key)).toEqual(['docs/a.txt'])
		})

		it('escapes a prefix so wildcards in it are literal', async () => {
			const context = await makeBucket()
			await put(context, '100%/a.txt')
			await put(context, '100x/b.txt')

			const result = await service.list({ bucketGuid: context.guid, prefix: '100%' })

			expect(result.objects.map((object) => object.key)).toEqual(['100%/a.txt'])
		})

		it('collapses a delimiter into common prefixes', async () => {
			const context = await makeBucket()
			await put(context, 'docs/a.txt')
			await put(context, 'docs/b.txt')
			await put(context, 'docs/deep/c.txt')
			await put(context, 'root.txt')

			const result = await service.list({ bucketGuid: context.guid, delimiter: '/' })

			expect(result.commonPrefixes).toEqual(['docs/'])
			expect(result.objects.map((object) => object.key)).toEqual(['root.txt'])
		})

		it('counts keys and folders together towards max-keys', async () => {
			const context = await makeBucket()
			await put(context, 'a/1.txt')
			await put(context, 'b/1.txt')
			await put(context, 'c.txt')

			const result = await service.list({ bucketGuid: context.guid, delimiter: '/', maxKeys: 2 })

			expect(result.commonPrefixes.length + result.objects.length).toBe(2)
			expect(result.isTruncated).toBe(true)
		})

		it('walks every key across pages without repeating or dropping one', async () => {
			const context = await makeBucket()
			const keys = Array.from({ length: 7 }, (_, index) => `key-${index}.txt`)
			for (const key of keys) await put(context, key)

			const seen: string[] = []
			let continuationToken: string | undefined

			do {
				const page = await service.list({ bucketGuid: context.guid, maxKeys: 3, continuationToken })
				seen.push(...page.objects.map((object) => object.key))
				continuationToken = page.nextContinuationToken
			} while (continuationToken)

			expect(seen).toEqual(keys)
		})

		/** A page that ends on a collapsed folder has to resume after the whole folder, not
		 *  after the one key that produced it. */
		it('resumes after a folder when a page ended on one', async () => {
			const context = await makeBucket()
			await put(context, 'a/1.txt')
			await put(context, 'a/2.txt')
			await put(context, 'a/3.txt')
			await put(context, 'b.txt')

			const first = await service.list({ bucketGuid: context.guid, delimiter: '/', maxKeys: 1 })
			expect(first.commonPrefixes).toEqual(['a/'])
			expect(first.isTruncated).toBe(true)

			const second = await service.list({
				bucketGuid: context.guid, delimiter: '/', maxKeys: 10, continuationToken: first.nextContinuationToken,
			})
			expect(second.objects.map((object) => object.key)).toEqual(['b.txt'])
			expect(second.isTruncated).toBe(false)
		})

		it('resumes after a plain key with start-after', async () => {
			const context = await makeBucket()
			await put(context, 'a.txt')
			await put(context, 'b.txt')
			await put(context, 'c.txt')

			const result = await service.list({ bucketGuid: context.guid, startAfter: 'a.txt' })

			expect(result.objects.map((object) => object.key)).toEqual(['b.txt', 'c.txt'])
		})

		it('leaves out a key hidden by a delete marker', async () => {
			const context = await makeBucket(BucketVersioning.enabled)
			await put(context, 'a.txt')
			await put(context, 'b.txt')
			await service.delete({ bucket: context, key: 'a.txt' })

			const result = await service.list({ bucketGuid: context.guid })

			expect(result.objects.map((object) => object.key)).toEqual(['b.txt'])
		})
	})

	describe('listAllVersions', () => {
		it('lists every version of every key, newest first within a key', async () => {
			const context = await makeBucket(BucketVersioning.enabled)
			await put(context, 'a.txt', 'one')
			await put(context, 'a.txt', 'two')
			await put(context, 'b.txt', 'only')

			const result = await service.listAllVersions({ bucketGuid: context.guid })

			expect(result.versions.map((version) => version.key)).toEqual(['a.txt', 'a.txt', 'b.txt'])
			expect(result.versions[0].isLatest).toBe(true)
			expect(result.versions[1].isLatest).toBe(false)
		})

		it('includes delete markers', async () => {
			const context = await makeBucket(BucketVersioning.enabled)
			await put(context, 'a.txt')
			await service.delete({ bucket: context, key: 'a.txt' })

			const result = await service.listAllVersions({ bucketGuid: context.guid })

			expect(result.versions.filter((version) => version.isDeleteMarker)).toHaveLength(1)
		})
	})

	describe('multipart upload', () => {
		const PART = 'p'.repeat(ObjectsTypes.MIN_PART_SIZE)

		const uploadPart = (context: ObjectsTypes.BucketContext, uploadId: string, partNumber: number, body: string) =>
			service.uploadPart({ bucket: context, uploadId, partNumber, stream: Readable.from([Buffer.from(body)]) })

		it('assembles the parts and gives the object a multipart ETag', async () => {
			const context = await makeBucket()
			const uploadId = await service.createMultipartUpload({ bucket: context, key: 'big.bin' })

			const first = await uploadPart(context, uploadId, 1, PART)
			const second = await uploadPart(context, uploadId, 2, 'tail')

			const completed = await service.completeMultipartUpload({
				bucket: context,
				uploadId,
				parts: [{ partNumber: 1, etag: first.etag }, { partNumber: 2, etag: second.etag }],
			})

			expect(completed.etag).toMatch(/-2$/)
			expect(completed.size).toBe(PART.length + 4)

			const version = await service.getVersion({ bucketGuid: context.guid, key: 'big.bin' })
			expect(await readAll(version.storagePath ?? '')).toBe(`${PART}tail`)
		})

		// Both parts are full size, so the only rule left to break is the ordering one.
		it('refuses parts listed out of order', async () => {
			const context = await makeBucket()
			const uploadId = await service.createMultipartUpload({ bucket: context, key: 'big.bin' })
			const first = await uploadPart(context, uploadId, 1, PART)
			const second = await uploadPart(context, uploadId, 2, PART)

			await expect(service.completeMultipartUpload({
				bucket: context,
				uploadId,
				parts: [{ partNumber: 2, etag: second.etag }, { partNumber: 1, etag: first.etag }],
			})).rejects.toThrow(ObjectsTypes.InvalidPartOrderError)
		})

		it('refuses a part whose ETag does not match what was stored', async () => {
			const context = await makeBucket()
			const uploadId = await service.createMultipartUpload({ bucket: context, key: 'big.bin' })
			await uploadPart(context, uploadId, 1, PART)

			await expect(service.completeMultipartUpload({
				bucket: context, uploadId, parts: [{ partNumber: 1, etag: '0'.repeat(32) }],
			})).rejects.toThrow(ObjectsTypes.InvalidPartError)
		})

		it('refuses a part below the minimum size when it is not the last one', async () => {
			const context = await makeBucket()
			const uploadId = await service.createMultipartUpload({ bucket: context, key: 'big.bin' })
			const first = await uploadPart(context, uploadId, 1, 'tiny')
			const second = await uploadPart(context, uploadId, 2, 'tail')

			await expect(service.completeMultipartUpload({
				bucket: context,
				uploadId,
				parts: [{ partNumber: 1, etag: first.etag }, { partNumber: 2, etag: second.etag }],
			})).rejects.toThrow(ObjectsTypes.PartTooSmallError)
		})

		it('replaces a part number that is uploaded twice', async () => {
			const context = await makeBucket()
			const uploadId = await service.createMultipartUpload({ bucket: context, key: 'big.bin' })
			await uploadPart(context, uploadId, 1, 'first attempt')
			const second = await uploadPart(context, uploadId, 1, 'second attempt')

			const listed = await service.listParts({ bucketGuid: context.guid, uploadId })

			expect(listed.parts).toHaveLength(1)
			expect(listed.parts[0].etag).toBe(second.etag)
		})

		it('forgets an aborted upload and its parts', async () => {
			const context = await makeBucket()
			const uploadId = await service.createMultipartUpload({ bucket: context, key: 'big.bin' })
			await uploadPart(context, uploadId, 1, PART)

			await service.abortMultipartUpload({ bucketGuid: context.guid, uploadId })

			await expect(service.listParts({ bucketGuid: context.guid, uploadId })).rejects.toThrow(ObjectsTypes.UploadNotFoundError)
			await expect(service.listMultipartUploads({ bucketGuid: context.guid })).resolves.toEqual(
				expect.objectContaining({ uploads: [] }),
			)
		})

		it('lists uploads that are still in progress', async () => {
			const context = await makeBucket()
			await service.createMultipartUpload({ bucket: context, key: 'one.bin' })
			await service.createMultipartUpload({ bucket: context, key: 'two.bin' })

			const listed = await service.listMultipartUploads({ bucketGuid: context.guid })

			expect(listed.uploads.map((upload) => upload.key)).toEqual(['one.bin', 'two.bin'])
		})

		it('does not find an upload through another bucket', async () => {
			const context = await makeBucket()
			const other = await makeBucket()
			const uploadId = await service.createMultipartUpload({ bucket: context, key: 'big.bin' })

			await expect(service.listParts({ bucketGuid: other.guid, uploadId })).rejects.toThrow(ObjectsTypes.UploadNotFoundError)
		})
	})

	describe('createFolder', () => {
		it('writes the empty marker object S3 consoles use', async () => {
			const context = await makeBucket()
			const created = await service.createFolder({ bucket: context, key: 'docs' })

			expect(created.key).toBe('docs/')
			const version = await service.getVersion({ bucketGuid: context.guid, key: 'docs/' })
			expect(version.size).toBe(0)
			expect(version.contentType).toBe('application/x-directory')
		})

		it('refuses a folder that is already there', async () => {
			const context = await makeBucket()
			await service.createFolder({ bucket: context, key: 'docs' })

			await expect(service.createFolder({ bucket: context, key: 'docs/' })).rejects.toThrow(ObjectsTypes.ObjectAlreadyExistsError)
		})
	})

	describe('copyKeys', () => {
		it('copies one key', async () => {
			const context = await makeBucket()
			await put(context, 'a.txt', 'content')

			await service.copyKeys({ source: context, target: context, sourceKey: 'a.txt', targetKey: 'b.txt' })

			const copied = await service.getVersion({ bucketGuid: context.guid, key: 'b.txt' })
			expect(await readAll(copied.storagePath ?? '')).toBe('content')
			await expect(service.getVersion({ bucketGuid: context.guid, key: 'a.txt' })).resolves.toBeDefined()
		})

		it('re-keys a whole folder', async () => {
			const context = await makeBucket()
			await put(context, 'docs/a.txt', 'one')
			await put(context, 'docs/deep/b.txt', 'two')

			const result = await service.copyKeys({ source: context, target: context, sourceKey: 'docs/', targetKey: 'archive/' })

			expect(result.copiedCount).toBe(2)
			await expect(service.getVersion({ bucketGuid: context.guid, key: 'archive/a.txt' })).resolves.toBeDefined()
			await expect(service.getVersion({ bucketGuid: context.guid, key: 'archive/deep/b.txt' })).resolves.toBeDefined()
		})

		it('removes the source when it is a move', async () => {
			const context = await makeBucket()
			await put(context, 'a.txt', 'content')

			await service.copyKeys({ source: context, target: context, sourceKey: 'a.txt', targetKey: 'b.txt', move: true })

			await expect(service.getVersion({ bucketGuid: context.guid, key: 'a.txt' })).rejects.toThrow(ObjectsTypes.ObjectNotFoundError)
			await expect(service.getVersion({ bucketGuid: context.guid, key: 'b.txt' })).resolves.toBeDefined()
		})

		it('copies between buckets', async () => {
			const source = await makeBucket()
			const target = await makeBucket()
			await put(source, 'a.txt', 'content')

			await service.copyKeys({ source, target, sourceKey: 'a.txt', targetKey: 'a.txt' })

			const copied = await service.getVersion({ bucketGuid: target.guid, key: 'a.txt' })
			expect(await readAll(copied.storagePath ?? '')).toBe('content')
		})

		it('refuses a source key that is not there', async () => {
			const context = await makeBucket()
			await expect(service.copyKeys({ source: context, target: context, sourceKey: 'nope.txt', targetKey: 'b.txt' }))
				.rejects.toThrow(ObjectsTypes.ObjectNotFoundError)
		})
	})
})
