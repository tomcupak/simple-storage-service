import { Controller, Get } from '@nestjs/common'
import { PublicEp } from '@storage/domains/auth'

import { AppService } from './app.service'

@Controller()
export class AppController {
	constructor(private readonly appService: AppService) {}

	@Get()
	@PublicEp()
	status() {
		return this.appService.getStatus()
	}
}
