import { BucketVersioning, DbProvider } from '@storage/database'
import { Readable } from 'stream'

import { StorageService } from '../storage/storage.service'
import { UsageService } from '../usage/usage.service'
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
