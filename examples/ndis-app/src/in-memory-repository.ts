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

  getByIdOrFail(id: string): T {
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
