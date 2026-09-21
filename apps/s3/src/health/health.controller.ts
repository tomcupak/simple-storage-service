import { Controller, Get, HttpStatus, Res } from '@nestjs/common'
import { Response } from 'express'

import { HealthService } from './health.service'
import { HealthTypes } from './health.types'

/** Operational endpoints of the S3 app: outside the S3 protocol, and outside `S3Guard` - a
 *  probe carries no credentials, and an orchestrator reads a status code, not an XML document. */
@Controller()
export class HealthControllerV1 {
	constructor(
		private readonly healthService: HealthService,
	) {}

	@Get(HealthTypes.LIVENESS_PATH)
	live(): HealthTypes.LivenessResult {
		return this.healthService.live()
	}

	@Get(HealthTypes.READINESS_PATH)
	async ready(@Res() res: Response): Promise<void> {
		const result = await this.healthService.ready()

		// The status code is what an orchestrator reads; the body is for a human looking at
		// which of the two dependencies went.
		res
			.status(result.status === HealthTypes.Status.ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
			.json(result)
	}
}
