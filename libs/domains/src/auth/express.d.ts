import { AuthTypes } from './auth.types'

declare global {
	namespace Express {
		interface Locals {
			user?: AuthTypes.Identity
		}
	}
}
