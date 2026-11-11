import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Readable } from 'stream'

import { StorageService } from './storage.service'
import { StorageTypes } from './storage.types'

const MASTER_KEY = 'test-master-key-at-least-32-chars'

/** The blob store is the one part of the system with no database in it, so it is tested against
 *  a real directory rather than against mocks: what is being asserted is what ends up on disk. */
describe('StorageService', () => {
	let dataPath: string

	beforeEach(async () => {
		jest.clearAllMocks()
		dataPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'storage-test-'))
	})

	afterEach(async () => {
		await fs.promises.rm(dataPath, { recursive: true, force: true })
	})

	const makeService = (encryption = false) =>
		new StorageService({ dataPath, encryption: { enabled: encryption, masterKey: MASTER_KEY } })

	const collect = async (stream: Readable): Promise<Buffer> => {
		const chunks: Buffer[] = []
		for await (const chunk of stream) chunks.push(chunk as Buffer)
		return Buffer.concat(chunks)
	}

	const write = (service: StorageService, payload: Buffer, options?: StorageTypes.WriteOptions) =>
		service.write(Readable.from([payload]), options)

	/** Long enough to span many cipher blocks and to make an unaligned range meaningful. */
	const payloadOf = (bytes: number) => crypto.randomBytes(bytes)

	describe.each([
		['unencrypted', false],
		['encrypted', true],
	])('%s', (_label, encrypted) => {
		let service: StorageService

		beforeEach(async () => {
			service = makeService(encrypted)
			await service.onApplicationBootstrap()
		})

		it('reports the plaintext size and MD5 of what was written', async () => {
			const payload = payloadOf(4_096)
			const written = await write(service, payload)

			expect(written.size).toBe(payload.length)
			expect(written.etag).toBe(crypto.createHash('md5').update(payload).digest('hex'))
		})

		it('reads back exactly what was written', async () => {
			const payload = payloadOf(10_000)
			const written = await write(service, payload)

			const result = await service.read(written.storagePath, { encryption: written.encryption })

			expect(result.size).toBe(payload.length)
			expect(await collect(result.stream)).toEqual(payload)
		})

		it('gives each write its own path', async () => {
			const first = await write(service, payloadOf(16))
			const second = await write(service, payloadOf(16))

			expect(first.storagePath).not.toBe(second.storagePath)
		})

		it('stores an empty payload as an empty blob', async () => {
			const written = await write(service, Buffer.alloc(0))

			expect(written.size).toBe(0)
			const result = await service.read(written.storagePath, { encryption: written.encryption })
			expect(await collect(result.stream)).toEqual(Buffer.alloc(0))
		})

		describe('ranges', () => {
			// 16 is the cipher block size, so these deliberately straddle block boundaries:
			// an encrypted range has to start on a block and drop the surplus itself.
			it.each([
				['from the start', 0, 9],
				['unaligned start', 5, 20],
				['exactly one block', 16, 31],
				['spanning blocks', 100, 999],
				['to the last byte', 5_000 - 3, 5_000 - 1],
				['a single byte', 4_321, 4_321],
			])('reads %s', async (_name, start, end) => {
				const payload = payloadOf(5_000)
				const written = await write(service, payload)

				const result = await service.read(written.storagePath, { range: { start, end }, encryption: written.encryption })

				expect(result.size).toBe(end - start + 1)
				expect(await collect(result.stream)).toEqual(payload.subarray(start, end + 1))
			})
		})

		describe('concat', () => {
			it('joins parts in the order it is given them', async () => {
				const parts = [payloadOf(2_000), payloadOf(3_000), payloadOf(1_000)]
				const written = await Promise.all(parts.map((part) => write(service, part)))

				const joined = await service.concat(written.map((part) => ({
					storagePath: part.storagePath,
					encryption: part.encryption,
				})))

				const expected = Buffer.concat(parts)
				expect(joined.size).toBe(expected.length)
				expect(joined.etag).toBe(crypto.createHash('md5').update(expected).digest('hex'))

				const result = await service.read(joined.storagePath, { encryption: joined.encryption })
				expect(await collect(result.stream)).toEqual(expected)
			})

			it('leaves the source parts in place for the caller to delete', async () => {
				const first = await write(service, payloadOf(64))
				await service.concat([{ storagePath: first.storagePath, encryption: first.encryption }])

				await expect(service.size(first.storagePath)).resolves.toBe(64)
			})
		})

		describe('delete', () => {
			it('removes the blob', async () => {
				const written = await write(service, payloadOf(32))
				await service.delete(written.storagePath)

				await expect(service.read(written.storagePath)).rejects.toThrow(StorageTypes.BlobNotFoundError)
			})

			it('is a no-op on a path that is already gone', async () => {
				await expect(service.delete('aa/bb/does-not-exist')).resolves.toBeUndefined()
			})
		})

		describe('maxBytes', () => {
			it('accepts a payload exactly at the ceiling', async () => {
				const payload = payloadOf(1_024)
				await expect(write(service, payload, { maxBytes: 1_024 })).resolves.toEqual(
					expect.objectContaining({ size: 1_024 }),
				)
			})

			it('refuses a payload over the ceiling and leaves nothing behind', async () => {
				const before = await countBlobs(dataPath)

				await expect(write(service, payloadOf(2_048), { maxBytes: 1_024 }))
					.rejects.toThrow(StorageTypes.PayloadTooLargeError)

				expect(await countBlobs(dataPath)).toBe(before)
			})
		})

		it('refuses a storage path that would escape the data root', async () => {
			await expect(service.read('../../etc/passwd')).rejects.toThrow('outside of data root')
		})
	})

	describe('encryption', () => {
		it('does not leave the payload readable on disk', async () => {
			const service = makeService(true)
			await service.onApplicationBootstrap()

			const payload = Buffer.from('a very recognisable secret'.repeat(40))
			const written = await write(service, payload)

			const onDisk = await fs.promises.readFile(path.join(dataPath, written.storagePath))
			expect(onDisk).not.toEqual(payload)
			expect(onDisk.includes('recognisable')).toBe(false)
			expect(written.encryption?.algorithm).toBe('AES256')
		})

		it('records no key when encryption is off', async () => {
			const service = makeService(false)
			await service.onApplicationBootstrap()

			const written = await write(service, payloadOf(64))
			expect(written.encryption).toBeUndefined()
		})

		it('keeps objects written before encryption was switched on readable', async () => {
			const plain = makeService(false)
			await plain.onApplicationBootstrap()

			const payload = payloadOf(1_000)
			const written = await write(plain, payload)

			// The same data root, now with encryption on: the old blob carries no descriptor,
			// which is what tells the service to read it as it is.
			const encrypting = makeService(true)
			await encrypting.onApplicationBootstrap()

			const result = await encrypting.read(written.storagePath, { encryption: written.encryption })
			expect(await collect(result.stream)).toEqual(payload)
		})

		it('cannot open a blob under a different master key', async () => {
			const service = makeService(true)
			await service.onApplicationBootstrap()
			const written = await write(service, payloadOf(64))

			const other = new StorageService({ dataPath, encryption: { enabled: true, masterKey: 'a-completely-different-master-key' } })

			await expect(other.read(written.storagePath, { encryption: written.encryption }))
				.rejects.toThrow(StorageTypes.EncryptionKeyError)
		})

		it('gives two writes of the same bytes different ciphertext', async () => {
			const service = makeService(true)
			await service.onApplicationBootstrap()

			const payload = payloadOf(512)
			const first = await write(service, payload)
			const second = await write(service, payload)

			const firstBytes = await fs.promises.readFile(path.join(dataPath, first.storagePath))
			const secondBytes = await fs.promises.readFile(path.join(dataPath, second.storagePath))

			expect(firstBytes).not.toEqual(secondBytes)
		})
	})

	describe('assertWritable', () => {
		it('passes on a writable data root and leaves no probe behind', async () => {
			const service = makeService()
			await service.onApplicationBootstrap()

			await expect(service.assertWritable()).resolves.toBeUndefined()
			expect(await fs.promises.readdir(dataPath)).toEqual([])
		})

		it('fails when the data root is not there', async () => {
			const service = new StorageService({
				dataPath: path.join(dataPath, 'never-created'),
				encryption: { enabled: false, masterKey: MASTER_KEY },
			})

			await expect(service.assertWritable()).rejects.toThrow()
		})
	})

	describe('listBlobs', () => {
		it('yields every stored blob with its size', async () => {
			const service = makeService()
			await service.onApplicationBootstrap()

			const written = await Promise.all([write(service, payloadOf(10)), write(service, payloadOf(20))])

			const found = []
			for await (const blob of service.listBlobs()) found.push(blob)

			expect(found.map((blob) => blob.storagePath).sort()).toEqual(written.map((blob) => blob.storagePath).sort())
			expect(found.map((blob) => blob.size).sort()).toEqual([10, 20])
		})

		it('yields nothing for an empty data root', async () => {
			const service = makeService()
			await service.onApplicationBootstrap()

			const found = []
			for await (const blob of service.listBlobs()) found.push(blob)

			expect(found).toEqual([])
		})
	})
})

/** Counts the files under the two-level shard layout, to show a failed write left nothing. */
async function countBlobs(dataPath: string): Promise<number> {
	let total = 0

	for (const first of await fs.promises.readdir(dataPath).catch(() => [])) {
		for (const second of await fs.promises.readdir(path.join(dataPath, first)).catch(() => [])) {
			total += (await fs.promises.readdir(path.join(dataPath, first, second)).catch(() => [])).length
		}
	}

	return total
}
