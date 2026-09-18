import { Injectable } from '@nestjs/common'
import { BucketVersioning, coreSchema, DbProvider, MultipartUploadStatus, StorageClass } from '@storage/database'
import * as crypto from 'crypto'
import { and, asc, desc, eq, gt, SQL,sql } from 'drizzle-orm'
import { AnyPgColumn } from 'drizzle-orm/pg-core'
import { Readable } from 'stream'

import { StorageService } from '../storage/storage.service'
import { StorageTypes } from '../storage/storage.types'
import { UsageService } from '../usage/usage.service'
import { ObjectsTypes } from './objects.types'

const DEFAULT_MAX_KEYS = 1000
const VERSION_ID_BYTES = 16
const UPLOAD_ID_BYTES = 24

/** S3's own limit on a key, in UTF-8 bytes. */
const MAX_KEY_BYTES = 1024

/** What the marker object of a folder is stored as, the type every S3 console writes. */
const FOLDER_CONTENT_TYPE = 'application/x-directory'

/** Object metadata (keys, versions, sizes, ETags). Byte payloads are owned by `StorageService`;
 *  this service is the only place that links the two together. */
@Injectable()
export class ObjectsService {
	constructor(
		private db: DbProvider,
		private storageService: StorageService,
		private usageService: UsageService,
	) {}

	/** Lists the latest version of every key in a bucket, collapsing `delimiter`-separated
	 *  groups into common prefixes the way `ListObjectsV2` does.
	 *
	 *  Keys and common prefixes both count towards `maxKeys`, so the page is assembled in
	 *  batches: emitting a folder skips every key inside it. */
	async list({ bucketGuid, prefix, delimiter, maxKeys, continuationToken, startAfter }: ObjectsTypes.ListQuery): Promise<ObjectsTypes.ListResult> {
		const limit = this.resolveLimit(maxKeys)
		const resumed = continuationToken ? this.decodeToken(continuationToken) : undefined

		let cursor = resumed?.value ?? startAfter
		let excludePrefix = resumed?.isPrefix ? resumed.value : undefined

		const objects: ObjectsTypes.ObjectItem[] = []
		const commonPrefixes: string[] = []
		let last: { value: string, isPrefix: boolean } | undefined
		let exhausted = false

		while (objects.length + commonPrefixes.length < limit && !exhausted) {
			const remaining = limit - (objects.length + commonPrefixes.length)
			const batch = await this.fetchLatestVersions({ bucketGuid, prefix, cursor, excludePrefix, limit: remaining })
			if (batch.length === 0) {
				exhausted = true
				break
			}

			let jumped = false
			for (const row of batch) {
				const commonPrefix = delimiter ? this.commonPrefixOf(row.object.key, prefix ?? '', delimiter) : undefined

				if (commonPrefix) {
					commonPrefixes.push(commonPrefix)
					last = { value: commonPrefix, isPrefix: true }
					cursor = commonPrefix
					excludePrefix = commonPrefix
					jumped = true
					break
				}

				objects.push({
					guid: row.object.guid,
					key: row.object.key,
					size: row.version.size,
					etag: row.version.etag,
					contentType: row.version.contentType,
					versionId: row.version.versionId,
					storageClass: row.version.storageClass,
					lastModified: row.version.createdAt,
				})
				last = { value: row.object.key, isPrefix: false }
				cursor = row.object.key
			}

			// A short batch that was not cut off by a folder jump means there is nothing left.
			if (!jumped && batch.length < remaining) exhausted = true
		}

		const isTruncated = !exhausted && (objects.length + commonPrefixes.length) >= limit
			&& (await this.fetchLatestVersions({ bucketGuid, prefix, cursor, excludePrefix, limit: 1 })).length > 0

		return {
			objects,
			commonPrefixes,
			isTruncated,
			nextContinuationToken: isTruncated && last ? this.encodeToken(last) : undefined,
		}
	}

	/** Every version of every key, newest first within a key - the `ListObjectVersions` shape. */
	async listAllVersions({ bucketGuid, prefix, delimiter, maxKeys, keyMarker, versionIdMarker }: ObjectsTypes.ListVersionsQuery): Promise<ObjectsTypes.ListVersionsResult> {
		const limit = this.resolveLimit(maxKeys)

		const rows = await this.db.core
			.select({ object: coreSchema.object, version: coreSchema.objectVersion })
			.from(coreSchema.object)
			.innerJoin(coreSchema.objectVersion, eq(coreSchema.objectVersion.objectGuid, coreSchema.object.guid))
			.where(and(
				eq(coreSchema.object.bucketGuid, bucketGuid),
				prefix ? this.likePrefix(coreSchema.object.key, prefix) : undefined,
				keyMarker ? this.collatedGreaterOrEqual(coreSchema.object.key, keyMarker) : undefined,
			))
			.orderBy(this.collatedAsc(coreSchema.object.key), desc(coreSchema.objectVersion.createdAt))
			.limit(limit * 2 + 1)

		const versions: ObjectsTypes.VersionListItem[] = []
		const commonPrefixes: string[] = []
		let skipping = Boolean(keyMarker && versionIdMarker)
		let isTruncated = false
		let last: { key: string, versionId: string } | undefined

		for (const row of rows) {
			// Resuming inside a key: everything up to and including the marked version is done.
			if (skipping) {
				if (row.object.key === keyMarker && row.version.versionId === versionIdMarker) skipping = false
				continue
			}
			if (keyMarker && !versionIdMarker && row.object.key === keyMarker) continue

			const commonPrefix = delimiter ? this.commonPrefixOf(row.object.key, prefix ?? '', delimiter) : undefined
			if (commonPrefix) {
				if (!commonPrefixes.includes(commonPrefix)) {
					if (versions.length + commonPrefixes.length >= limit) {
						isTruncated = true
						break
					}
					commonPrefixes.push(commonPrefix)
				}
				continue
			}

			if (versions.length + commonPrefixes.length >= limit) {
				isTruncated = true
				break
			}

			versions.push({
				key: row.object.key,
				versionId: row.version.versionId,
				isLatest: row.version.guid === row.object.latestVersionGuid,
				isDeleteMarker: row.version.isDeleteMarker,
				size: row.version.size,
				etag: row.version.etag,
				storageClass: row.version.storageClass,
				lastModified: row.version.createdAt,
			})
			last = { key: row.object.key, versionId: row.version.versionId }
		}

		return {
			versions,
			commonPrefixes,
			isTruncated,
			nextKeyMarker: isTruncated ? last?.key : undefined,
			nextVersionIdMarker: isTruncated ? last?.versionId : undefined,
		}
	}

	/** Versions of a single key, newest first - used by the management UI. */
	async listVersions({ bucketGuid, key }: { bucketGuid: string, key: string }): Promise<ObjectsTypes.ObjectVersionItem[]> {
		const [found] = await this.db.core
			.select()
			.from(coreSchema.object)
			.where(and(eq(coreSchema.object.bucketGuid, bucketGuid), eq(coreSchema.object.key, key)))
			.limit(1)

		if (!found) throw new ObjectsTypes.ObjectNotFoundError()

		const versions = await this.db.core
			.select()
			.from(coreSchema.objectVersion)
			.where(eq(coreSchema.objectVersion.objectGuid, found.guid))
			.orderBy(desc(coreSchema.objectVersion.createdAt))

		return versions.map((version) => ({
			guid: version.guid,
			versionId: version.versionId,
			isLatest: version.guid === found.latestVersionGuid,
			isDeleteMarker: version.isDeleteMarker,
			size: version.size,
			etag: version.etag,
			contentType: version.contentType,
			storageClass: version.storageClass,
			metadata: version.metadata as Record<string, string> | null,
			createdAt: version.createdAt,
		}))
	}

	/** Streams a payload to disk and records it as the key's newest version.
	 *  In an unversioned (or suspended) bucket the `null` version is replaced in place. */
	async put({ bucket, key, stream, contentMd5, accessKeyId, declaredLength, ...headers }: ObjectsTypes.PutObjectParams): Promise<ObjectsTypes.PutObjectResult> {
		this.assertValidKey(key)
		// Rejecting an announced over-quota write up front saves streaming a payload that would
		// only be deleted again; the real size is re-checked once it is on disk, because a
		// client's `Content-Length` is a claim, not a guarantee.
		await this.usageService.assertQuota({ bucket, bytes: declaredLength ?? 0 })

		const written = await this.storageService.write(stream)

		try {
			this.assertContentMd5(contentMd5, written.etag)
			await this.usageService.assertQuota({ bucket, bytes: written.size })
		} catch (err) {
			await this.storageService.delete(written.storagePath)
			throw err
		}

		const versionId = this.nextVersionId(bucket.versioning)
		const replaced = await this.commitVersion({
			bucket,
			key,
			versionId,
			values: {
				size: written.size,
				etag: written.etag,
				storagePath: written.storagePath,
				createdByAccessKeyId: accessKeyId ?? null,
				...this.toVersionColumns(headers),
			},
		})

		await this.deleteBlobs(replaced)

		return { versionId, etag: written.etag, size: written.size }
	}

	/** Copies an existing version's bytes into a new object version (`CopyObject`). */
	async copy({ source, target, key, metadataDirective, accessKeyId, ...headers }: {
		source: ObjectsTypes.ObjectVersionDetail
		target: ObjectsTypes.BucketContext
		key: string
		metadataDirective: ObjectsTypes.MetadataDirective
		accessKeyId?: string
	} & ObjectsTypes.ObjectHeaders): Promise<ObjectsTypes.PutObjectResult & { lastModified: Date }> {
		if (!source.storagePath) throw new ObjectsTypes.ObjectNotFoundError()

		const { stream } = await this.storageService.read(source.storagePath)
		const inherited: ObjectsTypes.ObjectHeaders = metadataDirective === ObjectsTypes.MetadataDirective.replace
			? headers
			: {
				contentType: source.contentType,
				contentEncoding: source.contentEncoding,
				cacheControl: source.cacheControl,
				contentDisposition: source.contentDisposition,
				metadata: source.metadata,
				storageClass: headers.storageClass ?? source.storageClass,
			}

		const result = await this.put({ bucket: target, key, stream, accessKeyId, ...inherited })
		return { ...result, lastModified: new Date() }
	}

	/** The version a read should serve: an explicit `versionId`, or the key's newest version. */
	async getVersion({ bucketGuid, key, versionId }: { bucketGuid: string, key: string, versionId?: string }): Promise<ObjectsTypes.ObjectVersionDetail> {
		const [found] = await this.db.core
			.select()
			.from(coreSchema.object)
			.where(and(eq(coreSchema.object.bucketGuid, bucketGuid), eq(coreSchema.object.key, key)))
			.limit(1)

		if (!found) throw new ObjectsTypes.ObjectNotFoundError()

		const [version] = await this.db.core
			.select()
			.from(coreSchema.objectVersion)
			.where(versionId
				? and(eq(coreSchema.objectVersion.objectGuid, found.guid), eq(coreSchema.objectVersion.versionId, versionId))
				: eq(coreSchema.objectVersion.guid, found.latestVersionGuid ?? ''))
			.limit(1)

		if (!version) throw versionId ? new ObjectsTypes.VersionNotFoundError() : new ObjectsTypes.ObjectNotFoundError()

		return this.toVersionDetail({ key: found.key, latestVersionGuid: found.latestVersionGuid, version })
	}

	/** Opens the stored payload, optionally a byte range of it. */
	async readPayload({ storagePath, range }: { storagePath: string, range?: StorageTypes.ReadRange }): Promise<StorageTypes.ReadResult> {
		return this.storageService.read(storagePath, range)
	}

	/** `DeleteObject`: a hard delete in an unversioned bucket, a delete marker otherwise.
	 *  A specific `versionId` always removes that one version permanently. */
	async delete({ bucket, key, versionId, accessKeyId }: {
		bucket: ObjectsTypes.BucketContext
		key: string
		versionId?: string
		accessKeyId?: string
	}): Promise<ObjectsTypes.DeleteResult> {
		const [found] = await this.db.core
			.select()
			.from(coreSchema.object)
			.where(and(eq(coreSchema.object.bucketGuid, bucket.guid), eq(coreSchema.object.key, key)))
			.limit(1)

		// Deleting a key that is not there is a success in S3.
		if (!found) return { isDeleteMarker: false }

		if (versionId) return this.deleteVersion({ objectGuid: found.guid, versionId })

		if (bucket.versioning === BucketVersioning.disabled) {
			await this.deleteBlobs(await this.purgeObject(found.guid))
			return { isDeleteMarker: false }
		}

		const markerVersionId = this.nextVersionId(bucket.versioning)
		const replaced = await this.commitVersion({
			bucket,
			key,
			versionId: markerVersionId,
			values: {
				isDeleteMarker: true,
				size: 0,
				etag: '',
				storagePath: null,
				createdByAccessKeyId: accessKeyId ?? null,
			},
		})

		await this.deleteBlobs(replaced)
		return { versionId: markerVersionId, isDeleteMarker: true }
	}

	/** `DeleteObjects`: every key is attempted, and a failure is reported per key rather than
	 *  failing the whole batch. */
	async deleteMany({ bucket, objects, accessKeyId }: {
		bucket: ObjectsTypes.BucketContext
		objects: { key: string, versionId?: string }[]
		accessKeyId?: string
	}): Promise<ObjectsTypes.DeleteManyResult> {
		const deleted: ObjectsTypes.DeletedEntry[] = []
		const errors: ObjectsTypes.DeleteErrorEntry[] = []

		for (const entry of objects) {
			try {
				const result = await this.delete({ bucket, key: entry.key, versionId: entry.versionId, accessKeyId })
				deleted.push({
					key: entry.key,
					versionId: entry.versionId,
					deleteMarker: result.isDeleteMarker,
					deleteMarkerVersionId: result.isDeleteMarker ? result.versionId : undefined,
				})
			} catch (err) {
				errors.push({
					key: entry.key,
					code: err instanceof ObjectsTypes.VersionNotFoundError ? 'NoSuchVersion' : 'InternalError',
					message: err instanceof Error ? err.message : 'Delete failed',
				})
			}
		}

		return { deleted, errors }
	}

	/** Removes every key under `prefix`, which is what deleting a folder in the file browser
	 *  does. In a versioned bucket each key gets a delete marker, exactly as a single
	 *  `DeleteObject` would - nothing is purged behind the versioning setting's back.
	 *
	 *  An empty prefix is refused: "delete everything in the bucket" has to be spelled out as
	 *  such, not arrived at by leaving a field blank. */
	async deleteByPrefix({ bucket, prefix, accessKeyId }: {
		bucket: ObjectsTypes.BucketContext
		prefix: string
		accessKeyId?: string
	}): Promise<ObjectsTypes.DeletePrefixResult> {
		if (!prefix) throw new ObjectsTypes.InvalidKeyError()

		const rows = await this.db.core
			.select({ key: coreSchema.object.key })
			.from(coreSchema.object)
			.where(and(eq(coreSchema.object.bucketGuid, bucket.guid), this.likePrefix(coreSchema.object.key, prefix)))
			.orderBy(this.collatedAsc(coreSchema.object.key))

		const result = await this.deleteMany({ bucket, objects: rows.map((row) => ({ key: row.key })), accessKeyId })

		return { deletedCount: result.deleted.length, errors: result.errors }
	}

	/** Creates the empty, `/`-terminated key that stands in for a folder. S3 has no directories,
	 *  so this is the marker object every S3 console writes for one. */
	async createFolder({ bucket, key, accessKeyId }: {
		bucket: ObjectsTypes.BucketContext
		key: string
		accessKeyId?: string
	}): Promise<ObjectsTypes.PutObjectResult & { key: string }> {
		const folderKey = key.endsWith(ObjectsTypes.FOLDER_SUFFIX) ? key : `${key}${ObjectsTypes.FOLDER_SUFFIX}`
		this.assertValidKey(folderKey)
		if (folderKey === ObjectsTypes.FOLDER_SUFFIX) throw new ObjectsTypes.InvalidKeyError()

		const [existing] = await this.db.core
			.select({ guid: coreSchema.object.guid })
			.from(coreSchema.object)
			.where(and(eq(coreSchema.object.bucketGuid, bucket.guid), eq(coreSchema.object.key, folderKey)))
			.limit(1)

		if (existing) throw new ObjectsTypes.ObjectAlreadyExistsError()

		const created = await this.put({
			bucket,
			key: folderKey,
			stream: Readable.from([]),
			accessKeyId,
			contentType: FOLDER_CONTENT_TYPE,
			declaredLength: 0,
		})

		return { ...created, key: folderKey }
	}

	/** Server-side copy or rename. A source key ending in `/` moves the whole folder: every key
	 *  under it is re-keyed onto `targetKey`, which keeps a rename in the UI one operation. */
	async copyKeys({ source, target, sourceKey, targetKey, move, accessKeyId }: {
		source: ObjectsTypes.BucketContext
		target: ObjectsTypes.BucketContext
		sourceKey: string
		targetKey: string
		move?: boolean
		accessKeyId?: string
	}): Promise<{ copiedCount: number }> {
		if (!sourceKey || !targetKey) throw new ObjectsTypes.InvalidKeyError()
		if (source.guid === target.guid && sourceKey === targetKey) throw new ObjectsTypes.InvalidKeyError()

		const isFolder = sourceKey.endsWith(ObjectsTypes.FOLDER_SUFFIX)
		// Moving a folder into itself would re-key the copies it has just written, forever.
		if (isFolder && source.guid === target.guid && targetKey.startsWith(sourceKey)) throw new ObjectsTypes.InvalidKeyError()

		const keys = isFolder ? await this.keysUnder({ bucketGuid: source.guid, prefix: sourceKey }) : [sourceKey]
		if (keys.length === 0) throw new ObjectsTypes.ObjectNotFoundError()

		const targetPrefix = isFolder && !targetKey.endsWith(ObjectsTypes.FOLDER_SUFFIX) ? `${targetKey}${ObjectsTypes.FOLDER_SUFFIX}` : targetKey

		for (const key of keys) {
			const destination = isFolder ? `${targetPrefix}${key.slice(sourceKey.length)}` : targetPrefix
			const version = await this.getVersion({ bucketGuid: source.guid, key })
			if (version.isDeleteMarker) continue

			await this.copy({
				source: version,
				target,
				key: destination,
				metadataDirective: ObjectsTypes.MetadataDirective.copy,
				accessKeyId,
			})
		}

		if (move) {
			await this.deleteMany({ bucket: source, objects: keys.map((key) => ({ key })), accessKeyId })
		}

		return { copiedCount: keys.length }
	}

	async createMultipartUpload({ bucket, key, accessKeyId, ...headers }: {
		bucket: ObjectsTypes.BucketContext
		key: string
		accessKeyId?: string
	} & ObjectsTypes.ObjectHeaders): Promise<string> {
		const uploadId = crypto.randomBytes(UPLOAD_ID_BYTES).toString('base64url')

		await this.db.core
			.insert(coreSchema.multipartUpload)
			.values({
				uploadId,
				bucketGuid: bucket.guid,
				key,
				contentType: headers.contentType ?? null,
				contentEncoding: headers.contentEncoding ?? null,
				cacheControl: headers.cacheControl ?? null,
				contentDisposition: headers.contentDisposition ?? null,
				storageClass: headers.storageClass ?? StorageClass.standard,
				metadata: headers.metadata ?? null,
				initiatedByAccessKeyId: accessKeyId ?? null,
			})

		return uploadId
	}

	/** Stores one part's bytes. Re-uploading a part number replaces the previous blob. */
	async uploadPart({ bucket, uploadId, partNumber, stream, contentMd5, declaredLength }: {
		bucket: ObjectsTypes.BucketContext
		uploadId: string
		partNumber: number
		stream: Readable
		contentMd5?: string
		declaredLength?: number
	}): Promise<{ etag: string, size: number }> {
		const upload = await this.requireUpload({ bucketGuid: bucket.guid, uploadId })
		if (partNumber < 1 || partNumber > 10_000) throw new ObjectsTypes.InvalidPartError()

		// Parts occupy disk from the moment they land, so they count against the quota now
		// rather than at `CompleteMultipartUpload`.
		await this.usageService.assertQuota({ bucket, bytes: declaredLength ?? 0 })

		const written = await this.storageService.write(stream)

		try {
			this.assertContentMd5(contentMd5, written.etag)
			await this.usageService.assertQuota({ bucket, bytes: written.size })
		} catch (err) {
			await this.storageService.delete(written.storagePath)
			throw err
		}

		const [previous] = await this.db.core
			.select()
			.from(coreSchema.multipartPart)
			.where(and(eq(coreSchema.multipartPart.uploadGuid, upload.guid), eq(coreSchema.multipartPart.partNumber, partNumber)))
			.limit(1)

		await this.db.core
			.insert(coreSchema.multipartPart)
			.values({ uploadGuid: upload.guid, partNumber, size: written.size, etag: written.etag, storagePath: written.storagePath })
			.onConflictDoUpdate({
				target: [coreSchema.multipartPart.uploadGuid, coreSchema.multipartPart.partNumber],
				set: { size: written.size, etag: written.etag, storagePath: written.storagePath },
			})

		if (previous) await this.deleteBlobs([previous.storagePath])

		return { etag: written.etag, size: written.size }
	}

	/** `UploadPartCopy`: the part's bytes come from an existing object version. */
	async uploadPartCopy({ bucket, uploadId, partNumber, source, range }: {
		bucket: ObjectsTypes.BucketContext
		uploadId: string
		partNumber: number
		source: ObjectsTypes.ObjectVersionDetail
		range?: StorageTypes.ReadRange
	}): Promise<{ etag: string, size: number, lastModified: Date }> {
		if (!source.storagePath) throw new ObjectsTypes.ObjectNotFoundError()

		const { stream } = await this.storageService.read(source.storagePath, range)
		const result = await this.uploadPart({ bucket, uploadId, partNumber, stream })

		return { ...result, lastModified: source.lastModified }
	}

	/** Concatenates the listed parts into the final object version and retires the upload.
	 *  The ETag of a multipart object is the MD5 of the parts' MD5s plus `-<part count>`. */
	async completeMultipartUpload({ bucket, uploadId, parts }: {
		bucket: ObjectsTypes.BucketContext
		uploadId: string
		parts: ObjectsTypes.CompletePart[]
	}): Promise<ObjectsTypes.PutObjectResult & { key: string }> {
		const upload = await this.requireUpload({ bucketGuid: bucket.guid, uploadId })
		if (parts.length === 0) throw new ObjectsTypes.InvalidPartError()

		const stored = await this.db.core
			.select()
			.from(coreSchema.multipartPart)
			.where(eq(coreSchema.multipartPart.uploadGuid, upload.guid))
			.orderBy(asc(coreSchema.multipartPart.partNumber))

		const ordered = this.matchRequestedParts({ requested: parts, stored })

		const concatenated = await this.storageService.concat(ordered.map((part) => part.storagePath))
		const etag = this.multipartEtag(ordered.map((part) => part.etag))
		const versionId = this.nextVersionId(bucket.versioning)

		const replaced = await this.commitVersion({
			bucket,
			key: upload.key,
			versionId,
			values: {
				size: concatenated.size,
				etag,
				storagePath: concatenated.storagePath,
				createdByAccessKeyId: upload.initiatedByAccessKeyId,
				contentType: upload.contentType,
				contentEncoding: upload.contentEncoding,
				cacheControl: upload.cacheControl,
				contentDisposition: upload.contentDisposition,
				storageClass: upload.storageClass,
				metadata: upload.metadata,
			},
		})

		await this.db.core
			.update(coreSchema.multipartUpload)
			.set({ status: MultipartUploadStatus.completed, updatedAt: new Date() })
			.where(eq(coreSchema.multipartUpload.guid, upload.guid))

		await this.db.core.delete(coreSchema.multipartPart).where(eq(coreSchema.multipartPart.uploadGuid, upload.guid))
		await this.deleteBlobs([...stored.map((part) => part.storagePath), ...replaced])

		return { key: upload.key, versionId, etag, size: concatenated.size }
	}

	async abortMultipartUpload({ bucketGuid, uploadId }: { bucketGuid: string, uploadId: string }): Promise<void> {
		const upload = await this.requireUpload({ bucketGuid, uploadId })

		const parts = await this.db.core
			.select()
			.from(coreSchema.multipartPart)
			.where(eq(coreSchema.multipartPart.uploadGuid, upload.guid))

		await this.db.core.delete(coreSchema.multipartPart).where(eq(coreSchema.multipartPart.uploadGuid, upload.guid))
		await this.db.core
			.update(coreSchema.multipartUpload)
			.set({ status: MultipartUploadStatus.aborted, updatedAt: new Date() })
			.where(eq(coreSchema.multipartUpload.guid, upload.guid))

		await this.deleteBlobs(parts.map((part) => part.storagePath))
	}

	async listParts({ bucketGuid, uploadId, maxParts, partNumberMarker }: {
		bucketGuid: string
		uploadId: string
		maxParts?: number
		partNumberMarker?: number
	}): Promise<ObjectsTypes.ListPartsResult & { key: string }> {
		const upload = await this.requireUpload({ bucketGuid, uploadId })
		const limit = this.resolveLimit(maxParts)

		const rows = await this.db.core
			.select()
			.from(coreSchema.multipartPart)
			.where(and(
				eq(coreSchema.multipartPart.uploadGuid, upload.guid),
				partNumberMarker ? gt(coreSchema.multipartPart.partNumber, partNumberMarker) : undefined,
			))
			.orderBy(asc(coreSchema.multipartPart.partNumber))
			.limit(limit + 1)

		const page = rows.slice(0, limit)
		const isTruncated = rows.length > limit

		return {
			key: upload.key,
			parts: page.map((part) => ({
				partNumber: part.partNumber,
				size: part.size,
				etag: part.etag,
				lastModified: part.createdAt,
			})),
			isTruncated,
			nextPartNumberMarker: isTruncated ? page[page.length - 1]?.partNumber : undefined,
		}
	}

	async listMultipartUploads({ bucketGuid, prefix, delimiter, maxUploads, keyMarker, uploadIdMarker }: {
		bucketGuid: string
		prefix?: string
		delimiter?: string
		maxUploads?: number
		keyMarker?: string
		uploadIdMarker?: string
	}): Promise<ObjectsTypes.ListMultipartUploadsResult> {
		const limit = this.resolveLimit(maxUploads)

		const rows = await this.db.core
			.select()
			.from(coreSchema.multipartUpload)
			.where(and(
				eq(coreSchema.multipartUpload.bucketGuid, bucketGuid),
				eq(coreSchema.multipartUpload.status, MultipartUploadStatus.inProgress),
				prefix ? this.likePrefix(coreSchema.multipartUpload.key, prefix) : undefined,
				keyMarker ? this.collatedGreaterOrEqual(coreSchema.multipartUpload.key, keyMarker) : undefined,
			))
			.orderBy(this.collatedAsc(coreSchema.multipartUpload.key), asc(coreSchema.multipartUpload.uploadId))
			.limit(limit * 2 + 1)

		const uploads: ObjectsTypes.MultipartUploadItem[] = []
		const commonPrefixes: string[] = []
		let skipping = Boolean(keyMarker && uploadIdMarker)
		let isTruncated = false
		let last: ObjectsTypes.MultipartUploadItem | undefined

		for (const row of rows) {
			if (skipping) {
				if (row.key === keyMarker && row.uploadId === uploadIdMarker) skipping = false
				continue
			}

			const commonPrefix = delimiter ? this.commonPrefixOf(row.key, prefix ?? '', delimiter) : undefined
			if (commonPrefix) {
				if (!commonPrefixes.includes(commonPrefix)) {
					if (uploads.length + commonPrefixes.length >= limit) {
						isTruncated = true
						break
					}
					commonPrefixes.push(commonPrefix)
				}
				continue
			}

			if (uploads.length + commonPrefixes.length >= limit) {
				isTruncated = true
				break
			}

			last = { uploadId: row.uploadId, key: row.key, storageClass: row.storageClass, initiatedAt: row.createdAt }
			uploads.push(last)
		}

		return {
			uploads,
			commonPrefixes,
			isTruncated,
			nextKeyMarker: isTruncated ? last?.key : undefined,
			nextUploadIdMarker: isTruncated ? last?.uploadId : undefined,
		}
	}

	/** Number of keys currently visible in a bucket - `DeleteBucket` refuses a non-empty one. */
	async countKeys(bucketGuid: string): Promise<number> {
		const [row] = await this.db.core
			.select({ value: sql<number>`count(*)::int` })
			.from(coreSchema.object)
			.where(eq(coreSchema.object.bucketGuid, bucketGuid))

		return row?.value ?? 0
	}

	/** Inserts a new version row and points the key at it, replacing the `null` version when the
	 *  bucket is not versioned. Returns the storage paths the caller must now delete. */
	private async commitVersion({ bucket, key, versionId, values }: {
		bucket: ObjectsTypes.BucketContext
		key: string
		versionId: string
		values: Partial<typeof coreSchema.objectVersion.$inferInsert> & { etag: string }
	}): Promise<string[]> {
		return this.db.core.transaction(async (tx) => {
			const [objectRow] = await tx
				.insert(coreSchema.object)
				.values({ bucketGuid: bucket.guid, key })
				.onConflictDoUpdate({
					target: [coreSchema.object.bucketGuid, coreSchema.object.key],
					set: { updatedAt: new Date() },
				})
				.returning()

			const orphaned: string[] = []

			if (versionId === ObjectsTypes.NULL_VERSION_ID) {
				const replaced = await tx
					.delete(coreSchema.objectVersion)
					.where(and(
						eq(coreSchema.objectVersion.objectGuid, objectRow.guid),
						eq(coreSchema.objectVersion.versionId, ObjectsTypes.NULL_VERSION_ID),
					))
					.returning()

				orphaned.push(...replaced.map((row) => row.storagePath).filter((path): path is string => Boolean(path)))
			}

			const [version] = await tx
				.insert(coreSchema.objectVersion)
				.values({ objectGuid: objectRow.guid, versionId, ...values })
				.returning()

			await tx
				.update(coreSchema.object)
				.set({ latestVersionGuid: version.guid, updatedAt: new Date() })
				.where(eq(coreSchema.object.guid, objectRow.guid))

			return orphaned
		})
	}

	/** Permanently removes one version; the key itself disappears with its last version. */
	private async deleteVersion({ objectGuid, versionId }: { objectGuid: string, versionId: string }): Promise<ObjectsTypes.DeleteResult> {
		const [version] = await this.db.core
			.select()
			.from(coreSchema.objectVersion)
			.where(and(eq(coreSchema.objectVersion.objectGuid, objectGuid), eq(coreSchema.objectVersion.versionId, versionId)))
			.limit(1)

		if (!version) throw new ObjectsTypes.VersionNotFoundError()

		await this.db.core.transaction(async (tx) => {
			await tx.delete(coreSchema.objectVersion).where(eq(coreSchema.objectVersion.guid, version.guid))

			const [newest] = await tx
				.select()
				.from(coreSchema.objectVersion)
				.where(eq(coreSchema.objectVersion.objectGuid, objectGuid))
				.orderBy(desc(coreSchema.objectVersion.createdAt))
				.limit(1)

			if (newest) {
				await tx
					.update(coreSchema.object)
					.set({ latestVersionGuid: newest.guid, updatedAt: new Date() })
					.where(eq(coreSchema.object.guid, objectGuid))
				return
			}

			await tx.delete(coreSchema.object).where(eq(coreSchema.object.guid, objectGuid))
		})

		if (version.storagePath) await this.deleteBlobs([version.storagePath])

		return { versionId, isDeleteMarker: version.isDeleteMarker }
	}

	/** Drops a key with all of its versions and returns the orphaned storage paths. */
	private async purgeObject(objectGuid: string): Promise<string[]> {
		return this.db.core.transaction(async (tx) => {
			const removed = await tx
				.delete(coreSchema.objectVersion)
				.where(eq(coreSchema.objectVersion.objectGuid, objectGuid))
				.returning()

			await tx.delete(coreSchema.object).where(eq(coreSchema.object.guid, objectGuid))

			return removed.map((row) => row.storagePath).filter((path): path is string => Boolean(path))
		})
	}

	/** Every key stored under a prefix, in the byte order S3 lists them in. */
	private async keysUnder({ bucketGuid, prefix }: { bucketGuid: string, prefix: string }): Promise<string[]> {
		const rows = await this.db.core
			.select({ key: coreSchema.object.key })
			.from(coreSchema.object)
			.where(and(eq(coreSchema.object.bucketGuid, bucketGuid), this.likePrefix(coreSchema.object.key, prefix)))
			.orderBy(this.collatedAsc(coreSchema.object.key))

		return rows.map((row) => row.key)
	}

	/** S3's key rules: non-empty, at most 1024 UTF-8 bytes and free of control characters. */
	private assertValidKey(key: string): void {
		if (!key) throw new ObjectsTypes.InvalidKeyError()
		if (Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES) throw new ObjectsTypes.InvalidKeyError()
		 
		if (/[\u0000-\u001f\u007f]/.test(key)) throw new ObjectsTypes.InvalidKeyError()
	}

	private async requireUpload({ bucketGuid, uploadId }: { bucketGuid: string, uploadId: string }): Promise<typeof coreSchema.multipartUpload.$inferSelect> {
		const [found] = await this.db.core
			.select()
			.from(coreSchema.multipartUpload)
			.where(and(
				eq(coreSchema.multipartUpload.uploadId, uploadId),
				eq(coreSchema.multipartUpload.bucketGuid, bucketGuid),
				eq(coreSchema.multipartUpload.status, MultipartUploadStatus.inProgress),
			))
			.limit(1)

		if (!found) throw new ObjectsTypes.UploadNotFoundError()
		return found
	}

	/** Pairs the client's `<Part>` list with the stored parts, enforcing S3's rules: ascending
	 *  part numbers, matching ETags and a 5 MiB minimum on every part but the last. */
	private matchRequestedParts({ requested, stored }: {
		requested: ObjectsTypes.CompletePart[]
		stored: (typeof coreSchema.multipartPart.$inferSelect)[]
	}): (typeof coreSchema.multipartPart.$inferSelect)[] {
		const byNumber = new Map(stored.map((part) => [part.partNumber, part]))
		const ordered: (typeof coreSchema.multipartPart.$inferSelect)[] = []

		requested.forEach((part, index) => {
			if (index > 0 && part.partNumber <= requested[index - 1].partNumber) throw new ObjectsTypes.InvalidPartOrderError()

			const found = byNumber.get(part.partNumber)
			if (!found || found.etag !== part.etag.replace(/"/g, '')) throw new ObjectsTypes.InvalidPartError()
			if (index < requested.length - 1 && found.size < ObjectsTypes.MIN_PART_SIZE) throw new ObjectsTypes.PartTooSmallError()

			ordered.push(found)
		})

		return ordered
	}

	/** MD5 of the concatenated binary part MD5s, suffixed with the part count. */
	private multipartEtag(partEtags: string[]): string {
		const digest = crypto
			.createHash('md5')
			.update(Buffer.concat(partEtags.map((etag) => Buffer.from(etag, 'hex'))))
			.digest('hex')

		return `${digest}-${partEtags.length}`
	}

	private assertContentMd5(contentMd5: string | undefined, etag: string): void {
		if (!contentMd5) return

		const expected = Buffer.from(contentMd5, 'base64')
		if (expected.length !== 16 || expected.toString('hex') !== etag) throw new ObjectsTypes.BadDigestError()
	}

	private async fetchLatestVersions({ bucketGuid, prefix, cursor, excludePrefix, limit }: {
		bucketGuid: string
		prefix?: string
		cursor?: string
		excludePrefix?: string
		limit: number
	}) {
		return this.db.core
			.select({ object: coreSchema.object, version: coreSchema.objectVersion })
			.from(coreSchema.object)
			.innerJoin(coreSchema.objectVersion, eq(coreSchema.objectVersion.guid, coreSchema.object.latestVersionGuid))
			.where(and(
				eq(coreSchema.object.bucketGuid, bucketGuid),
				eq(coreSchema.objectVersion.isDeleteMarker, false),
				prefix ? this.likePrefix(coreSchema.object.key, prefix) : undefined,
				cursor ? this.collatedGreater(coreSchema.object.key, cursor) : undefined,
				excludePrefix ? this.notLikePrefix(coreSchema.object.key, excludePrefix) : undefined,
			))
			.orderBy(this.collatedAsc(coreSchema.object.key))
			.limit(limit)
	}

	/** Key segment between `prefix` and the first `delimiter` after it, or undefined when the
	 *  key has no delimiter left (i.e. it is a leaf object rather than a synthetic folder). */
	private commonPrefixOf(key: string, prefix: string, delimiter: string): string | undefined {
		const rest = key.slice(prefix.length)
		const index = rest.indexOf(delimiter)
		if (index < 0) return undefined
		return `${prefix}${rest.slice(0, index + delimiter.length)}`
	}

	private resolveLimit(requested?: number): number {
		if (!requested || requested < 1) return DEFAULT_MAX_KEYS
		return Math.min(requested, ObjectsTypes.MAX_KEYS_LIMIT)
	}

	/** S3 orders keys by their raw UTF-8 bytes; the database's locale collation does not, so
	 *  every key comparison is forced to the byte-ordered `C` collation. */
	private collatedAsc(column: AnyPgColumn): SQL {
		return sql`${column} COLLATE "C" ASC`
	}

	private collatedGreater(column: AnyPgColumn, value: string): SQL {
		return sql`${column} COLLATE "C" > ${value}`
	}

	private collatedGreaterOrEqual(column: AnyPgColumn, value: string): SQL {
		return sql`${column} COLLATE "C" >= ${value}`
	}

	private likePrefix(column: AnyPgColumn, prefix: string): SQL {
		return sql`${column} LIKE ${`${this.escapeLike(prefix)}%`}`
	}

	private notLikePrefix(column: AnyPgColumn, prefix: string): SQL {
		return sql`${column} NOT LIKE ${`${this.escapeLike(prefix)}%`}`
	}

	private escapeLike(value: string): string {
		return value.replace(/[%_\\]/g, '\\$&')
	}

	/** Continuation tokens are opaque to clients: they carry whether the page ended on a key
	 *  or on a collapsed folder, which decides how the next page resumes. */
	private encodeToken(cursor: { value: string, isPrefix: boolean }): string {
		return Buffer.from(`${cursor.isPrefix ? 'p' : 'k'}:${cursor.value}`, 'utf8').toString('base64url')
	}

	private decodeToken(token: string): { value: string, isPrefix: boolean } | undefined {
		const decoded = Buffer.from(token, 'base64url').toString('utf8')
		const separator = decoded.indexOf(':')
		if (separator !== 1) return undefined

		return { isPrefix: decoded[0] === 'p', value: decoded.slice(separator + 1) }
	}

	private nextVersionId(versioning: BucketVersioning): string {
		return versioning === BucketVersioning.enabled
			? crypto.randomBytes(VERSION_ID_BYTES).toString('hex')
			: ObjectsTypes.NULL_VERSION_ID
	}

	private toVersionColumns(headers: ObjectsTypes.ObjectHeaders): Partial<typeof coreSchema.objectVersion.$inferInsert> {
		return {
			contentType: headers.contentType ?? null,
			contentEncoding: headers.contentEncoding ?? null,
			cacheControl: headers.cacheControl ?? null,
			contentDisposition: headers.contentDisposition ?? null,
			storageClass: headers.storageClass ?? StorageClass.standard,
			metadata: headers.metadata ?? null,
		}
	}

	private toVersionDetail({ key, latestVersionGuid, version }: {
		key: string
		latestVersionGuid: string | null
		version: typeof coreSchema.objectVersion.$inferSelect
	}): ObjectsTypes.ObjectVersionDetail {
		return {
			objectGuid: version.objectGuid,
			versionGuid: version.guid,
			key,
			versionId: version.versionId,
			isLatest: version.guid === latestVersionGuid,
			isDeleteMarker: version.isDeleteMarker,
			size: version.size,
			etag: version.etag,
			storagePath: version.storagePath,
			contentType: version.contentType,
			contentEncoding: version.contentEncoding,
			cacheControl: version.cacheControl,
			contentDisposition: version.contentDisposition,
			storageClass: version.storageClass,
			metadata: version.metadata as Record<string, string> | null,
			lastModified: version.createdAt,
		}
	}

	/** Blob deletion always follows the metadata change, never precedes it: a leftover blob is
	 *  garbage the collector can find, a missing one would be data loss. */
	private async deleteBlobs(storagePaths: string[]): Promise<void> {
		for (const storagePath of storagePaths) {
			await this.storageService.delete(storagePath)
		}
	}
}
