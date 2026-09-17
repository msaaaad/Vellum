import type { Pool } from 'pg';

/**
 * This example's own tiny business schema — separate from Vellum's `audit_events`/`audit_outbox`
 * migration (packages/storage-pg/migrations/0001_init.sql). No RLS/append-only enforcement here:
 * these are ordinary application tables, not the audit trail. Idempotent, like Vellum's own
 * migration, so re-running the seed script against an already-set-up database is safe.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS example_service_agreements (
  id               uuid        NOT NULL PRIMARY KEY,
  tenant_id        uuid        NOT NULL,
  participant_id   uuid        NOT NULL,
  ndis_plan_period text        NOT NULL,
  status           text        NOT NULL DEFAULT 'draft',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS example_claims (
  id                    uuid        NOT NULL PRIMARY KEY,
  tenant_id             uuid        NOT NULL,
  service_agreement_id  uuid        NOT NULL,
  participant_id        uuid        NOT NULL,
  ndis_period           text        NOT NULL,
  amount_cents          bigint      NOT NULL,
  bank_account          text        NOT NULL,
  status                text        NOT NULL DEFAULT 'draft',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
`;

export async function ensureDomainSchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA_SQL);
}
