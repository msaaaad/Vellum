import { redirect } from 'next/navigation';

export default function TenantsRedirectPage({
  searchParams,
}: {
  searchParams: { tenantId?: string };
}) {
  const tenantId = searchParams.tenantId?.trim();
  if (tenantId) redirect(`/tenants/${encodeURIComponent(tenantId)}`);
  redirect('/');
}
