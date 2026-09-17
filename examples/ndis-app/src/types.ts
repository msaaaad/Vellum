// Domain types for the NDIS provider demo — DOMAIN_CHECKLIST.md Phase 6. Deliberately small:
// the point of this example is exercising `@vellum/nestjs`'s audit wiring correctly across a
// realistic set of entities, not modelling a full NDIS provider's data model.

export interface Participant {
  id: string;
  fullName: string;
  dateOfBirth: string;
  ndisNumber: string;
  primaryDisability: string;
  createdAt: string;
  updatedAt: string;
}

export type ConsentMethod = 'written' | 'verbal' | 'electronic';
export type ConsentRelationship = 'self' | 'guardian' | 'nominee';

export interface Consent {
  id: string;
  participantId: string;
  method: ConsentMethod;
  relationship: ConsentRelationship;
  signatureImage: string | null;
  status: 'granted' | 'revoked';
  grantedAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
}

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Incident {
  id: string;
  participantId: string;
  description: string;
  clinicalNotes: string;
  severity: IncidentSeverity;
  reportable: boolean;
  status: 'open' | 'closed';
  outcome: string | null;
  createdAt: string;
}

export interface ServiceAgreement {
  id: string;
  tenantId: string;
  participantId: string;
  ndisPlanPeriod: string;
  status: 'draft' | 'active';
  createdAt: string;
  updatedAt: string;
}

export type ClaimStatus = 'draft' | 'submitted' | 'approved' | 'paid';

export interface Claim {
  id: string;
  tenantId: string;
  serviceAgreementId: string;
  participantId: string;
  ndisPeriod: string;
  amountCents: number;
  bankAccount: string;
  status: ClaimStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Role {
  id: string;
  workerId: string;
  roleName: string;
  assignedAt: string;
  revokedAt: string | null;
}

export interface WorkerScreening {
  id: string;
  workerId: string;
  checkType: string;
  expiresAt: string;
  updatedAt: string;
}
