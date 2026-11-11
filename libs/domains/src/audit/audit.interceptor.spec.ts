import { Reflector } from '@nestjs/core'
import { Request } from 'express'

import { AuditInterceptor } from './audit.interceptor'
import { AuditService } from './audit.service'

const mockAuditService = { record: jest.fn() }

describe('AuditInterceptor', () => {
	let interceptor: AuditInterceptor

	beforeEach(() => {
		jest.clearAllMocks()
		interceptor = new AuditInterceptor(mockAuditService as unknown as AuditService, new Reflector())
	})

	describe('detail', () => {
		const detail = (body: unknown) => interceptor['detail']({ body, query: {} } as unknown as Request)

		it('masks a secret at the top level', () => {
			expect(detail({ secretAccessKey: 's3cr3t', host: 'minio' })).toEqual({ secretAccessKey: '[redacted]', host: 'minio' })
		})

		it('masks a secret nested in an object or an array', () => {
			expect(detail({ source: { host: 'minio', secretAccessKey: 's3cr3t' }, list: [{ password: 'p' }] })).toEqual({
				source: { host: 'minio', secretAccessKey: '[redacted]' },
				list: [{ password: '[redacted]' }],
			})
		})
	})
})
