import { Injectable, Logger } from '@nestjs/common'
import { AuditAction, AuditResult, coreSchema, DbProvider } from '@storage/database'
import { Api } from '@storage/shared'
import { and, count, desc, eq, SQL } from 'drizzle-orm'

import { AuditTypes } from './audit.types'

@Injectable()
export class AuditService {
	private logger = new Logger(AuditService.name)

	constructor(
		private db: DbProvider,
	) {}

	/** Writes one entry. Auditing must never turn a successful operation into a failed request,
	 *  so a write that fails is logged and swallowed rather than propagated. */
	async record(params: AuditTypes.RecordParams): Promise<void> {
		try {
			await this.db.core.insert(coreSchema.auditLog).values({
				action: params.action,
				result: params.result ?? AuditResult.success,
				userGuid: params.userGuid ?? null,
				userEmail: params.userEmail ?? null,
				bucketName: params.bucketName ?? null,
				objectKey: params.objectKey ?? null,
				targetGuid: params.targetGuid ?? null,
				sourceIp: params.sourceIp ?? null,
				userAgent: params.userAgent ?? null,
				detail: params.detail ?? null,
			})
		} catch (err) {
			this.logger.error(`Failed to record audit entry '${params.action}'`, err instanceof Error ? err.stack : undefined)
		}
	}

	async list({ limit, page, action, userGuid, bucketName }: AuditTypes.ListQuery): Promise<Api.Pagination<AuditTypes.AuditEntry>> {
		const filters: SQL[] = []
		if (action) filters.push(eq(coreSchema.auditLog.action, action))
		if (userGuid) filters.push(eq(coreSchema.auditLog.userGuid, userGuid))
		if (bucketName) filters.push(eq(coreSchema.auditLog.bucketName, bucketName))

		const where = filters.length ? and(...filters) : undefined

		const rows = await this.db.core
			.select()
			.from(coreSchema.auditLog)
			.where(where)
			.orderBy(desc(coreSchema.auditLog.createdAt))
			.limit(limit)
			.offset((page - 1) * limit)

		const [{ value: totalRecords }] = await this.db.core
			.select({ value: count() })
			.from(coreSchema.auditLog)
			.where(where)

		return Api.paginate({ data: rows.map((row) => this.toEntry(row)), totalRecords, limit, page })
	}

	/** Actions the log can hold, for the filter in the UI. */
	actions(): AuditAction[] {
		return Object.values(AuditAction)
	}

	private toEntry(row: typeof coreSchema.auditLog.$inferSelect): AuditTypes.AuditEntry {
		return {
			guid: row.guid,
			action: row.action,
			result: row.result,
			userGuid: row.userGuid,
			userEmail: row.userEmail,
			bucketName: row.bucketName,
			objectKey: row.objectKey,
			targetGuid: row.targetGuid,
			sourceIp: row.sourceIp,
			userAgent: row.userAgent,
			detail: (row.detail as Record<string, unknown> | null) ?? null,
			createdAt: row.createdAt,
		}
	}
}
