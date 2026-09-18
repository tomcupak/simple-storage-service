import { DbProvider } from '@storage/database'

import { PoliciesService } from './policies.service'
import { PoliciesTypes } from './policies.types'

const mockDb = { core: {} } as unknown as DbProvider

describe('PoliciesService', () => {
	let service: PoliciesService

	beforeEach(() => {
		jest.clearAllMocks()
		service = new PoliciesService(mockDb)
	})

	const makeDocument = (statements: PoliciesTypes.PolicyStatement[]): PoliciesTypes.PolicyDocument => ({
		Version: '2012-10-17',
		Statement: statements,
	})

	const makeRequest = (overrides?: Partial<PoliciesTypes.EvaluationRequest>): PoliciesTypes.EvaluationRequest => ({
		action: 's3:GetObject',
		resource: 'arn:aws:s3:::photos/cat.jpg',
		principalUserGuid: 'user-1',
		...overrides,
	})

	describe('evaluate', () => {
		it('returns notApplicable without a document', () => {
			expect(service.evaluate(null, makeRequest())).toBe(PoliciesTypes.Decision.notApplicable)
		})

		it('allows a matching statement', () => {
			const document = makeDocument([{
				Effect: 'Allow',
				Principal: '*',
				Action: 's3:GetObject',
				Resource: 'arn:aws:s3:::photos/*',
			}])

			expect(service.evaluate(document, makeRequest())).toBe(PoliciesTypes.Decision.allow)
		})

		it('lets an explicit deny win over an allow', () => {
			const document = makeDocument([
				{ Effect: 'Allow', Principal: '*', Action: 's3:*', Resource: 'arn:aws:s3:::photos/*' },
				{ Effect: 'Deny', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::photos/cat.jpg' },
			])

			expect(service.evaluate(document, makeRequest())).toBe(PoliciesTypes.Decision.deny)
		})

		it('does not match a different resource', () => {
			const document = makeDocument([{
				Effect: 'Allow',
				Principal: '*',
				Action: 's3:GetObject',
				Resource: 'arn:aws:s3:::other/*',
			}])

			expect(service.evaluate(document, makeRequest())).toBe(PoliciesTypes.Decision.notApplicable)
		})

		it('matches a principal by user guid', () => {
			const document = makeDocument([{
				Effect: 'Allow',
				Principal: { AWS: ['arn:aws:iam::storage:user/user-1'] },
				Action: 's3:*',
				Resource: 'arn:aws:s3:::photos/*',
			}])

			expect(service.evaluate(document, makeRequest())).toBe(PoliciesTypes.Decision.allow)
			expect(service.evaluate(document, makeRequest({ principalUserGuid: 'user-2' }))).toBe(PoliciesTypes.Decision.notApplicable)
		})

		it('honours NotAction', () => {
			const document = makeDocument([{
				Effect: 'Allow',
				Principal: '*',
				Action: 's3:*',
				NotAction: 's3:DeleteObject',
				Resource: 'arn:aws:s3:::photos/*',
			}])

			expect(service.evaluate(document, makeRequest())).toBe(PoliciesTypes.Decision.allow)
			expect(service.evaluate(document, makeRequest({ action: 's3:DeleteObject' }))).toBe(PoliciesTypes.Decision.notApplicable)
		})
	})

	/** The reference shapes from the AWS bucket-policy examples, checked as a matrix so a change
	 *  to matching cannot quietly widen one axis while narrowing another. */
	describe('action x principal x resource matrix', () => {
		const document = makeDocument([
			{
				Sid: 'PublicReadOnPhotos',
				Effect: 'Allow',
				Principal: '*',
				Action: ['s3:GetObject'],
				Resource: 'arn:aws:s3:::photos/*',
			},
			{
				Sid: 'OneUserWritesReports',
				Effect: 'Allow',
				Principal: { AWS: ['arn:aws:iam::storage:user/user-1'] },
				Action: ['s3:PutObject', 's3:DeleteObject'],
				Resource: 'arn:aws:s3:::photos/reports/*',
			},
			{
				Sid: 'ListingIsForMembersOnly',
				Effect: 'Allow',
				Principal: { AWS: 'arn:aws:iam::storage:user/user-1' },
				Action: 's3:ListBucket',
				Resource: 'arn:aws:s3:::photos',
			},
			{
				Sid: 'SecretsAreOffLimits',
				Effect: 'Deny',
				Principal: '*',
				Action: 's3:*',
				Resource: 'arn:aws:s3:::photos/secret/*',
			},
		])

		const cases: [string, PoliciesTypes.EvaluationRequest, PoliciesTypes.Decision][] = [
			['anonymous reads a public object', { action: 's3:GetObject', resource: 'arn:aws:s3:::photos/cat.jpg' }, PoliciesTypes.Decision.allow],
			['anonymous writes the same object', { action: 's3:PutObject', resource: 'arn:aws:s3:::photos/cat.jpg' }, PoliciesTypes.Decision.notApplicable],
			['the named user writes into reports', { action: 's3:PutObject', resource: 'arn:aws:s3:::photos/reports/q1.pdf', principalUserGuid: 'user-1' }, PoliciesTypes.Decision.allow],
			['another user writes into reports', { action: 's3:PutObject', resource: 'arn:aws:s3:::photos/reports/q1.pdf', principalUserGuid: 'user-2' }, PoliciesTypes.Decision.notApplicable],
			['the named user lists the bucket', { action: 's3:ListBucket', resource: 'arn:aws:s3:::photos', principalUserGuid: 'user-1' }, PoliciesTypes.Decision.allow],
			['anonymous lists the bucket', { action: 's3:ListBucket', resource: 'arn:aws:s3:::photos' }, PoliciesTypes.Decision.notApplicable],
			['a bucket ARN does not match an object pattern', { action: 's3:GetObject', resource: 'arn:aws:s3:::photos' }, PoliciesTypes.Decision.notApplicable],
			['the deny beats the public allow', { action: 's3:GetObject', resource: 'arn:aws:s3:::photos/secret/keys.txt' }, PoliciesTypes.Decision.deny],
			['the deny reaches the writing user too', { action: 's3:DeleteObject', resource: 'arn:aws:s3:::photos/secret/keys.txt', principalUserGuid: 'user-1' }, PoliciesTypes.Decision.deny],
			// Keys are opaque strings, so `..` is part of the key rather than a path step - the
			// resource below is not the secret one and the Deny does not reach it.
			['a traversal-looking key is matched literally', { action: 's3:PutObject', resource: 'arn:aws:s3:::photos/reports/../secret/x', principalUserGuid: 'user-1' }, PoliciesTypes.Decision.allow],
			['another bucket is untouched', { action: 's3:GetObject', resource: 'arn:aws:s3:::documents/cat.jpg' }, PoliciesTypes.Decision.notApplicable],
		]

		it.each(cases)('%s', (_label, request, expected) => {
			expect(service.evaluate(document, request)).toBe(expected)
		})
	})

	describe('conditions', () => {
		const withCondition = (condition: PoliciesTypes.PolicyStatement['Condition']) => makeDocument([{
			Effect: 'Allow',
			Principal: '*',
			Action: 's3:GetObject',
			Resource: 'arn:aws:s3:::photos/*',
			Condition: condition,
		}])

		it('matches an IPv4 address inside a CIDR block', () => {
			const document = withCondition({ IpAddress: { 'aws:SourceIp': '10.0.0.0/8' } })

			expect(service.evaluate(document, makeRequest({ context: { 'aws:SourceIp': '10.1.2.3' } }))).toBe(PoliciesTypes.Decision.allow)
			expect(service.evaluate(document, makeRequest({ context: { 'aws:SourceIp': '192.168.0.1' } }))).toBe(PoliciesTypes.Decision.notApplicable)
		})

		it('reads an IPv4-mapped IPv6 address as the address it carries', () => {
			const document = withCondition({ IpAddress: { 'aws:SourceIp': '10.0.0.0/8' } })

			expect(service.evaluate(document, makeRequest({ context: { 'aws:SourceIp': '::ffff:10.1.2.3' } }))).toBe(PoliciesTypes.Decision.allow)
		})

		it('treats a bare address as a /32', () => {
			const document = withCondition({ IpAddress: { 'aws:SourceIp': '10.1.2.3' } })

			expect(service.evaluate(document, makeRequest({ context: { 'aws:SourceIp': '10.1.2.3' } }))).toBe(PoliciesTypes.Decision.allow)
			expect(service.evaluate(document, makeRequest({ context: { 'aws:SourceIp': '10.1.2.4' } }))).toBe(PoliciesTypes.Decision.notApplicable)
		})

		it('evaluates NotIpAddress as the negation it is', () => {
			const document = withCondition({ NotIpAddress: { 'aws:SourceIp': '10.0.0.0/8' } })

			expect(service.evaluate(document, makeRequest({ context: { 'aws:SourceIp': '192.168.0.1' } }))).toBe(PoliciesTypes.Decision.allow)
			expect(service.evaluate(document, makeRequest({ context: { 'aws:SourceIp': '10.1.2.3' } }))).toBe(PoliciesTypes.Decision.notApplicable)
		})

		it('requires TLS through Bool aws:SecureTransport', () => {
			const document = withCondition({ Bool: { 'aws:SecureTransport': 'true' } })

			expect(service.evaluate(document, makeRequest({ context: { 'aws:SecureTransport': 'true' } }))).toBe(PoliciesTypes.Decision.allow)
			expect(service.evaluate(document, makeRequest({ context: { 'aws:SecureTransport': 'false' } }))).toBe(PoliciesTypes.Decision.notApplicable)
		})

		it('compares s3:prefix with StringEquals and StringLike', () => {
			const exact = withCondition({ StringEquals: { 's3:prefix': ['', 'home/'] } })
			const like = withCondition({ StringLike: { 's3:prefix': 'home/*' } })

			expect(service.evaluate(exact, makeRequest({ context: { 's3:prefix': 'home/' } }))).toBe(PoliciesTypes.Decision.allow)
			expect(service.evaluate(exact, makeRequest({ context: { 's3:prefix': 'home/user-1/' } }))).toBe(PoliciesTypes.Decision.notApplicable)
			expect(service.evaluate(like, makeRequest({ context: { 's3:prefix': 'home/user-1/' } }))).toBe(PoliciesTypes.Decision.allow)
		})

		it('caps a listing through NumericLessThanEquals s3:max-keys', () => {
			const document = withCondition({ NumericLessThanEquals: { 's3:max-keys': '100' } })

			expect(service.evaluate(document, makeRequest({ context: { 's3:max-keys': '50' } }))).toBe(PoliciesTypes.Decision.allow)
			expect(service.evaluate(document, makeRequest({ context: { 's3:max-keys': '1000' } }))).toBe(PoliciesTypes.Decision.notApplicable)
		})

		it('ANDs every key of every operator', () => {
			const document = withCondition({
				Bool: { 'aws:SecureTransport': 'true' },
				IpAddress: { 'aws:SourceIp': '10.0.0.0/8' },
			})

			expect(service.evaluate(document, makeRequest({ context: { 'aws:SecureTransport': 'true', 'aws:SourceIp': '10.0.0.1' } })))
				.toBe(PoliciesTypes.Decision.allow)
			expect(service.evaluate(document, makeRequest({ context: { 'aws:SecureTransport': 'true', 'aws:SourceIp': '192.168.0.1' } })))
				.toBe(PoliciesTypes.Decision.notApplicable)
		})

		it('fails a positive operator when the key is missing, and passes a negated one', () => {
			expect(service.evaluate(withCondition({ IpAddress: { 'aws:SourceIp': '10.0.0.0/8' } }), makeRequest()))
				.toBe(PoliciesTypes.Decision.notApplicable)
			expect(service.evaluate(withCondition({ NotIpAddress: { 'aws:SourceIp': '10.0.0.0/8' } }), makeRequest()))
				.toBe(PoliciesTypes.Decision.allow)
			expect(service.evaluate(withCondition({ IpAddressIfExists: { 'aws:SourceIp': '10.0.0.0/8' } }), makeRequest()))
				.toBe(PoliciesTypes.Decision.allow)
		})

		it('answers Null with whether the key is there at all', () => {
			const document = withCondition({ Null: { 's3:prefix': 'false' } })

			expect(service.evaluate(document, makeRequest({ context: { 's3:prefix': 'home/' } }))).toBe(PoliciesTypes.Decision.allow)
			expect(service.evaluate(document, makeRequest())).toBe(PoliciesTypes.Decision.notApplicable)
		})

		it('does not match an operator it cannot evaluate', () => {
			const document = withCondition({ BinaryEquals: { 'aws:SourceIp': 'whatever' } })

			expect(service.evaluate(document, makeRequest({ context: { 'aws:SourceIp': 'whatever' } }))).toBe(PoliciesTypes.Decision.notApplicable)
		})

		it('lets a conditional Deny through when its condition does not hold', () => {
			const document = makeDocument([
				{ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::photos/*' },
				{
					Effect: 'Deny',
					Principal: '*',
					Action: 's3:GetObject',
					Resource: 'arn:aws:s3:::photos/*',
					Condition: { Bool: { 'aws:SecureTransport': 'false' } },
				},
			])

			expect(service.evaluate(document, makeRequest({ context: { 'aws:SecureTransport': 'true' } }))).toBe(PoliciesTypes.Decision.allow)
			expect(service.evaluate(document, makeRequest({ context: { 'aws:SecureTransport': 'false' } }))).toBe(PoliciesTypes.Decision.deny)
		})
	})

	describe('validate', () => {
		it('rejects a document without statements', () => {
			expect(() => service.validate({ Version: '2012-10-17' } as PoliciesTypes.PolicyDocument))
				.toThrow(PoliciesTypes.InvalidPolicyDocumentError)
		})

		it('rejects an unknown effect', () => {
			const document = makeDocument([{ Effect: 'Maybe' as PoliciesTypes.Effect, Action: 's3:*', Resource: '*' }])
			expect(() => service.validate(document)).toThrow(PoliciesTypes.InvalidPolicyDocumentError)
		})

		it('rejects a Condition that is not a map of operators', () => {
			const document = makeDocument([{
				Effect: 'Allow',
				Action: 's3:*',
				Resource: '*',
				Condition: { IpAddress: '10.0.0.0/8' } as unknown as PoliciesTypes.PolicyStatement['Condition'],
			}])

			expect(() => service.validate(document)).toThrow(PoliciesTypes.InvalidPolicyDocumentError)
		})

		it('accepts a well-formed Condition', () => {
			const document = makeDocument([{
				Effect: 'Allow',
				Action: 's3:*',
				Resource: '*',
				Condition: { IpAddress: { 'aws:SourceIp': ['10.0.0.0/8'] } },
			}])

			expect(() => service.validate(document)).not.toThrow()
		})
	})
})
