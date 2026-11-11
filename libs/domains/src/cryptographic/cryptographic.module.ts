import { DynamicModule, Module } from '@nestjs/common'

import { CryptographicConfig, CryptographicService } from './cryptographic.service'

@Module({})
export class CryptographicModule {
	static forRoot(config: CryptographicConfig): DynamicModule {
		return {
			module: CryptographicModule,
			providers: [
				{
					provide: CryptographicService,
					useFactory: () => new CryptographicService(config),
				},
			],
			exports: [CryptographicService],
			global: true,
		}
	}
}
