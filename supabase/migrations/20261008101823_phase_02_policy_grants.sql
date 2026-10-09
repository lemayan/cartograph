-- Wrap each auth helper directly so the policy uses an init plan and advisors can verify it.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['organizations', 'projects', 'analyses', 'files', 'edges', 'routes', 'explanations', 'file_roles', 'insights']
  loop
    execute format(
      'alter policy organization_read on public.%I using (%I = coalesce((select auth.jwt())->''o''->>''id'', (select auth.jwt())->>''org_id''))',
      table_name, case when table_name = 'organizations' then 'id' else 'organization_id' end
    );
  end loop;
  -- Supabase may provision this DDL helper. It is not an application RPC.
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
