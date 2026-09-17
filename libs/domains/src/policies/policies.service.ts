import { Injectable } from '@nestjs/common'
import { coreSchema, DbProvider } from '@storage/database'
import { eq } from 'drizzle-orm'

import { PoliciesTypes } from './policies.types'

@Injectable()
export class PoliciesService {
	constructor(
		private db: DbProvider,
	) {}

	async get(bucketGuid: string): Promise<PoliciesTypes.PolicyDocument | null> {
		const [found] = await this.db.core
			.select()
			.from(coreSchema.bucketPolicy)
			.where(eq(coreSchema.bucketPolicy.bucketGuid, bucketGuid))
			.limit(1)

		return (found?.document as PoliciesTypes.PolicyDocument) ?? null
	}

	async set({ bucketGuid, document, updatedByUserGuid }: {
		bucketGuid: string
		document: PoliciesTypes.PolicyDocument
		updatedByUserGuid?: string
	}): Promise<void> {
		this.validate(document)

		await this.db.core
			.insert(coreSchema.bucketPolicy)
			.values({ bucketGuid, document, updatedByUserGuid: updatedByUserGuid ?? null })
			.onConflictDoUpdate({
				target: coreSchema.bucketPolicy.bucketGuid,
				set: { document, updatedByUserGuid: updatedByUserGuid ?? null, updatedAt: new Date() },
			})
	}

	async delete(bucketGuid: string): Promise<void> {
		await this.db.core
			.delete(coreSchema.bucketPolicy)
			.where(eq(coreSchema.bucketPolicy.bucketGuid, bucketGuid))
	}

	/** Evaluates a request against a policy document using AWS precedence:
	 *  an explicit Deny always wins, otherwise an Allow decides, otherwise the decision is
	 *  left to the caller (ownership / ACL fallback). */
	evaluate(document: PoliciesTypes.PolicyDocument | null, request: PoliciesTypes.EvaluationRequest): PoliciesTypes.Decision {
		if (!document?.Statement?.length) return PoliciesTypes.Decision.notApplicable

		let allowed = false

		for (const statement of document.Statement) {
			if (!this.matchesPrincipal(statement, request)) continue
			if (!this.matchesAction(statement, request.action)) continue
			if (!this.matchesResource(statement, request.resource)) continue

			if (statement.Effect === 'Deny') return PoliciesTypes.Decision.deny
			allowed = true
		}

		return allowed ? PoliciesTypes.Decision.allow : PoliciesTypes.Decision.notApplicable
	}

	validate(document: PoliciesTypes.PolicyDocument): void {
		if (!document || typeof document !== 'object' || !Array.isArray(document.Statement)) {
			throw new PoliciesTypes.InvalidPolicyDocumentError()
		}
		for (const statement of document.Statement) {
			if (statement.Effect !== 'Allow' && statement.Effect !== 'Deny') throw new PoliciesTypes.InvalidPolicyDocumentError()
			if (!statement.Action || !statement.Resource) throw new PoliciesTypes.InvalidPolicyDocumentError()
		}
	}

	private matchesPrincipal(statement: PoliciesTypes.PolicyStatement, request: PoliciesTypes.EvaluationRequest): boolean {
		if (!statement.Principal) return true
		if (statement.Principal === '*') return true

		const principals = this.toArray(statement.Principal.AWS)
		if (principals.includes('*')) return true

		return principals.some((principal) =>
			(request.principalUserGuid && principal.includes(request.principalUserGuid))
			|| (request.accessKeyId && principal.includes(request.accessKeyId)))
	}

	private matchesAction(statement: PoliciesTypes.PolicyStatement, action: string): boolean {
		if (statement.NotAction && this.toArray(statement.NotAction).some((pattern) => this.wildcardMatch(pattern, action))) return false
		return this.toArray(statement.Action).some((pattern) => this.wildcardMatch(pattern, action))
	}

	private matchesResource(statement: PoliciesTypes.PolicyStatement, resource: string): boolean {
		if (statement.NotResource && this.toArray(statement.NotResource).some((pattern) => this.wildcardMatch(pattern, resource))) return false
		return this.toArray(statement.Resource).some((pattern) => this.wildcardMatch(pattern, resource))
	}

	/** AWS policy wildcards: `*` matches any run of characters, `?` a single one. */
	private wildcardMatch(pattern: string, value: string): boolean {
		const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		const regex = new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
		return regex.test(value)
	}

	private toArray(value: string | string[] | undefined): string[] {
		if (!value) return []
		return Array.isArray(value) ? value : [value]
	}
}
