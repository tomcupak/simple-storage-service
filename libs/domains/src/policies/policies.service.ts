import { Injectable } from '@nestjs/common'
import { coreSchema, DbProvider } from '@storage/database'
import { eq } from 'drizzle-orm'

import { PoliciesTypes } from './policies.types'

/** Condition operators whose meaning is "none of the expected values match". A missing
 *  context key satisfies them, exactly as it fails their positive counterparts. */
const NEGATED_OPERATORS = ['StringNotEquals', 'StringNotEqualsIgnoreCase', 'StringNotLike', 'NotIpAddress', 'ArnNotLike', 'ArnNotEquals']

const IF_EXISTS_SUFFIX = 'IfExists'

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
			if (!this.matchesConditions(statement, request)) continue

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
			this.validateCondition(statement.Condition)
		}
	}

	private validateCondition(condition: PoliciesTypes.PolicyStatement['Condition']): void {
		if (condition === undefined) return
		if (typeof condition !== 'object' || condition === null || Array.isArray(condition)) throw new PoliciesTypes.InvalidPolicyDocumentError()

		for (const entries of Object.values(condition)) {
			if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) throw new PoliciesTypes.InvalidPolicyDocumentError()
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

	/** Every key of every operator has to hold - AWS ANDs the whole `Condition` block. */
	private matchesConditions(statement: PoliciesTypes.PolicyStatement, request: PoliciesTypes.EvaluationRequest): boolean {
		if (!statement.Condition) return true

		return Object.entries(statement.Condition).every(([operator, entries]) =>
			Object.entries(entries).every(([key, expected]) => this.matchesCondition({
				operator,
				expected: this.toArray(expected),
				value: request.context?.[key],
			})))
	}

	/** One `<Operator>: { <key>: <values> }` pair. An unknown operator never matches, so a
	 *  statement written against a condition this deployment cannot evaluate stays inert
	 *  instead of granting more than intended. */
	private matchesCondition({ operator, expected, value }: {
		operator: string
		expected: string[]
		value: string | string[] | undefined
	}): boolean {
		const ifExists = operator.endsWith(IF_EXISTS_SUFFIX)
		const base = ifExists ? operator.slice(0, -IF_EXISTS_SUFFIX.length) : operator

		if (base === 'Null') {
			const isMissing = value === undefined || value === ''
			return expected.some((flag) => (flag === 'true') === isMissing)
		}

		const values = this.toArray(value).filter((candidate) => candidate !== '')
		if (values.length === 0) return ifExists || NEGATED_OPERATORS.includes(base)

		switch (base) {
			case 'StringEquals':
			case 'ArnEquals':
				return values.some((candidate) => expected.includes(candidate))
			case 'StringNotEquals':
			case 'ArnNotEquals':
				return values.every((candidate) => !expected.includes(candidate))
			case 'StringEqualsIgnoreCase':
				return values.some((candidate) => expected.some((pattern) => pattern.toLowerCase() === candidate.toLowerCase()))
			case 'StringNotEqualsIgnoreCase':
				return values.every((candidate) => !expected.some((pattern) => pattern.toLowerCase() === candidate.toLowerCase()))
			case 'StringLike':
			case 'ArnLike':
				return values.some((candidate) => expected.some((pattern) => this.wildcardMatch(pattern, candidate)))
			case 'StringNotLike':
			case 'ArnNotLike':
				return values.every((candidate) => !expected.some((pattern) => this.wildcardMatch(pattern, candidate)))
			case 'Bool':
				return values.some((candidate) => expected.includes(candidate))
			case 'IpAddress':
				return values.some((candidate) => expected.some((cidr) => this.ipMatches(cidr, candidate)))
			case 'NotIpAddress':
				return values.every((candidate) => !expected.some((cidr) => this.ipMatches(cidr, candidate)))
			case 'NumericEquals':
			case 'NumericNotEquals':
			case 'NumericLessThan':
			case 'NumericLessThanEquals':
			case 'NumericGreaterThan':
			case 'NumericGreaterThanEquals':
				return values.some((candidate) => this.numericMatches({ operator: base, expected, value: candidate }))
			case 'DateEquals':
			case 'DateNotEquals':
			case 'DateLessThan':
			case 'DateLessThanEquals':
			case 'DateGreaterThan':
			case 'DateGreaterThanEquals':
				return values.some((candidate) => this.dateMatches({ operator: base, expected, value: candidate }))
			default:
				return false
		}
	}

	private numericMatches({ operator, expected, value }: { operator: string, expected: string[], value: string }): boolean {
		const actual = Number(value)
		if (!Number.isFinite(actual)) return false

		const bounds = expected.map(Number).filter((bound) => Number.isFinite(bound))
		if (bounds.length === 0) return false

		switch (operator) {
			case 'NumericEquals': return bounds.some((bound) => actual === bound)
			case 'NumericNotEquals': return bounds.every((bound) => actual !== bound)
			case 'NumericLessThan': return bounds.some((bound) => actual < bound)
			case 'NumericLessThanEquals': return bounds.some((bound) => actual <= bound)
			case 'NumericGreaterThan': return bounds.some((bound) => actual > bound)
			default: return bounds.some((bound) => actual >= bound)
		}
	}

	private dateMatches({ operator, expected, value }: { operator: string, expected: string[], value: string }): boolean {
		const actual = this.toTimestamp(value)
		if (actual === undefined) return false

		const bounds = expected.map((bound) => this.toTimestamp(bound)).filter((bound): bound is number => bound !== undefined)
		if (bounds.length === 0) return false

		switch (operator) {
			case 'DateEquals': return bounds.some((bound) => actual === bound)
			case 'DateNotEquals': return bounds.every((bound) => actual !== bound)
			case 'DateLessThan': return bounds.some((bound) => actual < bound)
			case 'DateLessThanEquals': return bounds.some((bound) => actual <= bound)
			case 'DateGreaterThan': return bounds.some((bound) => actual > bound)
			default: return bounds.some((bound) => actual >= bound)
		}
	}

	/** Epoch seconds (`aws:EpochTime`) or an ISO 8601 timestamp. */
	private toTimestamp(value: string): number | undefined {
		if (/^\d+$/.test(value)) return Number(value) * 1000

		const parsed = Date.parse(value)
		return Number.isNaN(parsed) ? undefined : parsed
	}

	/** `aws:SourceIp` matching: an IPv4 CIDR block, or a bare address treated as a /32.
	 *  IPv4-mapped IPv6 addresses (`::ffff:10.0.0.1`), which is how Node reports a v4 peer on a
	 *  dual-stack socket, are compared as the v4 address they carry. */
	private ipMatches(pattern: string, value: string): boolean {
		const [network, prefixLength] = pattern.split('/')
		const networkBits = this.toIpv4Number(network)
		const valueBits = this.toIpv4Number(value)
		if (networkBits === undefined || valueBits === undefined) return false

		const bits = prefixLength === undefined ? 32 : Number(prefixLength)
		if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false
		if (bits === 0) return true

		const mask = (0xFFFFFFFF << (32 - bits)) >>> 0
		return (networkBits & mask) === (valueBits & mask)
	}

	private toIpv4Number(value: string): number | undefined {
		const address = value.replace(/^::ffff:/i, '')
		const octets = address.split('.')
		if (octets.length !== 4) return undefined

		let result = 0
		for (const octet of octets) {
			if (!/^\d{1,3}$/.test(octet)) return undefined
			const part = Number(octet)
			if (part > 255) return undefined
			result = (result << 8) | part
		}

		return result >>> 0
	}

	/** AWS policy wildcards: `*` matches any run of characters, `?` a single one. */
	private wildcardMatch(pattern: string, value: string): boolean {
		const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		const regex = new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
		return regex.test(value)
	}

	private toArray(value: string | string[] | undefined): string[] {
		if (value === undefined) return []
		return Array.isArray(value) ? value : [value]
	}
}
