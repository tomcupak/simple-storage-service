import { Injectable, Logger } from '@nestjs/common'
import { coreSchema, DbProvider } from '@storage/database'
import { and, asc, eq, gt, like, sql } from 'drizzle-orm'

import { StorageService } from '../storage/storage.service'
import { ObjectsTypes } from './objects.types'

const DEFAULT_MAX_KEYS = 1000

/** Object metadata (keys, versions, sizes, ETags). Byte payloads are owned by `StorageService`;
 *  this service is the only place that links the two together. */
@Injectable()
export class ObjectsService {
	private logger = new Logger(ObjectsService.name)

	constructor(
		private db: DbProvider,
		private storageService: StorageService,
	) {}

	/** Lists the latest version of every key in a bucket, collapsing `delimiter`-separated
	 *  groups into common prefixes the way `ListObjectsV2` does. */
	async list({ bucketGuid, prefix, delimiter, maxKeys, continuationToken }: ObjectsTypes.ListQuery): Promise<ObjectsTypes.ListResult> {
		const limit = Math.min(maxKeys ?? DEFAULT_MAX_KEYS, DEFAULT_MAX_KEYS)

		const rows = await this.db.core
			.select({ object: coreSchema.object, version: coreSchema.objectVersion })
			.from(coreSchema.object)
			.innerJoin(coreSchema.objectVersion, eq(coreSchema.objectVersion.guid, coreSchema.object.latestVersionGuid))
			.where(and(
				eq(coreSchema.object.bucketGuid, bucketGuid),
				eq(coreSchema.objectVersion.isDeleteMarker, false),
				prefix ? like(coreSchema.object.key, `${prefix.replace(/[%_]/g, '\\$&')}%`) : undefined,
				continuationToken ? gt(coreSchema.object.key, continuationToken) : undefined,
			))
			.orderBy(asc(coreSchema.object.key))
			.limit(limit + 1)

		const page = rows.slice(0, limit)
		const isTruncated = rows.length > limit

		const objects: ObjectsTypes.ObjectItem[] = []
		const commonPrefixes = new Set<string>()

		for (const row of page) {
			const commonPrefix = delimiter ? this.commonPrefixOf(row.object.key, prefix ?? '', delimiter) : undefined
			if (commonPrefix) {
				commonPrefixes.add(commonPrefix)
				continue
			}
			objects.push({
				guid: row.object.guid,
				key: row.object.key,
				size: row.version.size,
				etag: row.version.etag,
				contentType: row.version.contentType,
				versionId: row.version.versionId,
				lastModified: row.version.createdAt,
			})
		}

		return {
			objects,
			commonPrefixes: [...commonPrefixes],
			isTruncated,
			nextContinuationToken: isTruncated ? page[page.length - 1]?.object.key : undefined,
		}
	}

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
			.orderBy(sql`${coreSchema.objectVersion.createdAt} DESC`)

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

	/** Key segment between `prefix` and the first `delimiter` after it, or undefined when the
	 *  key has no delimiter left (i.e. it is a leaf object rather than a synthetic folder). */
	private commonPrefixOf(key: string, prefix: string, delimiter: string): string | undefined {
		const rest = key.slice(prefix.length)
		const index = rest.indexOf(delimiter)
		if (index < 0) return undefined
		return `${prefix}${rest.slice(0, index + delimiter.length)}`
	}
}
