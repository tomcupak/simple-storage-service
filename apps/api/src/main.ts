import '@nestjs/platform-express'

import { Logger, ValidationPipe, VersioningType } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { migrateDb } from '@storage/database'
import { AuthGuard } from '@storage/domains/auth'
import { RateLimitService } from '@storage/domains/rate-limit'
import { json, NextFunction, Request, Response, urlencoded } from 'express'

import { ApiExceptionFilter } from './api.exception-filter'
import { ApiRateLimitGuard } from './api.rate-limit.guard'
import { config } from './app.config'
import { AppModule } from './app.module'

async function bootstrap() {
	const logger = new Logger('APP')
	// The body parsers are registered by hand so the object upload route can be left out of
	// them: its body is the payload and has to reach the handler as an unread stream. A `.json`
	// file arriving as `application/json` would otherwise be parsed and the stream drained.
	const app = await NestFactory.create(AppModule, { bodyParser: false })

	const parseJson = json({ limit: config.body.maxBytes })
	const parseUrlencoded = urlencoded({ extended: true, limit: config.body.maxBytes })
	app.use((req: Request, res: Response, next: NextFunction) => {
		if (config.body.rawPathPattern.test(req.path)) return next()
		parseJson(req, res, (err?: unknown) => (err ? next(err) : parseUrlencoded(req, res, next)))
	})

	app.enableVersioning({ type: VersioningType.URI })
	app.enableCors({ origin: config.cors.split(',') })
	app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))
	// Domain errors become `{ code }` responses here, so handlers stay free of remapping try/catch.
	app.useGlobalFilters(new ApiExceptionFilter())

	await migrateDb({
		dbCredentials: config.db,
		dbMigrationsPath: config.dbMigrationsPath,
		logger: new Logger('DB'),
	})

	// Order is the point: the rate limiter runs after authentication so a signed-in caller is
	// counted per user rather than per address. A request with a bad token is rejected before
	// it reaches the counter - guessing tokens is not what the limiter is here to slow down.
	app.useGlobalGuards(new AuthGuard(app), new ApiRateLimitGuard(app.get(RateLimitService)))

	const swaggerConfig = new DocumentBuilder()
		.setTitle(config.openApi.title)
		.setDescription(config.openApi.description)
		.setVersion(config.openApi.version)
		.addBearerAuth()
		.build()
	SwaggerModule.setup('swagger', app, () => SwaggerModule.createDocument(app, swaggerConfig), {
		jsonDocumentUrl: 'swagger/json',
	})

	await app.listen(config.port, () => logger.log(`Management API listening on port ${config.port}`))
}
void bootstrap()
