import { prisma } from '../db.js';
import { currentIp, currentUserId } from '../context.js';
import { logger } from '../logger.js';

/**
 * Audit log of every create/update/delete on business records:
 * who, when, before/after. Called explicitly by services inside their flows.
 * Never throws — an audit failure must not break the business operation.
 */
export async function audit(
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'VOID' | 'LOGIN' | 'LOGOUT' | 'IMPORT' | 'EXPORT' | 'HANDOVER' | 'SEND',
  entity: string,
  entityId: string | number | null,
  before?: unknown,
  after?: unknown,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: currentUserId() ?? null,
        action,
        entity,
        entityId: entityId === null ? null : String(entityId),
        before: before === undefined ? undefined : (JSON.parse(JSON.stringify(before)) as object),
        after: after === undefined ? undefined : (JSON.parse(JSON.stringify(after)) as object),
        ip: currentIp() ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, action, entity, entityId }, 'audit log write failed');
  }
}
