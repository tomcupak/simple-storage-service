import { DrizzleErrorCode, drizzleErrorCode, isUniqueViolation } from './utils'

/** Shape of what Drizzle throws: the driver's error is kept as `cause`, not re-exposed.
 *  (`Error.cause` only entered the lib in ES2022, and this project targets ES2021.) */
const wrapped = (cause: unknown) => Object.assign(new Error('Failed query'), { cause })

const pgError = (code: string) => Object.assign(new Error('duplicate key value violates unique constraint'), { code })

describe('drizzleErrorCode', () => {
	it('reads the code off a plain driver error', () => {
		expect(drizzleErrorCode(pgError('23505'))).toBe('23505')
	})

	it('reaches the code through the wrapper Drizzle throws', () => {
		expect(drizzleErrorCode(wrapped(pgError('23505')))).toBe('23505')
	})

	it('walks more than one level of wrapping', () => {
		expect(drizzleErrorCode(wrapped(wrapped(pgError('23505'))))).toBe('23505')
	})

	it('gives up rather than looping on a self-referencing cause', () => {
		const looping = Object.assign(new Error('boom'), { cause: null })
		looping.cause = looping

		expect(drizzleErrorCode(looping)).toBeUndefined()
	})

	it('returns undefined for errors that carry no code', () => {
		expect(drizzleErrorCode(new Error('plain'))).toBeUndefined()
		expect(drizzleErrorCode(undefined)).toBeUndefined()
		expect(drizzleErrorCode('not an object')).toBeUndefined()
	})
})

describe('isUniqueViolation', () => {
	it('recognises a wrapped unique constraint violation', () => {
		expect(isUniqueViolation(wrapped(pgError(DrizzleErrorCode.UNIQUE_CONSTRAINT_VIOLATION)))).toBe(true)
	})

	it('does not treat another postgres error as one', () => {
		// 23503 is a foreign key violation - a different failure with a different answer.
		expect(isUniqueViolation(wrapped(pgError('23503')))).toBe(false)
	})
})
