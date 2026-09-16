import { describe, expect, it } from 'vitest';
import { readMigrationSql } from './migration.js';

describe('readMigrationSql', () => {
  it('reads the versioned 0001_init.sql migration file', () => {
    const sql = readMigrationSql();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS audit_events');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS audit_outbox');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS audit_checkpoints');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
  });

  it('is idempotent SQL — safe to run against an already-migrated database', () => {
    const sql = readMigrationSql();
    // Every CREATE TABLE/POLICY/TRIGGER is guarded; this is what makes `vellum migrate` safe
    // to run more than once (README/ARCHITECTURE.md both promise this).
    expect(sql).not.toMatch(/CREATE TABLE(?! IF NOT EXISTS)/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS/);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS/);
  });
});
