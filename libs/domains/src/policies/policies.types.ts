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
		Condition?: Record<string, Record<string, string | string[]>>
	}

	/** The request being authorised, in the terms a policy statement is written in. */
	export interface EvaluationRequest {
		action: string
		/** Full ARN: `arn:aws:s3:::<bucket>` or `arn:aws:s3:::<bucket>/<key>`. */
		resource: string
		/** User guid of the credential owner; undefined for anonymous requests. */
		principalUserGuid?: string
		accessKeyId?: string
		/** Values used by `Condition` operators (sourceIp, secureTransport, prefixes, ...). */
		context?: Record<string, string | string[] | undefined>
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
