export namespace PoliciesTypes {
	export type Effect = 'Allow' | 'Deny'

	/** AWS-shaped policy document. Only the subset this deployment understands is typed here;
	 *  unknown keys are preserved on write and ignored on evaluation. */
	export interface PolicyDocument {
		Version: string
		Id?: string
		Statement: PolicyStatement[]
	}

	export interface PolicyStatement {
		Sid?: string
		Effect: Effect
		/** `"*"` (anonymous allowed) or `{ AWS: [...] }` with user guids / access key ids. */
		Principal?: '*' | { AWS: string | string[] }
		NotPrincipal?: '*' | { AWS: string | string[] }
		/** e.g. `s3:GetObject`, `s3:*`. */
		Action: string | string[]
		NotAction?: string | string[]
		/** e.g. `arn:aws:s3:::my-bucket/*`. */
		Resource: string | string[]
		NotResource?: string | string[]
		/** `{ IpAddress: { 'aws:SourceIp': ['10.0.0.0/8'] } }` - operator, key, expected values. */
		Condition?: Record<string, Record<string, string | string[]>>
	}

	/** Condition keys resolved from the request. Anything a statement asks for that is not
	 *  in here counts as missing, which fails a positive operator and passes a negated one. */
	export const ConditionKeys = {
		sourceIp: 'aws:SourceIp',
		secureTransport: 'aws:SecureTransport',
		/** Guid of the credential owner - this deployment has no separate user names. */
		username: 'aws:username',
		userId: 'aws:userid',
		referer: 'aws:Referer',
		userAgent: 'aws:UserAgent',
		currentTime: 'aws:CurrentTime',
		epochTime: 'aws:EpochTime',
		prefix: 's3:prefix',
		delimiter: 's3:delimiter',
		maxKeys: 's3:max-keys',
		acl: 's3:x-amz-acl',
	} as const

	/** Values a `Condition` block is evaluated against, keyed by `ConditionKeys`. */
	export type PolicyContext = Record<string, string | string[] | undefined>

	/** The request being authorised, in the terms a policy statement is written in. */
	export interface EvaluationRequest {
		action: string
		/** Full ARN: `arn:aws:s3:::<bucket>` or `arn:aws:s3:::<bucket>/<key>`. */
		resource: string
		/** User guid of the credential owner; undefined for anonymous requests. */
		principalUserGuid?: string
		accessKeyId?: string
		/** Values used by `Condition` operators (sourceIp, secureTransport, prefixes, ...). */
		context?: PolicyContext
	}

	export enum Decision {
		allow = 'allow',
		deny = 'deny',
		/** No statement matched - the caller falls back to ownership/ACL rules. */
		notApplicable = 'not-applicable',
	}

	export class InvalidPolicyDocumentError extends Error { public code = 'invalid_policy_document' }
	export class PolicyNotFoundError extends Error { public code = 'policy_not_found' }
}
