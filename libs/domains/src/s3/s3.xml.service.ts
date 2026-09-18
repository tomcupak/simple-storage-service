import { BucketAcl } from '@storage/database'
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

	/** The `AccessControlPolicy` a `GetBucketAcl` answers with. This deployment stores only the
	 *  canned ACL, so the grant list is the expansion of that one value. */
	static buildAccessControlPolicy({ acl, ownerId }: { acl: BucketAcl, ownerId: string }): string {
		const grants: Record<string, unknown>[] = [{
			Grantee: { '@_xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance', '@_xsi:type': 'CanonicalUser', ID: ownerId },
			Permission: 'FULL_CONTROL',
		}]

		const group = (uri: string, permission: string): Record<string, unknown> => ({
			Grantee: { '@_xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance', '@_xsi:type': 'Group', URI: uri },
			Permission: permission,
		})

		if (acl === BucketAcl.publicRead || acl === BucketAcl.publicReadWrite) grants.push(group(S3Types.ACL_GROUP_URIS.allUsers, 'READ'))
		if (acl === BucketAcl.publicReadWrite) grants.push(group(S3Types.ACL_GROUP_URIS.allUsers, 'WRITE'))
		if (acl === BucketAcl.authenticatedRead) grants.push(group(S3Types.ACL_GROUP_URIS.authenticatedUsers, 'READ'))

		return this.build('AccessControlPolicy', {
			Owner: { ID: ownerId, DisplayName: ownerId },
			AccessControlList: { Grant: grants },
		})
	}

	/** `PutBucketAcl` with an XML body, reduced to the canned ACL that expands to the same
	 *  grants. A grant list this deployment cannot express is rejected rather than rounded down,
	 *  so a client never believes it stored something narrower than it did. */
	static parseAccessControlPolicy(xml: string): BucketAcl {
		const document = this.parseRoot(xml, 'AccessControlPolicy')
		const list = document.AccessControlList
		const grants = this.toArray(typeof list === 'object' && !Array.isArray(list) ? list.Grant : undefined)

		let publicRead = false
		let publicWrite = false
		let authenticatedRead = false

		for (const grant of grants) {
			const grantee = this.toArray(grant.Grantee)[0] ?? {}
			const uri = this.text(grantee.URI)
			const permission = this.text(grant.Permission).toUpperCase()

			// A grant to a named user is the owner's own FULL_CONTROL, which every canned ACL has.
			if (!uri) continue

			const isRead = permission === 'READ' || permission === 'FULL_CONTROL'
			const isWrite = permission === 'WRITE' || permission === 'FULL_CONTROL'

			if (uri === S3Types.ACL_GROUP_URIS.allUsers) {
				publicRead ||= isRead
				publicWrite ||= isWrite
				continue
			}
			if (uri === S3Types.ACL_GROUP_URIS.authenticatedUsers) {
				authenticatedRead ||= isRead
				if (isWrite) throw new S3Types.MalformedXmlError()
				continue
			}

			throw new S3Types.MalformedXmlError()
		}

		if (publicWrite) return BucketAcl.publicReadWrite
		if (publicRead) return BucketAcl.publicRead
		if (authenticatedRead) return BucketAcl.authenticatedRead
		return BucketAcl.private
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
