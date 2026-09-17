import { redirect } from 'next/navigation';

/** `/` posts here (GET, so the tenant id is a query param) purely to turn it into a path
 * segment — `/tenants/[tenantId]` is the real page, entirely server-rendered either way. */
export default function TenantsRedirectPage({
  searchParams,
}: {
  searchParams: { tenantId?: string };
}) {
  const tenantId = searchParams.tenantId?.trim();
  if (tenantId) redirect(`/tenants/${encodeURIComponent(tenantId)}`);
  redirect('/');
}
