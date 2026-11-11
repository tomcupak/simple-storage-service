import { SetMetadata } from '@nestjs/common'

import { RateLimitTypes } from './rate-limit.types'

export const RATE_LIMIT_BUDGET_KEY = 'rateLimitBudget'

/** Counts the endpoint against its own budget instead of the default one. */
export const RateLimitBudget = (budget: RateLimitTypes.Budget) => SetMetadata(RATE_LIMIT_BUDGET_KEY, budget)
