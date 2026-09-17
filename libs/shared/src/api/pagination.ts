import { BadRequestException, createParamDecorator } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, Min, ValidateNested, validateSync } from 'class-validator'
import { Request } from 'express'

import { Pagination } from './types'

export function paginate<Item>({ data, limit, page, totalRecords }: {
	data: Item[]
	totalRecords: number | string
	limit: number
	page: number
}): Pagination<Item> {
	const numTotalRecords = Number(totalRecords)
	const totalPagesRemainder = numTotalRecords % limit
	return {
		data,
		pagination: {
			currentPage: page,
			totalPages: Math.floor((numTotalRecords / limit) + (totalPagesRemainder ? 1 : 0)),
			totalRecords: numTotalRecords,
		}
	}
}

class PaginationDto {
	@ApiProperty({ description: 'Total number of items' })
	@IsInt()
	declare totalRecords: number

	@ApiProperty({ description: 'Current page' })
	@IsInt()
	declare currentPage: number

	@ApiProperty({ description: 'Total number of pages' })
	@IsInt()
	declare totalPages: number
}

export abstract class PaginatedDataDto<Item> {
	declare data: Item[]

	@ApiProperty({ description: 'Pagination object', type: PaginationDto })
	@Type(() => PaginationDto)
	@ValidateNested()
	declare pagination: PaginationDto
}

export class PaginationQueryDto {
	@ApiProperty({ description: 'Maximal count of returned items', type: 'integer', minimum: 1, required: false, default: 10 })
	@IsInt()
	@Min(1)
	declare limit: number

	@ApiProperty({ description: 'The returned page (page 1: 0 - <limit> items)', type: 'integer', minimum: 1, required: false, default: 1 })
	@IsInt()
	@Min(1)
	declare page: number
}

export class PaginationQueryEmptyDto {
	@ApiProperty({ description: 'Maximal count of returned items', type: 'integer', minimum: 1, required: false })
	@IsInt()
	@Min(1)
	declare limit: number

	@ApiProperty({ description: 'The returned page (page 1: 0 - <limit> items)', type: 'integer', minimum: 1, required: false })
	@IsInt()
	@Min(1)
	declare page: number
}

export const PagingQuery = createParamDecorator((data: { limit: number, page: number }, ctx) => {
	const req = ctx.switchToHttp().getRequest<Request>()

	const result = new PaginationQueryDto()
	result.limit = Number(req.query.limit || data.limit)
	result.page = Number(req.query.page || data.page)
	const errors = validateSync(result)

	if (errors.length > 0) {
		throw new BadRequestException(
			errors
				.flatMap(error => Object.values(error.constraints || []))
				.map(message => `query: ${message}`)
		)
	}
	return result
})
