import { prisma } from '../db.js';

export async function audit(userId: string | undefined, action: string, entity: string, entityId?: string, data?: unknown) {
  await prisma.auditLog.create({ data: { userId, action, entity, entityId, data: data as any } }).catch(() => undefined);
}

export async function activity(candidateId: string, type: string, message: string, userId?: string) {
  await prisma.activity.create({ data: { candidateId, type, message, userId } });
}
