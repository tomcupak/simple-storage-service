import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'

import { ObjectsDto } from './objects.dto'

/** Query parameters arrive as strings. The app's `ValidationPipe` runs with `transform: true`
 *  but without implicit conversion, so a numeric query field only survives if its DTO declares
 *  the conversion - which is exactly what these assertions pin down. */
describe('ObjectsDto.ListObjectsQuery', () => {
	const parse = (query: Record<string, string>) =>
		plainToInstance(ObjectsDto.ListObjectsQuery, query, { enableImplicitConversion: false })

	it('converts a numeric max-keys from its query string form', () => {
		const parsed = parse({ maxKeys: '100' })

		expect(parsed.maxKeys).toBe(100)
		expect(validateSync(parsed)).toHaveLength(0)
	})

	it('still rejects a max-keys that is not a number', () => {
		expect(validateSync(parse({ maxKeys: 'abc' }))).not.toHaveLength(0)
	})

	it('still rejects a max-keys below the minimum', () => {
		expect(validateSync(parse({ maxKeys: '0' }))).not.toHaveLength(0)
	})

	it('accepts a listing without max-keys at all', () => {
		const parsed = parse({ prefix: 'photos/' })

		expect(parsed.maxKeys).toBeUndefined()
		expect(validateSync(parsed)).toHaveLength(0)
	})
})
