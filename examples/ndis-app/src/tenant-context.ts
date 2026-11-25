import { getAuditContext } from '@getattestly/nestjs';

export function getTenantIdOrFail(serviceName: string): string {
  const auditContext = getAuditContext();
  if (!auditContext) throw new Error(`${serviceName} called outside an audit context`);
  return auditContext.tenantId;
}
