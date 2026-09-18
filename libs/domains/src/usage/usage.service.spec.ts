import { DbProvider } from '@storage/database'

import { UsageService } from './usage.service'
import { UsageTypes } from './usage.types'

const mockDb = { core: { select: jest.fn() } } as unknown as DbProvider

describe('UsageService', () => {
	let service: UsageService

	beforeEach(() => {
		jest.clearAllMocks()
		service = new UsageService(mockDb)
	})

	const makeUsage = (totalBytes: number): UsageTypes.Usage => ({
		objectCount: 1,
		versionCount: 1,
		versionBytes: totalBytes,
		multipartBytes: 0,
		totalBytes,
	})

	/** `assertQuota` reads the owner's limit straight from the user table, so the one DB call it
	 *  makes is stubbed at the end of the builder chain. */
	const ownerQuota = (quotaBytes: number | null) => {
		const rows = [{ quotaBytes }]
		const chain = { from: () => chain, where: () => chain, limit: () => Promise.resolve(rows) }
		;(mockDb.core.select as jest.Mock).mockReturnValue(chain)
	}

	describe('assertQuota', () => {
		const bucket: UsageTypes.QuotaTarget = { guid: 'bucket-guid', ownerUserGuid: 'owner-guid', quotaBytes: null }

		it('allows any write when neither quota is set', async () => {
			ownerQuota(null)

			await expect(service.assertQuota({ bucket, bytes: 10_000 })).resolves.toBeUndefined()
		})

		it('rejects a write that would exceed the bucket quota', async () => {
			ownerQuota(null)
			jest.spyOn(service, 'bucketUsage').mockResolvedValue(makeUsage(900))

			await expect(service.assertQuota({ bucket: { ...bucket, quotaBytes: 1000 }, bytes: 101 }))
				.rejects.toThrow(UsageTypes.BucketQuotaExceededError)
		})

		it('allows a write that exactly fills the bucket quota', async () => {
			ownerQuota(null)
			jest.spyOn(service, 'bucketUsage').mockResolvedValue(makeUsage(900))

			await expect(service.assertQuota({ bucket: { ...bucket, quotaBytes: 1000 }, bytes: 100 })).resolves.toBeUndefined()
		})

		it('rejects a write that would exceed the owner quota', async () => {
			ownerQuota(5000)
			jest.spyOn(service, 'userUsage').mockResolvedValue(makeUsage(4999))

			await expect(service.assertQuota({ bucket, bytes: 2 })).rejects.toThrow(UsageTypes.UserQuotaExceededError)
		})

		it('checks the owner quota even when the bucket has none', async () => {
			ownerQuota(5000)
			const userUsage = jest.spyOn(service, 'userUsage').mockResolvedValue(makeUsage(10))

			await expect(service.assertQuota({ bucket, bytes: 10 })).resolves.toBeUndefined()
			expect(userUsage).toHaveBeenCalledWith('owner-guid')
		})
	})
})
