export default function HomePage() {
  return (
    <main>
      <h1>Vellum Dashboard</h1>
      <p className="subtitle">
        Read-only chain browser — every read goes through the <code>vellum_readonly</code> role,
        which the migration grants <code>SELECT</code> only. This app cannot write to or mutate the
        trail.
      </p>
      <div className="card">
        <h2>View a tenant&apos;s chain</h2>
        <form action="/tenants" method="get" className="filters">
          <label>
            Tenant ID
            <input
              type="text"
              name="tenantId"
              placeholder="00000000-0000-0000-0000-000000000000"
              required
            />
          </label>
          <button type="submit">Open</button>
        </form>
      </div>
    </main>
  );
}
