import { DynamicModule, Module } from '@nestjs/common'

import { ThumbnailsService } from './thumbnails.service'
import { ThumbnailsTypes } from './thumbnails.types'

@Module({})
export class ThumbnailsModule {
	static forRoot(config: { thumbnails: ThumbnailsTypes.Config }): DynamicModule {
		return {
			module: ThumbnailsModule,
			providers: [
				{
					provide: ThumbnailsService,
					useFactory: () => new ThumbnailsService(config.thumbnails),
				},
			],
			exports: [ThumbnailsService],
			global: true,
		}
	}
}
