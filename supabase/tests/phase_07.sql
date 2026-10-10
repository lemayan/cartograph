-- Run as the migration owner inside a transaction and roll back every fixture.
begin;
create temporary table phase_07_fixture (analysis_id uuid, other_analysis_id uuid, result jsonb);
grant select, insert on phase_07_fixture to service_role;
grant select on phase_07_fixture to authenticated;
set local role service_role;
do $$
declare
  first_run record;
  repeated record;
  other_run record;
  failed_run record;
  result jsonb := '{"schemaVersion":1,"repository":"fixture","adapter":"none","files":[
    {"path":"leaf.ts","folder":".","extension":".ts","lines":1,"hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","module":"module","kind":null,"fanIn":1,"fanOut":0},
    {"path":"entry.ts","folder":".","extension":".ts","lines":1,"hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","module":"module","kind":null,"fanIn":1,"fanOut":2}],
    "edges":[{"source":"entry.ts","target":"leaf.ts","kinds":["import"]},{"source":"entry.ts","target":"entry.ts","kinds":["import"]}],
    "coverage":{"filesFound":2,"filesParsed":2,"filesSkipped":0}}'::jsonb;
begin
  select * into strict first_run from public.begin_repository_analysis('org_cartograph_phase07_a', 'https://github.com/cartograph/fixture');
  select * into strict repeated from public.begin_repository_analysis('org_cartograph_phase07_a', 'https://github.com/cartograph/fixture');
  if not first_run.created or repeated.created or repeated.analysis_id <> first_run.analysis_id then raise exception 'Duplicate submission started another run'; end if;
  if first_run.status <> 'running' or not exists (select 1 from public.analyses where id = first_run.analysis_id and stage = 'fetching') then
    raise exception 'Active status and stage are not separate'; end if;
  begin
    insert into public.analyses (organization_id, project_id)
      select organization_id, project_id from public.analyses where id = first_run.analysis_id;
    raise exception 'A second analysis for one project was accepted';
  exception when unique_violation then null; end;
  begin
    insert into public.analyses (organization_id, project_id, is_seed)
      select organization_id, project_id, true from public.analyses where id = first_run.analysis_id;
    raise exception 'Seed analyses can be recreated';
  exception when check_violation then null; end;
  select * into strict other_run from public.begin_repository_analysis('org_cartograph_phase07_b', 'https://github.com/cartograph/fixture');
  if other_run.analysis_id = first_run.analysis_id then raise exception 'Organizations share an analysis'; end if;
  if public.read_repository_analysis(first_run.analysis_id) is not null then raise exception 'Incomplete result is readable'; end if;
  begin
    perform public.advance_repository_analysis('org_cartograph_phase07_a', first_run.analysis_id, first_run.run_id, 'storing', 'Invalid jump.');
    raise exception 'Skipped stages accepted';
  exception when raise_exception then if sqlerrm = 'Skipped stages accepted' then raise; end if; end;
  perform public.advance_repository_analysis('org_cartograph_phase07_a', first_run.analysis_id, first_run.run_id, 'selecting', 'Selecting.', repeat('a', 40));
  perform public.advance_repository_analysis('org_cartograph_phase07_a', first_run.analysis_id, first_run.run_id, 'parsing', 'Parsing.');
  perform public.advance_repository_analysis('org_cartograph_phase07_a', first_run.analysis_id, first_run.run_id, 'storing', 'Storing.');
  begin
    perform public.store_repository_analysis('org_cartograph_phase07_b', first_run.analysis_id, first_run.run_id, result);
    raise exception 'Cross-team writer binding accepted';
  exception when raise_exception then if sqlerrm = 'Cross-team writer binding accepted' then raise; end if; end;
  begin
    perform public.store_repository_analysis('org_cartograph_phase07_a', first_run.analysis_id, first_run.run_id,
      jsonb_set(result, '{edges,0,target}', '"absent.ts"'::jsonb));
    raise exception 'Missing edge target accepted';
  exception when raise_exception then if sqlerrm = 'Missing edge target accepted' then raise; end if; end;
  if exists (select 1 from public.files where analysis_id = first_run.analysis_id)
    or exists (select 1 from public.edges where analysis_id = first_run.analysis_id)
    or (select status from public.analyses where id = first_run.analysis_id) <> 'running' then raise exception 'Failed store left partial data'; end if;
  perform public.store_repository_analysis('org_cartograph_phase07_a', first_run.analysis_id, first_run.run_id, result);
  if public.read_repository_analysis(first_run.analysis_id) is distinct from result then raise exception 'Parser result changed in storage'; end if;
  if not exists (select 1 from public.analyses where id = first_run.analysis_id and status = 'complete'
    and commit_sha = repeat('a', 40) and finished_at >= started_at) then raise exception 'Completion metadata missing'; end if;
  select * into strict repeated from public.begin_repository_analysis('org_cartograph_phase07_a', 'https://github.com/cartograph/fixture');
  if repeated.created or repeated.status <> 'complete' or repeated.analysis_id <> first_run.analysis_id then raise exception 'Completed analysis was rerun by submission'; end if;
  select * into strict failed_run from public.begin_repository_analysis('org_cartograph_phase07_a', 'https://github.com/cartograph/missing');
  perform public.fail_repository_analysis('org_cartograph_phase07_a', failed_run.analysis_id, failed_run.run_id, 'fetching', 'Repository not found.');
  if not exists (select 1 from public.analyses where id = failed_run.analysis_id and status = 'failed'
    and failure_stage = 'fetching' and failure_message = 'Repository not found.' and finished_at is not null) then raise exception 'Failure metadata missing'; end if;
  insert into pg_temp.phase_07_fixture values (first_run.analysis_id, other_run.analysis_id, result);
end;
$$;
reset role;

do $$
declare signature text;
begin
  if exists (select 1 from public.analyses where is_seed) then raise exception 'Persisted seed rows remain'; end if;
  foreach signature in array array['public.begin_repository_analysis(text,text)',
    'public.advance_repository_analysis(text,uuid,uuid,text,text,text)', 'public.store_repository_analysis(text,uuid,uuid,jsonb)',
    'public.fail_repository_analysis(text,uuid,uuid,text,text)'] loop
    if has_function_privilege('authenticated', signature, 'execute') or has_function_privilege('anon', signature, 'execute') then
      raise exception 'Writer RPC is exposed to a public client: %', signature;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.files', 'insert') or has_table_privilege('authenticated', 'public.analyses', 'update') then
    raise exception 'Authenticated table writes are exposed';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and (not c.relrowsecurity or not c.relforcerowsecurity)) then
    raise exception 'Public table lost forced RLS';
  end if;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","o":{"id":"org_cartograph_phase07_a"}}', true);
do $$ declare fixture record; begin
  select * into strict fixture from pg_temp.phase_07_fixture;
  if public.read_repository_analysis(fixture.analysis_id) is distinct from fixture.result then raise exception 'Own result is unreadable'; end if;
  if public.read_repository_analysis(fixture.other_analysis_id) is not null then raise exception 'Another team analysis leaked'; end if;
  if exists (select 1 from public.files where organization_id <> 'org_cartograph_phase07_a') then raise exception 'Unfiltered file read leaked another team'; end if;
  begin
    perform public.begin_repository_analysis('org_cartograph_phase07_a', 'https://github.com/cartograph/forbidden');
    raise exception 'Authenticated caller invoked the writer';
  exception when insufficient_privilege then null; end;
end; $$;
select set_config('request.jwt.claims', '{"role":"authenticated","org_id":"org_cartograph_phase07_a"}', true);
do $$ begin
  if public.read_repository_analysis((select analysis_id from pg_temp.phase_07_fixture)) is null then raise exception 'Legacy organization claim is unreadable'; end if;
end; $$;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
do $$ begin
  if public.read_repository_analysis((select analysis_id from pg_temp.phase_07_fixture)) is not null then raise exception 'Missing organization claim leaked a result'; end if;
end; $$;
reset role;

do $$ declare fixture record; previous_run uuid; rerun record; begin
  select * into strict fixture from pg_temp.phase_07_fixture;
  select run_id into previous_run from public.analyses where id = fixture.analysis_id;
  select * into strict rerun from public.restart_repository_analysis('org_cartograph_phase07_a', fixture.analysis_id);
  if not rerun.created or rerun.run_id = previous_run then raise exception 'Completed analysis was not deliberately reset'; end if;
  if exists (select 1 from public.files where analysis_id = fixture.analysis_id)
    or exists (select 1 from public.edges where analysis_id = fixture.analysis_id) then raise exception 'Rerun retained previous graph rows'; end if;
  perform public.advance_repository_analysis('org_cartograph_phase07_a', fixture.analysis_id, rerun.run_id, 'selecting', 'Selecting.', repeat('b',40));
  perform public.advance_repository_analysis('org_cartograph_phase07_a', fixture.analysis_id, rerun.run_id, 'parsing', 'Parsing 2 files, 0 skipped.');
  perform public.advance_repository_analysis('org_cartograph_phase07_a', fixture.analysis_id, rerun.run_id, 'storing', 'Storing 2 files.');
  begin
    perform public.store_repository_analysis('org_cartograph_phase07_a', fixture.analysis_id, previous_run, fixture.result);
    raise exception 'Old process stored into replacement';
  exception when raise_exception then if sqlerrm = 'Old process stored into replacement' then raise; end if; end;
  if exists (select 1 from public.files where analysis_id = fixture.analysis_id) then raise exception 'Rejected old process left result rows'; end if;
  perform public.store_repository_analysis('org_cartograph_phase07_a', fixture.analysis_id, rerun.run_id, fixture.result);
  if public.read_repository_analysis(fixture.analysis_id) is distinct from fixture.result then raise exception 'Rerun parser result changed'; end if;
  if (select count(*) from jsonb_object_keys((select stage_messages from public.analyses where id = fixture.analysis_id))) <> 4 then raise exception 'Real stage messages were not retained'; end if;
end; $$;
rollback;
select 'phase_07 database checks passed; fixtures rolled back';
