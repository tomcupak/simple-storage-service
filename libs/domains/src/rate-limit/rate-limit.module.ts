import { DynamicModule, Module } from '@nestjs/common'

import { RateLimitService } from './rate-limit.service'
import { RateLimitTypes } from './rate-limit.types'

@Module({})
export class RateLimitModule {
	static forRoot(config: { rateLimit: RateLimitTypes.Config, valkey: RateLimitTypes.ValkeyConfig }): DynamicModule {
		return {
			module: RateLimitModule,
			providers: [
				{
					provide: RateLimitService,
					useFactory: () => new RateLimitService(config.rateLimit, config.valkey),
				},
			],
			exports: [RateLimitService],
			global: true,
		}
	}
}
