begin;
create temporary table phase_09_fixture (analysis_id uuid, result jsonb);
grant select, insert, update on phase_09_fixture to service_role;
grant select on phase_09_fixture to authenticated;
set local role service_role;
do $$ declare own record; result jsonb; invalid jsonb; legacy jsonb; restarted record; begin
  result := '{"schemaVersion":1,"repository":"fixture","adapter":"express","files":[
    {"path":"app.js","folder":".","extension":".js","lines":3,"hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","module":"module","kind":null,"fanIn":0,"fanOut":1,"commonjsExports":[]},
    {"path":"controllers/user.js","folder":"controllers","extension":".js","lines":3,"hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","module":"script","kind":"controller","fanIn":1,"fanOut":0,"commonjsExports":["default","list"]}],
    "edges":[{"source":"app.js","target":"controllers/user.js","kinds":["import","re-export","dynamic-import","require"]}],
    "coverage":{"filesFound":2,"filesParsed":2,"filesSkipped":0},"routes":[]}'::jsonb;
  select * into own from public.begin_repository_analysis('org_cartograph_phase09_a','https://github.com/cartograph/commonjs');
  perform public.advance_repository_analysis('org_cartograph_phase09_a',own.analysis_id,own.run_id,'selecting','Selecting.',repeat('a',40));
  perform public.advance_repository_analysis('org_cartograph_phase09_a',own.analysis_id,own.run_id,'parsing','Parsing.');
  perform public.advance_repository_analysis('org_cartograph_phase09_a',own.analysis_id,own.run_id,'storing','Storing.');
  foreach invalid in array array[
    jsonb_set(result,'{files,1,commonjsExports}','null'),
    jsonb_set(result,'{files,1,commonjsExports}','"not-an-array"'),
    jsonb_set(result,'{files,1,commonjsExports}','[1]'),
    jsonb_set(result,'{files,1,commonjsExports}','[null]'),
    jsonb_set(result,'{files,1,commonjsExports}','[""]'),
    jsonb_set(result,'{files,1,commonjsExports}','["duplicate","duplicate"]'),
    jsonb_set(result,'{files,1,commonjsExports}','["bad\nname"]')
  ] loop
    begin
      perform public.store_repository_analysis('org_cartograph_phase09_a',own.analysis_id,own.run_id,invalid);
      raise exception 'Invalid CommonJS batch was stored';
    exception when raise_exception then if sqlerrm not like 'Invalid CommonJS export%' then raise; end if; end;
    if exists(select 1 from public.files where analysis_id=own.analysis_id)
      or exists(select 1 from public.edges where analysis_id=own.analysis_id)
      or exists(select 1 from public.analyses where id=own.analysis_id and status='complete') then raise exception 'Export failure left partial results'; end if;
  end loop;
  begin
    perform public.store_repository_analysis('org_cartograph_phase09_a',own.analysis_id,own.run_id,jsonb_set(result,'{edges,0,kinds}','["guessed"]'));
    raise exception 'Invalid module kind was stored';
  exception when check_violation then null; end;
  if exists(select 1 from public.files where analysis_id=own.analysis_id) then raise exception 'Edge failure left partial files'; end if;
  perform public.store_repository_analysis('org_cartograph_phase09_a',own.analysis_id,own.run_id,result);
  if public.read_repository_analysis(own.analysis_id) is distinct from result then raise exception 'CommonJS metadata changed in readback'; end if;
  if exists(select 1 from public.routes where analysis_id=own.analysis_id) then raise exception 'Express routes were invented'; end if;
  insert into pg_temp.phase_09_fixture values(own.analysis_id,result);

  select * into restarted from public.restart_repository_analysis('org_cartograph_phase09_a',own.analysis_id);
  if not restarted.created or exists(select 1 from public.files where analysis_id=own.analysis_id) then raise exception 'Rerun retained old CommonJS files'; end if;
  -- Legacy optional fields remain absent, even when a result is stored by the new RPC.
  legacy := jsonb_set(jsonb_set(result,'{files,0}',(result#>'{files,0}')-'commonjsExports'),'{files,1}',(result#>'{files,1}')-'commonjsExports');
  legacy := jsonb_set(legacy,'{edges,0,kinds}','["import","re-export","dynamic-import"]');
  perform public.advance_repository_analysis('org_cartograph_phase09_a',own.analysis_id,restarted.run_id,'selecting','Selecting.',repeat('a',40));
  perform public.advance_repository_analysis('org_cartograph_phase09_a',own.analysis_id,restarted.run_id,'parsing','Parsing.');
  perform public.advance_repository_analysis('org_cartograph_phase09_a',own.analysis_id,restarted.run_id,'storing','Storing.');
  perform public.store_repository_analysis('org_cartograph_phase09_a',own.analysis_id,restarted.run_id,legacy);
  if public.read_repository_analysis(own.analysis_id) is distinct from legacy then raise exception 'Legacy shape changed'; end if;
  -- Tenant reads must return exactly the shape currently stored.
  update pg_temp.phase_09_fixture set result=legacy;
end; $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","o":{"id":"org_cartograph_phase09_a"}}',true);
do $$ begin
  if public.read_repository_analysis((select analysis_id from pg_temp.phase_09_fixture)) is distinct from (select result from pg_temp.phase_09_fixture) then raise exception 'Own CommonJS graph unreadable'; end if;
  if (select count(*) from public.files) <> 2 or (select count(*) from public.edges) <> 1 then raise exception 'Unfiltered tenant query returned wrong rows'; end if;
  if has_table_privilege('authenticated','public.files','insert') or has_table_privilege('authenticated','public.edges','insert') then raise exception 'Browser can insert parser data'; end if;
end; $$;
select set_config('request.jwt.claims','{"role":"authenticated","o":{"id":"org_cartograph_phase09_b"}}',true);
do $$ begin
  if public.read_repository_analysis((select analysis_id from pg_temp.phase_09_fixture)) is not null then raise exception 'Other tenant read CommonJS graph'; end if;
  if exists(select 1 from public.files) or exists(select 1 from public.edges) then raise exception 'Other tenant sees parser rows'; end if;
end; $$;
reset role;
rollback;
select 'phase_09 passed: mixed edge kinds, ordered export metadata, invalid batch rollback, empty Express routes, legacy shape, RLS and rerun cleanup; fixtures rolled back';
