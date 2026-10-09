-- Run as the migration owner (SQL/MCP). Every fixture and DDL probe is rolled back.
-- Injected claims test database policies, not Clerk signature verification or browser switching.
begin;

do $$
declare
  team text;
  project uuid;
  analysis uuid;
  first_file uuid;
  second_file uuid;
  expected_tables text[] := array['organizations', 'projects', 'analyses', 'files', 'edges', 'routes', 'explanations', 'file_roles', 'insights'];
  table_name text;
begin
  foreach table_name in array expected_tables loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = table_name
        and c.relrowsecurity and c.relforcerowsecurity
    ) then raise exception 'Missing table or RLS: %', table_name; end if;
    if not exists (
      select 1 from pg_policies where schemaname = 'public'
        and tablename = table_name and policyname = 'organization_read'
    ) then raise exception 'Missing policy: %', table_name; end if;
    if table_name <> 'organizations' and not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', table_name)::regclass
        and confrelid = 'public.organizations'::regclass
        and contype = 'f' and confdeltype = 'c'
    ) then raise exception 'Missing organization cascade: %', table_name; end if;
  end loop;

  foreach team in array array['org_cartograph_test_a', 'org_cartograph_test_b'] loop
    insert into public.organizations (id) values (team);
    insert into public.projects (organization_id, repository_url)
      values (team, 'https://example.invalid/rls-fixture') returning id into project;
    insert into public.analyses (organization_id, project_id)
      values (team, project) returning id into analysis;
    insert into public.files (organization_id, analysis_id, path, folder, extension, lines, hash, module, fan_in, fan_out, parser_order)
      values (team, analysis, 'fixture-a.ts', '.', '.ts', 1, repeat('a', 64), 'module', 0, 1, 1) returning id into first_file;
    insert into public.files (organization_id, analysis_id, path, folder, extension, lines, hash, module, fan_in, fan_out, parser_order)
      values (team, analysis, 'fixture-b.ts', '.', '.ts', 1, repeat('b', 64), 'module', 1, 0, 2) returning id into second_file;
    insert into public.edges (organization_id, analysis_id, source_file_id, target_file_id, kinds, parser_order)
      values (team, analysis, first_file, second_file, array['import'], 1);
    insert into public.routes (organization_id, analysis_id, file_id, method, path)
      values (team, analysis, first_file, 'GET', '/fixture');
    insert into public.explanations (organization_id, analysis_id, file_id, content)
      values (team, analysis, first_file, 'RLS fixture, not an AI explanation.');
    insert into public.file_roles (organization_id, analysis_id, file_id, role)
      values (team, analysis, first_file, 'fixture');
    insert into public.insights (organization_id, analysis_id, content)
      values (team, analysis, 'RLS fixture, not an analysis result.');
  end loop;
end;
$$;

create function pg_temp.assert_org_reads(expected_org text)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  table_name text;
  visible bigint;
  all_owned boolean;
  expected bigint;
begin
  foreach table_name in array array['organizations', 'projects', 'analyses', 'files', 'edges', 'routes', 'explanations', 'file_roles', 'insights'] loop
    execute format('select count(*), bool_and(%I = $1) from public.%I',
      case when table_name = 'organizations' then 'id' else 'organization_id' end, table_name)
      into visible, all_owned using expected_org;
    expected := case when expected_org is null then 0 when table_name = 'files' then 2 else 1 end;
    if visible <> expected or (expected > 0 and all_owned is distinct from true) then
      raise exception 'Wrong rows in % for %: expected %, got %, all owned %', table_name, expected_org, expected, visible, all_owned;
    end if;
  end loop;
end;
$$;

create function pg_temp.assert_writes_denied()
returns void language plpgsql security invoker set search_path = '' as $$
declare
  table_name text;
  ownership_column text;
begin
  foreach table_name in array array['organizations', 'projects', 'analyses', 'files', 'edges', 'routes', 'explanations', 'file_roles', 'insights'] loop
    ownership_column := case when table_name = 'organizations' then 'id' else 'organization_id' end;
    begin
      execute format('insert into public.%I default values', table_name);
      raise exception 'Insert allowed on %', table_name;
    exception when insufficient_privilege then null; end;
    begin
      execute format('update public.%I set %I = %I', table_name, ownership_column, ownership_column);
      raise exception 'Update allowed on %', table_name;
    exception when insufficient_privilege then null; end;
    begin
      execute format('delete from public.%I', table_name);
      raise exception 'Delete allowed on %', table_name;
    exception when insufficient_privilege then null; end;
  end loop;
end;
$$;

-- A forgotten policy must leave a newly created table unreadable.
create table public.phase_02_rls_probe (id integer primary key);
insert into public.phase_02_rls_probe values (1);
grant select on public.phase_02_rls_probe to authenticated;
do $$ begin
  if not exists (select 1 from pg_class where oid = 'public.phase_02_rls_probe'::regclass and relrowsecurity and relforcerowsecurity)
  then raise exception 'New public tables do not have RLS by default'; end if;
end; $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","o":{"id":"org_cartograph_test_a"}}', true);
select pg_temp.assert_org_reads('org_cartograph_test_a');
select pg_temp.assert_writes_denied();
do $$ begin
  if (select count(*) from public.phase_02_rls_probe) <> 0
  then raise exception 'A table without a policy leaked a row'; end if;
end; $$;

select set_config('request.jwt.claims', '{"role":"authenticated","o":{"id":"org_cartograph_test_b"}}', true);
select pg_temp.assert_org_reads('org_cartograph_test_b');
select set_config('request.jwt.claims', '{"role":"authenticated","org_id":"org_cartograph_test_a"}', true);
select pg_temp.assert_org_reads('org_cartograph_test_a');
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select pg_temp.assert_org_reads(null);
select set_config('request.jwt.claims', '{"role":"authenticated","o":{"id":"org_missing"}}', true);
select pg_temp.assert_org_reads(null);

set local role anon;
select pg_temp.assert_writes_denied();
do $$ declare table_name text; begin
  foreach table_name in array array['organizations', 'projects', 'analyses', 'files', 'edges', 'routes', 'explanations', 'file_roles', 'insights'] loop
    begin
      execute format('select count(*) from public.%I', table_name);
      raise exception 'Anonymous reads allowed on %', table_name;
    exception when insufficient_privilege then null; end;
  end loop;
end; $$;
reset role;

-- Privileged writes must also respect tenant foreign keys.
do $$
declare
  other_project uuid;
  own_project uuid;
  own_analysis uuid;
  own_file uuid;
  other_file uuid;
  invalid_status text;
  metadata_project uuid;
begin
  -- A fresh parent avoids the project uniqueness constraint masking the tenant FK check.
  insert into public.projects (organization_id, repository_url)
    values ('org_cartograph_test_b', 'https://example.invalid/cross-team-reference') returning id into other_project;
  select id into strict own_project from public.projects where organization_id = 'org_cartograph_test_a';
  select id into strict own_analysis from public.analyses where organization_id = 'org_cartograph_test_a';
  begin
    insert into public.analyses (organization_id, project_id) values ('org_cartograph_test_a', other_project);
    raise exception 'Cross-team project reference allowed';
  exception when foreign_key_violation then null; end;
  delete from public.projects where id = other_project;
  foreach invalid_status in array array['parsing', 'completed', 'unknown'] loop
    begin
      insert into public.analyses (organization_id, project_id, status)
        values ('org_cartograph_test_a', own_project, invalid_status);
      raise exception 'Invalid state allowed: %', invalid_status;
    exception when check_violation then null; end;
  end loop;
  begin
    insert into public.analyses (organization_id, project_id, commit_sha)
      values ('org_cartograph_test_a', own_project, 'abc1234');
    raise exception 'Truncated commit accepted as a full SHA';
  exception when check_violation then null; end;
  begin
    insert into public.analyses (organization_id, project_id, started_at, finished_at)
      values ('org_cartograph_test_a', own_project, '2026-10-08 10:00:00+00', '2026-10-08 09:00:00+00');
    raise exception 'Backwards lifecycle timestamps accepted';
  exception when check_violation then null; end;
  begin
    insert into public.analyses (organization_id, project_id, failure_message)
      values ('org_cartograph_test_a', own_project, '   ');
    raise exception 'Blank failure message accepted';
  exception when check_violation then null; end;
  -- Synthetic hashes belong only to this rolled-back constraint check.
  insert into public.projects (organization_id, repository_url)
    values ('org_cartograph_test_a', 'https://example.invalid/metadata-complete') returning id into metadata_project;
  insert into public.analyses (organization_id, project_id, status, commit_sha, started_at, finished_at)
    values ('org_cartograph_test_a', metadata_project, 'complete', repeat('a', 40), '2026-10-08 09:00:00+00', '2026-10-08 09:01:00+00');
  insert into public.projects (organization_id, repository_url)
    values ('org_cartograph_test_a', 'https://example.invalid/metadata-running') returning id into metadata_project;
  insert into public.analyses (organization_id, project_id, status, stage, commit_sha, started_at)
    values ('org_cartograph_test_a', metadata_project, 'running', 'parsing', repeat('b', 64), '2026-10-08 09:00:00+00');
  select id into strict own_file from public.files where organization_id = 'org_cartograph_test_a' and path = 'fixture-a.ts';
  select id into strict other_file from public.files where organization_id = 'org_cartograph_test_b' and path = 'fixture-a.ts';
  begin
    insert into public.edges (organization_id, analysis_id, source_file_id, target_file_id, kinds, parser_order)
      values ('org_cartograph_test_a', own_analysis, own_file, other_file, array['import'], 2);
    raise exception 'Cross-team edge endpoint allowed';
  exception when foreign_key_violation then null; end;
end;
$$;

delete from public.organizations where id = 'org_cartograph_test_a';
do $$ declare table_name text; remaining bigint; begin
  foreach table_name in array array['projects', 'analyses', 'files', 'edges', 'routes', 'explanations', 'file_roles', 'insights'] loop
    execute format('select count(*) from public.%I where organization_id = $1', table_name)
      into remaining using 'org_cartograph_test_a';
    if remaining <> 0 then raise exception 'Cascade left rows in %', table_name; end if;
  end loop;
end; $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","o":{"id":"org_cartograph_test_b"}}', true);
select pg_temp.assert_org_reads('org_cartograph_test_b');
reset role;
rollback;
select 'phase_02 database checks passed; fixtures rolled back' as result;
