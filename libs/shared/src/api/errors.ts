import { ForbiddenException } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'
import { IsEnum } from 'class-validator'

/** Wraps an error code into the `{ code }` body every endpoint of this API returns on failure,
 *  so the UI can branch on a stable code instead of parsing messages. */
export function gatewayException(Exception: typeof ForbiddenException, code: string) {
	return new Exception({ code })
}

/** Builds the response DTO for a set of error codes - reference it from
 *  `@ApiBadRequestResponse({ type: ... })` so Swagger lists the possible codes. */
export function createErrorDto<Codes extends string[]>(codes: Codes) {
	class ErrorDto {
		static readonly ErrorCodes = [...codes] as const

		@ApiProperty({
			enum: ErrorDto.ErrorCodes,
			example: ErrorDto.ErrorCodes[0]
		})
		@IsEnum(ErrorDto.ErrorCodes)
		declare code: (typeof ErrorDto.ErrorCodes)[number]
	}

	return ErrorDto
}
