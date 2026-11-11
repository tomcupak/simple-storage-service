import { RateLimitService } from './rate-limit.service'

const mockClient = { incr: jest.fn(), expire: jest.fn() }

function makeService(config: Partial<{ enabled: boolean }> = {}): RateLimitService {
	const service = new RateLimitService({ enabled: true, windowSeconds: 60, max: 600, thumbnailMax: 3000, ...config }, { host: 'x', port: 1 })
	Object.assign(service, { client: mockClient, available: true })
	return service
}

describe('RateLimitService', () => {
	beforeEach(() => {
		jest.clearAllMocks()
		mockClient.incr.mockResolvedValue(1)
	})

	it('counts the default budget under the original key with the default ceiling', async () => {
		const decision = await makeService().consume({ kind: 'user', id: 'u1' })

		expect(mockClient.incr).toHaveBeenCalledWith(expect.stringMatching(/^ratelimit:user:u1:\d+$/))
		expect(decision).toEqual(expect.objectContaining({ allowed: true, limit: 600, remaining: 599 }))
	})

	it('counts the thumbnail budget under a separate key with its own ceiling', async () => {
		const decision = await makeService().consume({ kind: 'user', id: 'u1' }, 'thumbnail')

		expect(mockClient.incr).toHaveBeenCalledWith(expect.stringMatching(/^ratelimit:thumbnail:user:u1:\d+$/))
		expect(decision).toEqual(expect.objectContaining({ allowed: true, limit: 3000, remaining: 2999 }))
	})

	it('blocks once the budget ceiling is passed, per budget', async () => {
		mockClient.incr.mockResolvedValue(601)

		const normal = await makeService().consume({ kind: 'user', id: 'u1' })
		const thumbnail = await makeService().consume({ kind: 'user', id: 'u1' }, 'thumbnail')

		expect(normal.allowed).toBe(false)
		expect(thumbnail.allowed).toBe(true)
	})

	it('lets everything through when disabled, reporting the budget limit', async () => {
		const decision = await makeService({ enabled: false }).consume({ kind: 'ip', id: '1.2.3.4' }, 'thumbnail')

		expect(mockClient.incr).not.toHaveBeenCalled()
		expect(decision).toEqual(expect.objectContaining({ allowed: true, limit: 3000 }))
	})
})
