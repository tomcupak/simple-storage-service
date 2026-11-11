export type FileKind = 'image' | 'pdf' | 'text' | 'audio' | 'video' | 'archive' | 'other'

const TEXT_EXTENSION = /\.(txt|md|json|xml|ya?ml|csv|log|ini|conf|ts|tsx|js|css|html?)$/i
const IMAGE_EXTENSION = /\.(jpe?g|png|gif|webp|avif|svg|bmp|ico|tiff?)$/i
const THUMBNAIL_EXTENSION = /\.(jpe?g|png|gif|webp|avif|tiff?)$/i
const THUMBNAIL_TYPE = /^image\/(jpeg|png|gif|webp|avif|tiff)$/
const ARCHIVE_EXTENSION = /\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i
const AUDIO_EXTENSION = /\.(mp3|wav|flac|ogg|m4a|aac)$/i
const VIDEO_EXTENSION = /\.(mp4|mkv|mov|avi|webm|m4v)$/i

/** A missing or generic type says nothing about the content, so only then the extension decides
 *  - some clients upload everything as `application/octet-stream`. */
function isGeneric(type: string): boolean {
	return type === '' || type === 'application/octet-stream' || type === 'binary/octet-stream'
}

export function fileKind(contentType: string | null | undefined, key: string): FileKind {
	const type = (contentType ?? '').toLowerCase()

	if (type.startsWith('image/')) return 'image'
	if (type === 'application/pdf') return 'pdf'
	if (type.startsWith('text/') || /^application\/(json|xml|javascript|x-yaml)/.test(type)) return 'text'
	if (type.startsWith('audio/')) return 'audio'
	if (type.startsWith('video/')) return 'video'
	if (/^application\/(zip|gzip|x-tar|x-7z-compressed|x-rar|vnd\.rar|x-bzip2)/.test(type)) return 'archive'

	if (isGeneric(type) || type.startsWith('application/')) {
		if (IMAGE_EXTENSION.test(key)) return 'image'
		if (/\.pdf$/i.test(key)) return 'pdf'
		if (TEXT_EXTENSION.test(key)) return 'text'
		if (ARCHIVE_EXTENSION.test(key)) return 'archive'
		if (AUDIO_EXTENSION.test(key)) return 'audio'
		if (VIDEO_EXTENSION.test(key)) return 'video'
	}

	return 'other'
}

/** Raster formats the server can make a thumbnail of. SVG and friends are viewable but not
 *  thumbnailable, so they get an icon in the listing. */
export function isThumbnailable(contentType: string | null | undefined, key: string): boolean {
	const type = (contentType ?? '').toLowerCase()
	if (THUMBNAIL_TYPE.test(type)) return true

	return (isGeneric(type) || type.startsWith('application/')) && THUMBNAIL_EXTENSION.test(key)
}

const ICONS: Record<FileKind, string> = {
	image: '🖼',
	pdf: '📕',
	text: '📝',
	audio: '🎵',
	video: '🎬',
	archive: '🗜',
	other: '📄',
}

export function fileIcon(kind: FileKind): string {
	return ICONS[kind]
}

export type PreviewKind = 'image' | 'pdf' | 'text' | 'unsupported'

export function previewKind(contentType: string | null | undefined, key: string): PreviewKind {
	const kind = fileKind(contentType, key)

	return kind === 'image' || kind === 'pdf' || kind === 'text' ? kind : 'unsupported'
}
