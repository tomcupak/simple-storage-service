import { Readable } from 'stream'

import { ThumbnailsService } from './thumbnails.service'
import { sharp } from './thumbnails.sharp'
import { ThumbnailsTypes } from './thumbnails.types'

const service = new ThumbnailsService({ maxSourceBytes: 1000 })

async function makeImage({ width, height, format = 'png', orientation }: { width: number, height: number, format?: 'png' | 'jpeg', orientation?: number }): Promise<Buffer> {
	let image = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } })
	if (orientation) image = image.withMetadata({ orientation })
	return format === 'jpeg' ? image.jpeg().toBuffer() : image.png().toBuffer()
}

async function meta(buffer: Buffer) {
	return sharp(buffer).metadata()
}

describe('ThumbnailsService', () => {
	it('fits a large image inside the box, keeping the aspect, as webp', async () => {
		const source = await makeImage({ width: 400, height: 200 })

		const out = await service.render({ stream: Readable.from(source), contentType: 'image/png', size: 128 })
		const info = await meta(out)

		expect(info.format).toBe('webp')
		expect(info.width).toBe(128)
		expect(info.height).toBe(64)
	})

	it('never upscales a small image', async () => {
		const source = await makeImage({ width: 50, height: 30 })

		const info = await meta(await service.render({ stream: Readable.from(source), contentType: 'image/png', size: 512 }))

		expect(info).toEqual(expect.objectContaining({ width: 50, height: 30 }))
	})

	it('applies the EXIF orientation', async () => {
		const source = await makeImage({ width: 200, height: 100, format: 'jpeg', orientation: 6 })

		const info = await meta(await service.render({ stream: Readable.from(source), contentType: 'image/jpeg', size: 512 }))

		expect(info).toEqual(expect.objectContaining({ width: 100, height: 200 }))
	})

	it('accepts a content type with parameters and different case', async () => {
		const source = await makeImage({ width: 10, height: 10 })

		await expect(service.render({ stream: Readable.from(source), contentType: 'IMAGE/PNG; foo=bar', size: 128 })).resolves.toBeInstanceOf(Buffer)
	})

	it.each(['image/svg+xml', 'image/heic', 'application/pdf', null])('refuses %s and destroys the stream', async (contentType) => {
		const stream = Readable.from(Buffer.from('x'))

		await expect(service.render({ stream, contentType, size: 128 })).rejects.toThrow(ThumbnailsTypes.ThumbnailUnsupportedError)
		expect(stream.destroyed).toBe(true)
	})

	it('maps a payload that does not decode to the unsupported error', async () => {
		const stream = Readable.from(Buffer.from('this is not an image'))

		await expect(service.render({ stream, contentType: 'image/png', size: 128 })).rejects.toThrow(ThumbnailsTypes.ThumbnailUnsupportedError)
		expect(stream.destroyed).toBe(true)
	})

	it('rethrows a failure of the source stream as is', async () => {
		const boom = new Error('disk gone')
		const stream = new Readable({ read() { this.destroy(boom) } })

		await expect(service.render({ stream, contentType: 'image/png', size: 128 })).rejects.toBe(boom)
	})

	it('refuses SVG bytes declared as a supported type', async () => {
		const stream = Readable.from(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'))

		await expect(service.render({ stream, contentType: 'image/jpeg', size: 128 })).rejects.toThrow(ThumbnailsTypes.ThumbnailUnsupportedError)
		expect(stream.destroyed).toBe(true)
	})

	it('picks the format from the bytes, not the declared type', async () => {
		const source = await makeImage({ width: 300, height: 300 })

		const info = await meta(await service.render({ stream: Readable.from(source), contentType: 'image/jpeg', size: 128 }))

		expect(info).toEqual(expect.objectContaining({ width: 128, height: 128 }))
	})

	it('renders a large multi-chunk payload past the sniffed head', async () => {
		const source = await makeImage({ width: 600, height: 400, format: 'jpeg' })
		const chunks = Array.from({ length: Math.ceil(source.length / 10) }, (_, i) => source.subarray(i * 10, (i + 1) * 10))

		const info = await meta(await service.render({ stream: Readable.from(chunks), contentType: 'image/jpeg', size: 128 }))

		expect(info).toEqual(expect.objectContaining({ width: 128, height: 85 }))
	})

	it('accepts a generic content type when the key has an image extension', async () => {
		expect(service.isSupported(null, 'a/b/Photo.JPG')).toBe(true)
		expect(service.isSupported('application/octet-stream', 'x.tiff')).toBe(true)
		expect(service.isSupported('binary/octet-stream', 'x.png')).toBe(true)
		expect(service.isSupported('application/octet-stream', 'x.svg')).toBe(false)
		expect(service.isSupported('application/pdf', 'x.png')).toBe(false)
		expect(service.isSupported(null)).toBe(false)

		const source = await makeImage({ width: 10, height: 10 })
		await expect(service.render({ stream: Readable.from(source), contentType: null, size: 128, key: 'x.png' })).resolves.toBeInstanceOf(Buffer)
	})

	it('recognises AVIF by its major or compatible brand', () => {
		const header = (major: string, compatible: string) => {
			const head = Buffer.alloc(24)
			head.writeUInt32BE(24, 0)
			head.write('ftyp', 4, 'latin1')
			head.write(major, 8, 'latin1')
			head.write(compatible, 16, 'latin1')
			return head
		}

		expect(service['isRasterHeader'](header('avif', 'mif1'))).toBe(true)
		expect(service['isRasterHeader'](header('mif1', 'avif'))).toBe(true)
		expect(service['isRasterHeader'](header('heic', 'mif1'))).toBe(false)
	})

	it('matches If-None-Match as a list, ignoring W/', () => {
		expect(service.matchesEtag('"a-t128"', '"a-t128"')).toBe(true)
		expect(service.matchesEtag('"x", W/"a-t128"', '"a-t128"')).toBe(true)
		expect(service.matchesEtag('"x"', '"a-t128"')).toBe(false)
		expect(service.matchesEtag(undefined, '"a-t128"')).toBe(false)
	})

	it('refuses a source above the ceiling', () => {
		expect(() => service.assertSourceSize(1001)).toThrow(ThumbnailsTypes.ThumbnailSourceTooLargeError)
		expect(() => service.assertSourceSize(1000)).not.toThrow()
	})
})
