const SIZE_UNITS = ['kB', 'MB', 'GB', 'TB', 'PB']

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`

	let value = bytes / 1024
	let unitIndex = 0
	while (value >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
		value /= 1024
		unitIndex += 1
	}

	return `${value.toFixed(1)} ${SIZE_UNITS[unitIndex]}`
}

export function formatDate(value: string | Date | null | undefined): string {
	if (!value) return '—'

	const date = value instanceof Date ? value : new Date(value)
	return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

/** Last segment of a key, i.e. what the file browser shows as the file's own name. */
export function baseName(key: string): string {
	return key.split('/').filter(Boolean).pop() ?? key
}

/** The folder a key lives in, with its trailing slash (`a/b/c.txt` -> `a/b/`). */
export function parentPrefix(key: string): string {
	const index = key.replace(/\/$/, '').lastIndexOf('/')
	return index === -1 ? '' : key.slice(0, index + 1)
}
