import { getPool } from '@/lib/db';
import { queryEvents, type EventFilters } from '@/lib/events';
import { verifyTenantChain } from '@/lib/verify';

export const dynamic = 'force-dynamic'; // always read live — this is a chain browser, not a static page

interface PageProps {
  params: { tenantId: string };
  searchParams: {
    entityType?: string;
    actorId?: string;
    action?: string;
    from?: string;
    to?: string;
  };
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

export default async function TenantDashboardPage({ params, searchParams }: PageProps) {
  const { tenantId } = params;
  const pool = getPool();

  const filters: EventFilters = {
    entityType: searchParams.entityType,
    actorId: searchParams.actorId,
    action: searchParams.action,
    from: searchParams.from,
    to: searchParams.to,
  };

  const [verifyResult, events] = await Promise.all([
    verifyTenantChain(pool, tenantId),
    queryEvents(pool, tenantId, filters),
  ]);

  return (
    <main>
      <div className="meta-row">
        <div>
          <h1>Tenant {tenantId}</h1>
          <p className="readonly-note">
            Reading via the read-only role — this view cannot write to the trail.
          </p>
        </div>
        <a className="export-button" href={`/tenants/${encodeURIComponent(tenantId)}/export`}>
          Export evidence pack (PDF)
        </a>
      </div>

      <div className="card">
        {verifyResult.ok ? (
          <span className="badge verified">✓ chain: verified</span>
        ) : (
          <span className="badge tampered">
            ✗ chain: tampered at seq {verifyResult.brokenAt} ({verifyResult.brokenReason})
          </span>
        )}
        {verifyResult.ok && verifyResult.head && (
          <span className="readonly-note" style={{ marginLeft: 12 }}>
            {verifyResult.count} events · head <code>{shortHash(verifyResult.head)}</code>
          </span>
        )}
      </div>

      <div className="card">
        <h2>Filter</h2>
        <form className="filters" method="get">
          <label>
            Entity
            <input
              type="text"
              name="entityType"
              defaultValue={searchParams.entityType}
              placeholder="Participant"
            />
          </label>
          <label>
            Actor ID
            <input type="text" name="actorId" defaultValue={searchParams.actorId} />
          </label>
          <label>
            Action
            <input
              type="text"
              name="action"
              defaultValue={searchParams.action}
              placeholder="consent.granted"
            />
          </label>
          <label>
            From
            <input type="date" name="from" defaultValue={searchParams.from} />
          </label>
          <label>
            To
            <input type="date" name="to" defaultValue={searchParams.to} />
          </label>
          <button type="submit">Apply</button>
        </form>
      </div>

      <div className="card">
        <h2>Events ({events.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Seq</th>
              <th>Occurred at</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Row hash</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.seq}>
                <td>{event.seq}</td>
                <td>{event.occurredAt}</td>
                <td>{event.actorLabel ?? event.actorId ?? event.actorType}</td>
                <td>{event.action}</td>
                <td>
                  {event.entityType}
                  {event.entityId ? `:${event.entityId}` : ''}
                </td>
                <td>
                  <code>{shortHash(event.rowHash)}</code>
                </td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={6} className="readonly-note">
                  No events match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
