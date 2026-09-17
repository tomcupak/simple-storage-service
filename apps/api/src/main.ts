import '@nestjs/platform-express'

import { Logger, ValidationPipe, VersioningType } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { migrateDb } from '@storage/database'
import { AuthGuard } from '@storage/domains/auth'

import { config } from './app.config'
import { AppModule } from './app.module'

async function bootstrap() {
	const logger = new Logger('APP')
	const app = await NestFactory.create(AppModule)

	app.enableVersioning({ type: VersioningType.URI })
	app.enableCors({ origin: config.cors.split(',') })
	app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))

	await migrateDb({
		dbCredentials: config.db,
		dbMigrationsPath: config.dbMigrationsPath,
		logger: new Logger('DB'),
	})

	app.useGlobalGuards(new AuthGuard(app))

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
