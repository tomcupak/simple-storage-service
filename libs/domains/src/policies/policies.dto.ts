import { ApiProperty } from '@nestjs/swagger'
import { Api } from '@storage/shared'
import { IsObject } from 'class-validator'

import { PoliciesTypes } from './policies.types'

export namespace PoliciesDto {
	export enum ErrorCodes {
		INVALID_POLICY_DOCUMENT = 'invalid_policy_document',
		POLICY_NOT_FOUND = 'policy_not_found',
		BUCKET_NOT_FOUND = 'bucket_not_found',
		PERMISSION_DENIED = 'permission_denied',
	}

	export class PolicyResponse {
		@ApiProperty({ type: 'object', additionalProperties: true, nullable: true, description: 'AWS-shaped policy document' })
		declare document: PoliciesTypes.PolicyDocument | null
	}

	export class SetPolicyBody {
		@ApiProperty({ type: 'object', additionalProperties: true, description: 'AWS-shaped policy document (Version + Statement[])' })
		@IsObject()
		declare document: Record<string, unknown>
	}

	export class PolicyBadRequestError extends Api.createErrorDto([ErrorCodes.INVALID_POLICY_DOCUMENT]) {}
	export class PolicyNotFoundError extends Api.createErrorDto([ErrorCodes.POLICY_NOT_FOUND, ErrorCodes.BUCKET_NOT_FOUND]) {}
	export class PolicyForbiddenError extends Api.createErrorDto([ErrorCodes.PERMISSION_DENIED]) {}
}
