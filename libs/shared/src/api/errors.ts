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

/** `Content-Disposition` for a download, with the file name in both the plain and the
 *  RFC 5987 form so non-ASCII names survive browsers that only read one of them. */
export function contentDisposition(key: string, type: 'attachment' | 'inline' = 'attachment'): string {
	const filename = key.split('/').filter(Boolean).pop() ?? 'download'
	const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')

	return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
