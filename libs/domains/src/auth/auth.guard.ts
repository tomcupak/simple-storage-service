import { CanActivate, ExecutionContext, ForbiddenException, INestApplication, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Request, Response } from 'express'

import { AUTHENTICATED_META, AuthenticateOptions } from './auth.decorators'
import { AuthService } from './auth.service'

/** Global guard for the management API. Endpoints opt out with `@PublicEp()`; everything
 *  else requires a valid access token, and `@SecuredEp(['admin'])` narrows it to admins. */
@Injectable()
export class AuthGuard implements CanActivate {
	private authService: AuthService
	private reflector: Reflector

	constructor(app: INestApplication) {
		this.authService = app.get(AuthService)
		this.reflector = app.get(Reflector)
	}

	canActivate(context: ExecutionContext): boolean {
		const authOptions = this.reflector.get<AuthenticateOptions | undefined>(AUTHENTICATED_META, context.getHandler())
		// Endpoints must declare their access explicitly - an undecorated handler is a bug,
		// and defaulting to "secured" makes that bug loud instead of a silent public hole.
		if (authOptions?.type === 'public') return true

		const req = context.switchToHttp().getRequest<Request>()
		const res = context.switchToHttp().getResponse<Response>()

		const [scheme, token] = (req.headers.authorization ?? '').split(' ')
		if (scheme?.toLowerCase() !== 'bearer' || !token) throw new UnauthorizedException('No access token')

		const identity = this.authService.verifyAccessToken(token)
		if (!identity) throw new UnauthorizedException('Invalid access token')

		res.locals.user = identity

		if (authOptions?.roles?.length && !authOptions.roles.includes(identity.role)) {
			throw new ForbiddenException('Missing role')
		}

		return true
	}
}
