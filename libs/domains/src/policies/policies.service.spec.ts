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

	describe('validate', () => {
		it('rejects a document without statements', () => {
			expect(() => service.validate({ Version: '2012-10-17' } as PoliciesTypes.PolicyDocument))
				.toThrow(PoliciesTypes.InvalidPolicyDocumentError)
		})

		it('rejects an unknown effect', () => {
			const document = makeDocument([{ Effect: 'Maybe' as PoliciesTypes.Effect, Action: 's3:*', Resource: '*' }])
			expect(() => service.validate(document)).toThrow(PoliciesTypes.InvalidPolicyDocumentError)
		})
	})
})
