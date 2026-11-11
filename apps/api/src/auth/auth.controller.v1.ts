import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger'
import { AuditAction } from '@storage/database'
import { Audited } from '@storage/domains/audit'
import { AuthDto, AuthService, AuthTypes, AuthUser, PublicEp, SecuredEp } from '@storage/domains/auth'
import { Request } from 'express'

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthControllerV1 {
	constructor(
		private readonly authService: AuthService,
	) {}

	@Post('login')
	@PublicEp()
	@Audited(AuditAction.userLogin)
	@HttpCode(HttpStatus.OK)
	@ApiOkResponse({ type: AuthDto.TokensResponse })
	@ApiUnauthorizedResponse({ type: AuthDto.UnauthorizedError })
	login(@Body() body: AuthDto.LoginBody, @Req() req: Request): Promise<AuthDto.TokensResponse> {
		return this.authService.login({
			email: body.email,
			password: body.password,
			userAgent: req.headers['user-agent'],
		})
	}

	@Post('refresh')
	@PublicEp()
	@HttpCode(HttpStatus.OK)
	@ApiOkResponse({ type: AuthDto.TokensResponse })
	@ApiUnauthorizedResponse({ type: AuthDto.UnauthorizedError })
	refresh(@Body() body: AuthDto.RefreshBody): Promise<AuthDto.TokensResponse> {
		return this.authService.refresh(body.refreshToken)
	}

	@Post('logout')
	@PublicEp()
	@HttpCode(HttpStatus.NO_CONTENT)
	async logout(@Body() body: AuthDto.RefreshBody): Promise<void> {
		await this.authService.logout(body.refreshToken)
	}

	@Get('me')
	@SecuredEp()
	@ApiBearerAuth()
	@ApiOkResponse({ type: AuthDto.IdentityResponse })
	me(@AuthUser() user: AuthTypes.Identity): AuthDto.IdentityResponse {
		return user
	}
}
