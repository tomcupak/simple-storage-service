import { XMLBuilder, XMLParser } from 'fast-xml-parser'

const S3_NAMESPACE = 'http://s3.amazonaws.com/doc/2006-03-01/'

const builder = new XMLBuilder({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	format: false,
	suppressEmptyNode: true,
})

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	parseTagValue: false,
	trimValues: true,
})

/** XML request/response codec for the S3 API. Static because it holds no state and is used
 *  both from controllers and from the exception filter, which runs outside DI. */
export class S3XmlService {
	static build(rootName: string, body: Record<string, unknown>): string {
		return `<?xml version="1.0" encoding="UTF-8"?>${builder.build({
			[rootName]: { '@_xmlns': S3_NAMESPACE, ...body },
		})}`
	}

	static buildError({ code, message, resource, requestId }: {
		code: string
		message: string
		resource?: string
		requestId?: string
	}): string {
		return `<?xml version="1.0" encoding="UTF-8"?>${builder.build({
			Error: {
				Code: code,
				Message: message,
				Resource: resource ?? '',
				RequestId: requestId ?? '',
			},
		})}`
	}

	static parse<T = Record<string, unknown>>(xml: string): T {
		return parser.parse(xml) as T
	}
}
