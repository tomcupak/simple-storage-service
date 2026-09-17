import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UnauthorizedException, Version } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger'
import { AuthDto, AuthService, AuthTypes, AuthUser, PublicEp, SecuredEp } from '@storage/domains/auth'
import { Api } from '@storage/shared'
import { Request } from 'express'

@ApiTags('auth')
@Controller('auth')
export class AuthControllerV1 {
	constructor(
		private readonly authService: AuthService,
	) {}

	@Post('login')
	@Version('1')
	@PublicEp()
	@HttpCode(HttpStatus.OK)
	@ApiOkResponse({ type: AuthDto.TokensResponse })
	@ApiUnauthorizedResponse({ type: AuthDto.UnauthorizedError })
	async login(@Body() body: AuthDto.LoginBody, @Req() req: Request): Promise<AuthDto.TokensResponse> {
		try {
			return await this.authService.login({
				email: body.email,
				password: body.password,
				userAgent: req.headers['user-agent'],
			})
		} catch (err) {
			if (err instanceof AuthTypes.InvalidCredentialsError)
				throw Api.gatewayException(UnauthorizedException, AuthDto.ErrorCodes.INVALID_CREDENTIALS)
			throw err
		}
	}

	@Post('refresh')
	@Version('1')
	@PublicEp()
	@HttpCode(HttpStatus.OK)
	@ApiOkResponse({ type: AuthDto.TokensResponse })
	@ApiUnauthorizedResponse({ type: AuthDto.UnauthorizedError })
	async refresh(@Body() body: AuthDto.RefreshBody): Promise<AuthDto.TokensResponse> {
		try {
			return await this.authService.refresh(body.refreshToken)
		} catch (err) {
			if (err instanceof AuthTypes.InvalidRefreshTokenError)
				throw Api.gatewayException(UnauthorizedException, AuthDto.ErrorCodes.INVALID_REFRESH_TOKEN)
			if (err instanceof AuthTypes.UserDisabledError)
				throw Api.gatewayException(UnauthorizedException, AuthDto.ErrorCodes.USER_DISABLED)
			throw err
		}
	}

	@Post('logout')
	@Version('1')
	@PublicEp()
	@HttpCode(HttpStatus.NO_CONTENT)
	async logout(@Body() body: AuthDto.RefreshBody): Promise<void> {
		await this.authService.logout(body.refreshToken)
	}

	@Get('me')
	@Version('1')
	@SecuredEp()
	@ApiBearerAuth()
	@ApiOkResponse({ type: AuthDto.IdentityResponse })
	me(@AuthUser() user: AuthTypes.Identity): AuthDto.IdentityResponse {
		return user
	}
}
