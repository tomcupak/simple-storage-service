import { instance } from './customInstance'

/** Object payloads are the one thing the generated client cannot carry: uploads need
 *  `onUploadProgress` and an abort signal, downloads need `responseType: 'blob'`, and Orval's
 *  mutator takes a fixed config. Both endpoints are the same ones the generated client
 *  describes - only the transport options differ. */

export interface UploadOptions {
	onProgress?: (percent: number) => void
	signal?: AbortSignal
}

export async function uploadObject({ bucketName, key, file, onProgress, signal }: {
	bucketName: string
	key: string
	file: File
} & UploadOptions): Promise<void> {
	await instance.put(`/v1/buckets/${encodeURIComponent(bucketName)}/objects`, file, {
		params: { key },
		// The raw body is the payload, so the type travels as the object's stored content type.
		headers: { 'Content-Type': file.type || 'application/octet-stream' },
		signal,
		onUploadProgress: (event) => {
			if (!onProgress) return
			// `total` is missing when the browser cannot know the length upfront.
			onProgress(event.total ? Math.round((event.loaded / event.total) * 100) : 0)
		},
	})
}

export async function downloadObject({ bucketName, key, versionId }: {
	bucketName: string
	key: string
	versionId?: string
}): Promise<Blob> {
	const response = await instance.get<Blob>(`/v1/buckets/${encodeURIComponent(bucketName)}/objects/download`, {
		params: { key, versionId },
		responseType: 'blob',
	})

	return response.data
}

/** Hands a blob to the browser as a file download. The object URL is released on the next tick,
 *  once the click has been dispatched - revoking it immediately cancels the download. */
export function saveBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob)
	const link = document.createElement('a')
	link.href = url
	link.download = filename
	document.body.appendChild(link)
	link.click()
	link.remove()
	setTimeout(() => URL.revokeObjectURL(url), 0)
}
