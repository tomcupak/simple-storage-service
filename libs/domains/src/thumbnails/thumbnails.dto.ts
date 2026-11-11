import { ApiProperty } from '@nestjs/swagger'
import { Api } from '@storage/shared'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator'

import { ThumbnailsTypes } from './thumbnails.types'

export namespace ThumbnailsDto {
	export enum ErrorCodes {
		THUMBNAIL_UNSUPPORTED = 'thumbnail_unsupported',
		THUMBNAIL_SOURCE_TOO_LARGE = 'thumbnail_source_too_large',
	}

	export class ThumbnailQuery {
		@ApiProperty({ type: 'string' })
		@IsString()
		declare key: string

		@ApiProperty({ type: 'string', required: false, description: 'Defaults to the newest version' })
		@IsOptional()
		@IsString()
		declare versionId?: string

		@ApiProperty({ type: 'integer', required: false, enum: ThumbnailsTypes.SIZES, default: ThumbnailsTypes.DEFAULT_SIZE, description: 'Edge of the box the thumbnail fits inside' })
		@IsOptional()
		@Type(() => Number)
		@IsInt()
		@IsIn(ThumbnailsTypes.SIZES)
		declare size?: number
	}

	export class ThumbnailUnsupportedError extends Api.createErrorDto([ErrorCodes.THUMBNAIL_UNSUPPORTED]) {}
	export class ThumbnailSourceTooLargeError extends Api.createErrorDto([ErrorCodes.THUMBNAIL_SOURCE_TOO_LARGE]) {}
}
