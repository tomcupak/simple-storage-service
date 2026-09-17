import { Injectable, NestMiddleware } from '@nestjs/common'
import { NextFunction, Request, Response } from 'express'

import { config } from '../app.config'

/** Rewrites virtual-host style requests (`https://<bucket>.<S3_ENDPOINT_DOMAIN>/<key>`) to the
 *  path style the controllers route on (`/<bucket>/<key>`).
 *
 *  Only `req.url` is rewritten: SigV4 canonicalisation reads `req.originalUrl`, which must stay
 *  the path the client actually signed. */
@Injectable()
export class S3VirtualHostMiddleware implements NestMiddleware {
	use(req: Request, res: Response, next: NextFunction): void {
		const domain = config.s3.endpointDomain.toLowerCase()
		if (!domain) {
			next()
			return
		}

		const host = (req.headers.host ?? '').split(':')[0].toLowerCase()
		if (host === domain || !host.endsWith(`.${domain}`)) {
			next()
			return
		}

		const bucket = host.slice(0, -(domain.length + 1))
		if (bucket) {
			req.url = req.url === '/' ? `/${bucket}` : `/${bucket}${req.url}`
			res.locals.virtualHostBucket = bucket
		}

		next()
	}
}
