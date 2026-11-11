import { AuditAction, AuditResult } from '@storage/database'

export namespace AuditTypes {
	/** Body fields that must never reach the audit log, whatever endpoint they arrive on. */
	export const REDACTED_FIELDS = ['password', 'secretAccessKey', 'refreshToken', 'accessToken']

	export interface AuditEntry {
		guid: string
		action: AuditAction
		result: AuditResult
		userGuid: string | null
		userEmail: string | null
		bucketName: string | null
		objectKey: string | null
		targetGuid: string | null
		sourceIp: string | null
		userAgent: string | null
		detail: Record<string, unknown> | null
		createdAt: Date
	}

	/** One operation to record. Everything but the action is optional - a failed login knows
	 *  no user guid, a user operation no bucket. */
	export interface RecordParams {
		action: AuditAction
		result?: AuditResult
		userGuid?: string | null
		userEmail?: string | null
		bucketName?: string | null
		objectKey?: string | null
		targetGuid?: string | null
		sourceIp?: string | null
		userAgent?: string | null
		detail?: Record<string, unknown> | null
	}

	export interface ListQuery {
		limit: number
		page: number
		action?: AuditAction
		userGuid?: string
		bucketName?: string
	}
}
