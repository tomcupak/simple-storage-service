import { XMLBuilder, XMLParser } from 'fast-xml-parser'

import { S3Types } from './s3.types'

const S3_NAMESPACE = 'http://s3.amazonaws.com/doc/2006-03-01/'

/** Everything a parsed XML document can hold: `parseTagValue: false` keeps every leaf a string,
 *  and repeated elements come back as arrays. */
type ParsedValue = string | ParsedNode | ParsedValue[] | undefined
interface ParsedNode { [element: string]: ParsedValue }

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

	/** `<CompleteMultipartUpload><Part><PartNumber/><ETag/></Part>...` */
	static parseCompleteMultipartUpload(xml: string): S3Types.CompleteMultipartUploadRequest {
		const document = this.parseRoot(xml, 'CompleteMultipartUpload')

		return {
			parts: this.toArray(document.Part).map((part) => ({
				partNumber: Number(this.text(part.PartNumber)),
				etag: this.text(part.ETag).replace(/"/g, ''),
			})),
		}
	}

	/** `<Delete><Object><Key/><VersionId/></Object>...<Quiet/></Delete>` */
	static parseDelete(xml: string): S3Types.DeleteRequest {
		const document = this.parseRoot(xml, 'Delete')

		return {
			quiet: this.text(document.Quiet) === 'true',
			objects: this.toArray(document.Object).map((entry) => ({
				key: this.text(entry.Key),
				versionId: entry.VersionId === undefined ? undefined : this.text(entry.VersionId),
			})),
		}
	}

	/** `<VersioningConfiguration><Status>Enabled|Suspended</Status></VersioningConfiguration>` */
	static parseVersioningConfiguration(xml: string): 'Enabled' | 'Suspended' {
		const document = this.parseRoot(xml, 'VersioningConfiguration')
		const status = this.text(document.Status)

		if (status !== 'Enabled' && status !== 'Suspended') throw new S3Types.MalformedXmlError()
		return status
	}

	/** `<CORSConfiguration><CORSRule><AllowedOrigin/>...</CORSRule>...</CORSConfiguration>` */
	static parseCorsConfiguration(xml: string): S3Types.CorsConfiguration {
		const document = this.parseRoot(xml, 'CORSConfiguration')

		return {
			rules: this.toArray(document.CORSRule).map((rule) => ({
				id: rule.ID === undefined ? undefined : this.text(rule.ID),
				allowedOrigins: this.toArray(rule.AllowedOrigin).map((value) => this.text(value)),
				allowedMethods: this.toArray(rule.AllowedMethod).map((value) => this.text(value)),
				allowedHeaders: this.toArray(rule.AllowedHeader).map((value) => this.text(value)),
				exposeHeaders: this.toArray(rule.ExposeHeader).map((value) => this.text(value)),
				maxAgeSeconds: rule.MaxAgeSeconds === undefined ? undefined : Number(this.text(rule.MaxAgeSeconds)),
			})),
		}
	}

	/** The XML body of a `CORSConfiguration`, as `GetBucketCors` returns it. */
	static buildCorsConfiguration(configuration: S3Types.CorsConfiguration): string {
		return this.build('CORSConfiguration', {
			CORSRule: configuration.rules.map((rule) => ({
				ID: rule.id,
				AllowedOrigin: rule.allowedOrigins,
				AllowedMethod: rule.allowedMethods,
				AllowedHeader: rule.allowedHeaders?.length ? rule.allowedHeaders : undefined,
				ExposeHeader: rule.exposeHeaders?.length ? rule.exposeHeaders : undefined,
				MaxAgeSeconds: rule.maxAgeSeconds,
			})),
		})
	}

	/** Leaf text of an element, which an empty element or a missing one reduces to `''`. */
	private static text(value: ParsedValue): string {
		if (value === undefined || value === null) return ''
		if (typeof value === 'string') return value
		if (Array.isArray(value)) return this.text(value[0])
		return this.text(value['#text'])
	}

	/** A document whose root element is missing or misnamed is not a request we can act on. */
	private static parseRoot(xml: string, rootName: string): ParsedNode {
		const parsed = this.parse<Record<string, unknown>>(xml || '')
		const root = parsed?.[rootName]

		if (!root || typeof root !== 'object') throw new S3Types.MalformedXmlError()
		return root as ParsedNode
	}

	/** fast-xml-parser collapses a single repeated element into a scalar. */
	private static toArray(value: ParsedValue): ParsedNode[] {
		if (value === undefined || value === null) return []
		return (Array.isArray(value) ? value : [value]) as ParsedNode[]
	}
}
