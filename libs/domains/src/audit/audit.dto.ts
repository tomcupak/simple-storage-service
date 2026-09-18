import { ApiProperty } from '@nestjs/swagger'
import { AuditAction, AuditResult } from '@storage/database'
import { Api } from '@storage/shared'
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator'

export namespace AuditDto {
	export enum ErrorCodes {
		PERMISSION_DENIED = 'permission_denied',
	}

	export class AuditEntry {
		@ApiProperty({ type: 'string', format: 'uuid' })
		declare guid: string

		@ApiProperty({ enum: AuditAction })
		declare action: AuditAction

		@ApiProperty({ enum: AuditResult })
		declare result: AuditResult

		@ApiProperty({ type: 'string', format: 'uuid', nullable: true, required: false })
		declare userGuid: string | null

		@ApiProperty({ type: 'string', nullable: true, required: false })
		declare userEmail: string | null

		@ApiProperty({ type: 'string', nullable: true, required: false })
		declare bucketName: string | null

		@ApiProperty({ type: 'string', nullable: true, required: false })
		declare objectKey: string | null

		@ApiProperty({ type: 'string', format: 'uuid', nullable: true, required: false })
		declare targetGuid: string | null

		@ApiProperty({ type: 'string', nullable: true, required: false })
		declare sourceIp: string | null

		@ApiProperty({ type: 'string', nullable: true, required: false })
		declare userAgent: string | null

		@ApiProperty({ type: 'object', additionalProperties: true, nullable: true, description: 'Operation payload with secrets redacted' })
		declare detail: Record<string, unknown> | null

		@ApiProperty({ type: 'string', format: 'date-time' })
		declare createdAt: Date
	}

	export class ListAuditQuery {
		@ApiProperty({ enum: AuditAction, required: false })
		@IsOptional()
		@IsEnum(AuditAction)
		declare action?: AuditAction

		@ApiProperty({ type: 'string', format: 'uuid', required: false })
		@IsOptional()
		@IsUUID()
		declare userGuid?: string

		@ApiProperty({ type: 'string', required: false })
		@IsOptional()
		@IsString()
		declare bucketName?: string
	}

	export class AuditPage extends Api.PaginatedDataDto<AuditEntry> {
		@ApiProperty({ type: AuditEntry, isArray: true })
		declare data: AuditEntry[]
	}

	export class AuditForbiddenError extends Api.createErrorDto([ErrorCodes.PERMISSION_DENIED]) {}
}
