-- Vellum init migration — ARCHITECTURE.md §2 (schema), §7 (RLS + append-only enforcement).
-- Idempotent: safe to re-run against an already-migrated database.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
-- Passwords are NOT set here — that's an ops/secrets concern, not something a
-- versioned migration should bake in. Set one with ALTER ROLE ... WITH PASSWORD
-- (or your platform's equivalent) after running this migration.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vellum_app') THEN
    CREATE ROLE vellum_app WITH LOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vellum_readonly') THEN
    CREATE ROLE vellum_readonly WITH LOGIN;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- audit_events — the chain (§2.1)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_events (
  id           uuid         NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid         NOT NULL,
  seq          bigint       NOT NULL,
  occurred_at  timestamptz  NOT NULL,
  actor_id     text,
  actor_type   text         NOT NULL DEFAULT 'user',
  actor_label  text,
  action       text         NOT NULL,
  entity_type  text         NOT NULL,
  entity_id    text,
  changes      jsonb        NOT NULL DEFAULT '{}',
  metadata     jsonb        NOT NULL DEFAULT '{}',
  hash_version smallint     NOT NULL DEFAULT 1,
  prev_hash    char(64)     NOT NULL,
  row_hash     char(64)     NOT NULL,
  created_at   timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT audit_events_pkey PRIMARY KEY (id),
  CONSTRAINT audit_events_tenant_seq_uniq UNIQUE (tenant_id, seq)
);

CREATE INDEX IF NOT EXISTS audit_events_tenant_time_idx ON audit_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_entity_idx      ON audit_events (tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_events_actor_idx       ON audit_events (tenant_id, actor_id);

-- ---------------------------------------------------------------------------
-- audit_outbox — outbox mode staging table (§2.2)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_outbox (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid        NOT NULL,
  payload     jsonb       NOT NULL,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  attempts    int         NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS audit_outbox_tenant_idx ON audit_outbox (tenant_id, enqueued_at);

-- ---------------------------------------------------------------------------
-- audit_checkpoints — external-anchoring support (§2.3)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_checkpoints (
  id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    uuid        NOT NULL,
  head_seq     bigint      NOT NULL,
  head_hash    char(64)    NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  anchored_ref text
);

-- ---------------------------------------------------------------------------
-- Row-Level Security — tenant isolation (§7)
-- ---------------------------------------------------------------------------

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vellum_tenant_read ON audit_events;
CREATE POLICY vellum_tenant_read ON audit_events FOR SELECT
  USING (tenant_id = current_setting('vellum.tenant_id', true)::uuid);

DROP POLICY IF EXISTS vellum_tenant_write ON audit_events;
CREATE POLICY vellum_tenant_write ON audit_events FOR INSERT
  WITH CHECK (tenant_id = current_setting('vellum.tenant_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- Append-only enforcement (§7)
-- ---------------------------------------------------------------------------

REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM vellum_app;
GRANT  INSERT, SELECT           ON audit_events TO   vellum_app;

CREATE OR REPLACE FUNCTION vellum_forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END
$$;

DROP TRIGGER IF EXISTS vellum_no_mutation ON audit_events;
CREATE TRIGGER vellum_no_mutation BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION vellum_forbid_mutation();

-- ---------------------------------------------------------------------------
-- Outbox / checkpoint grants for the application role
-- ---------------------------------------------------------------------------

GRANT INSERT, SELECT, DELETE ON audit_outbox      TO vellum_app;
GRANT INSERT, SELECT         ON audit_checkpoints TO vellum_app;

-- ---------------------------------------------------------------------------
-- Read-only role for the dashboard (§7) — SELECT only, still subject to RLS.
-- ---------------------------------------------------------------------------

GRANT SELECT ON audit_events TO vellum_readonly;
