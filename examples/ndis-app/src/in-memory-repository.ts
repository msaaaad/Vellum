/**
 * A tiny id-keyed store standing in for a real database table — this example's audit trail is
 * genuinely written to Postgres via `@vellum/nestjs`; the business records themselves stay
 * in-memory for simplicity everywhere except Claims/ServiceAgreement (DOMAIN_CHECKLIST.md §6.4
 * specifically needs a real transaction to demonstrate the atomic `enqueue(tx, …)` API).
 */
export class InMemoryRepository<T extends { id: string }> {
  private readonly rows = new Map<string, T>();

  create(row: T): T {
    this.rows.set(row.id, row);
    return row;
  }

  save(row: T): T {
    this.rows.set(row.id, row);
    return row;
  }

  findById(id: string): T | undefined {
    return this.rows.get(id);
  }

  findByIdOrThrow(id: string): T {
    const row = this.rows.get(id);
    if (!row) throw new Error(`not found: ${id}`);
    return row;
  }

  delete(id: string): void {
    this.rows.delete(id);
  }

  list(): T[] {
    return [...this.rows.values()];
  }
}
