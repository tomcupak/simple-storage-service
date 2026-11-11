import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common'
import { Response } from 'express'

import { AuthTypes } from './auth.types'

export const AUTHENTICATED_META = 'AUTHENTICATED_META'

export type AuthenticateOptions = {
	type: 'public'
} | {
	type: 'secured'
	/** `undefined` = any authenticated user; `['admin']` = global admins only. */
	roles?: string[]
}

export const SecuredEp = (roles?: string[]) => SetMetadata(AUTHENTICATED_META, {
	type: 'secured',
	roles: Array.isArray(roles) ? roles : undefined,
})

export const PublicEp = () => SetMetadata(AUTHENTICATED_META, { type: 'public' })

/** The authenticated management user, resolved by `AuthGuard`. */
export const AuthUser = createParamDecorator(
	(data: unknown, ctx: ExecutionContext): AuthTypes.Identity => {
		const response = ctx.switchToHttp().getResponse<Response>()
		const user = response.locals.user
		if (!user) throw new Error('No authenticated user on a secured endpoint')
		return user
	},
)
