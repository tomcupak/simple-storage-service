import { HttpException } from '@nestjs/common'

import { S3Types } from './s3.types'
import { S3XmlService } from './s3.xml.service'

/** Renders an S3-shaped `<Error>` XML body so AWS SDKs can parse the failure.
 *  The S3 app's exception filter turns any thrown instance into that response. */
export class S3Exception extends HttpException {
	constructor(
		public readonly errorCode: S3Types.ErrorCode,
		public readonly resource?: string,
		message?: string,
	) {
		const definition = S3Types.ErrorCodes[errorCode]
		super(
			S3XmlService.buildError({
				code: errorCode,
				message: message ?? definition.message,
				resource,
			}),
			definition.status,
		)
	}
}
