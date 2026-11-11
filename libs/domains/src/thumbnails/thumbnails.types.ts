export namespace ThumbnailsTypes {
	export interface Config {
		/** Largest source object a thumbnail is rendered from. Decoding is the expensive part
		 *  and its cost follows the source, so this bounds what one request can make the
		 *  server do. */
		maxSourceBytes: number
	}

	/** Edge lengths, in pixels, a thumbnail may be asked for. A fixed set rather than any
	 *  number, so a caller cannot make the server render an arbitrary size per request. */
	export const SIZES = [128, 512] as const
	export type Size = typeof SIZES[number]
	export const DEFAULT_SIZE: Size = 128

	/** Raster formats the prebuilt sharp decodes. SVG is left out on purpose: rendering an
	 *  untrusted vector document server-side is attack surface (external references, huge
	 *  expansion) that a file browser preview does not justify. HEIC/HEIF is left out because
	 *  the prebuilt libvips ships without an HEVC decoder. */
	export const SUPPORTED_CONTENT_TYPES: readonly string[] = [
		'image/jpeg',
		'image/png',
		'image/webp',
		'image/gif',
		'image/avif',
		'image/tiff',
	]

	/** Content types that say nothing about the payload; the key's extension is then the hint. */
	export const GENERIC_CONTENT_TYPES: readonly string[] = ['', 'application/octet-stream', 'binary/octet-stream']

	export const SUPPORTED_EXTENSIONS: readonly string[] = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'tif', 'tiff']

	/** Bytes read from the head of the payload to recognise its real format. */
	export const SNIFF_BYTES = 64

	/** Decoder ceiling in pixels: a small file can still declare an enormous canvas. */
	export const MAX_INPUT_PIXELS = 200_000_000

	export const OUTPUT_QUALITY = 75
	export const OUTPUT_CONTENT_TYPE = 'image/webp'

	/** Not a raster image we decode, or the payload did not decode as one. */
	export class ThumbnailUnsupportedError extends Error { public code = 'thumbnail_unsupported' }
	export class ThumbnailSourceTooLargeError extends Error { public code = 'thumbnail_source_too_large' }
}
