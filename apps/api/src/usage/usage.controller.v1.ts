import { Controller, Get, Version } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { UserRole } from '@storage/database'
import { AuthTypes, AuthUser, SecuredEp } from '@storage/domains/auth'
import { BucketsService } from '@storage/domains/buckets'
import { UsageDto, UsageService } from '@storage/domains/usage'

@ApiTags('usage')
@ApiBearerAuth()
@Controller('usage')
export class UsageControllerV1 {
	constructor(
		private readonly usageService: UsageService,
		private readonly bucketsService: BucketsService,
	) {}

	@Get('buckets')
	@Version('1')
	@SecuredEp()
	@ApiOkResponse({ type: UsageDto.BucketUsageItem, isArray: true })
	async buckets(@AuthUser() user: AuthTypes.Identity): Promise<UsageDto.BucketUsageItem[]> {
		// Admins see the whole deployment; everyone else only the buckets they can already list.
		if (user.role === UserRole.admin) return this.usageService.listBucketUsage()

		const visible = await this.bucketsService.listForUser({ userGuid: user.guid, role: user.role })
		return this.usageService.listBucketUsage(visible.map((bucket) => bucket.guid))
	}

	@Get('users')
	@Version('1')
	@SecuredEp([UserRole.admin])
	@ApiOkResponse({ type: UsageDto.UserUsageItem, isArray: true })
	users(): Promise<UsageDto.UserUsageItem[]> {
		return this.usageService.listUserUsage()
	}
}
