import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common'
import { S3Exception, S3Types, S3XmlService } from '@storage/domains/s3'
import { Response } from 'express'

/** Every failure leaving the S3 app must be an S3-shaped XML `<Error>` document - AWS SDKs
 *  parse the body to decide whether to retry, and a JSON error would break them. */
@Catch()
export class S3ExceptionFilter implements ExceptionFilter {
	private logger = new Logger(S3ExceptionFilter.name)

	catch(exception: unknown, host: ArgumentsHost): void {
		const res = host.switchToHttp().getResponse<Response>()

		if (exception instanceof S3Exception) {
			res.status(exception.getStatus()).type('application/xml').send(exception.getResponse())
			return
		}

		this.logger.error(exception)
		const definition = S3Types.ErrorCodes.InternalError
		res
			.status(definition.status)
			.type('application/xml')
			.send(S3XmlService.buildError({ code: 'InternalError', message: definition.message }))
	}
}
