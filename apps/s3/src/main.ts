import '@nestjs/platform-express'

import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

import { config } from './app.config'
import { AppModule } from './app.module'
import { S3ExceptionFilter } from './s3/s3.exception-filter'

async function bootstrap() {
	const logger = new Logger('S3')
	// Raw body passthrough: object payloads are streamed to disk, never buffered or parsed,
	// and SigV4 verification needs the bytes exactly as sent.
	const app = await NestFactory.create(AppModule, { bodyParser: false })

	app.useGlobalFilters(new S3ExceptionFilter())

	await app.listen(config.port, () => logger.log(`S3 API listening on port ${config.port}`))
}
void bootstrap()
