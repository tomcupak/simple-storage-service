import { SetMetadata } from '@nestjs/common'
import { AuditAction } from '@storage/database'

export const AUDIT_META = 'AUDIT_META'

/** Marks a handler as audited. `AuditInterceptor` writes one entry per call, recording whether
 *  the handler returned or threw - a rejected attempt is as interesting as a successful one. */
export const Audited = (action: AuditAction) => SetMetadata(AUDIT_META, action)
