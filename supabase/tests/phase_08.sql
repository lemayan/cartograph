begin;
create temporary table phase_08_fixture (analysis_id uuid, result jsonb, other_id uuid);
grant select, insert on phase_08_fixture to service_role;
grant select on phase_08_fixture to authenticated;
set local role service_role;
do $$ declare own record; other record; result jsonb; invalid jsonb; begin
  result := '{"schemaVersion":1,"repository":"fixture","adapter":"nestjs","files":[
    {"path":"users.controller.ts","folder":".","extension":".ts","lines":3,"hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","module":"module","kind":"controller","fanIn":0,"fanOut":0}],
    "edges":[],"coverage":{"filesFound":1,"filesParsed":1,"filesSkipped":0},"routes":[
    {"file":"users.controller.ts","method":"POST","path":"/api/users","line":3},
    {"file":"users.controller.ts","method":"GET","path":"/api/users/:id","line":2}]}'::jsonb;
  select * into own from public.begin_repository_analysis('org_cartograph_phase08_a','https://github.com/cartograph/routes');
  select * into other from public.begin_repository_analysis('org_cartograph_phase08_b','https://github.com/cartograph/routes');
  perform public.advance_repository_analysis('org_cartograph_phase08_a',own.analysis_id,own.run_id,'selecting','Selecting.',repeat('a',40));
  perform public.advance_repository_analysis('org_cartograph_phase08_a',own.analysis_id,own.run_id,'parsing','Parsing 1 file.');
  perform public.advance_repository_analysis('org_cartograph_phase08_a',own.analysis_id,own.run_id,'storing','Storing 1 file and 2 routes.');
  foreach invalid in array array[
    jsonb_set(result,'{routes,1,file}','"absent.ts"'),
    jsonb_set(result,'{routes,1,method}','"GUESS"'),
    jsonb_set(result,'{routes,1,path}','"not-a-full-pattern"'),
    jsonb_set(result,'{routes,1,line}','0'),
    jsonb_set(result,'{routes,1,line}','4')
  ] loop
    begin
      perform public.store_repository_analysis('org_cartograph_phase08_a',own.analysis_id,own.run_id,invalid);
      raise exception 'Invalid route batch was stored';
    exception when raise_exception then if sqlerrm not like 'A route is invalid%' then raise; end if; end;
    if exists(select 1 from public.files where analysis_id=own.analysis_id)
      or exists(select 1 from public.routes where analysis_id=own.analysis_id) then raise exception 'Route failure left partial files or routes'; end if;
  end loop;
  perform public.store_repository_analysis('org_cartograph_phase08_a',own.analysis_id,own.run_id,result);
  if public.read_repository_analysis(own.analysis_id) is distinct from result then raise exception 'Ordered routes or role metadata changed in readback'; end if;
  if not exists(select 1 from public.analyses where id=own.analysis_id and status='complete' and routes_extracted) then raise exception 'Route extraction was not recorded with completion'; end if;
  insert into pg_temp.phase_08_fixture values(own.analysis_id,result,other.analysis_id);
end; $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","o":{"id":"org_cartograph_phase08_a"}}',true);
do $$ begin
  if public.read_repository_analysis((select analysis_id from pg_temp.phase_08_fixture)) is distinct from (select result from pg_temp.phase_08_fixture) then raise exception 'Own routes unreadable'; end if;
  if (select count(*) from public.routes) <> 2 then raise exception 'Unfiltered route query returned foreign rows'; end if;
  if has_table_privilege('authenticated','public.routes','insert') then raise exception 'Browser can insert routes'; end if;
end; $$;
select set_config('request.jwt.claims','{"role":"authenticated","o":{"id":"org_cartograph_phase08_b"}}',true);
do $$ begin
  if public.read_repository_analysis((select analysis_id from pg_temp.phase_08_fixture)) is not null then raise exception 'Another organization read routes'; end if;
  if exists(select 1 from public.routes) then raise exception 'Another organization sees route rows'; end if;
end; $$;
reset role;
do $$ declare restarted record; begin
  select * into restarted from public.restart_repository_analysis('org_cartograph_phase08_a',(select analysis_id from pg_temp.phase_08_fixture));
  if not restarted.created or exists(select 1 from public.routes where analysis_id=restarted.analysis_id) then raise exception 'Rerun retained old routes'; end if;
end; $$;
rollback;
select 'phase_08 routes passed: exact ordered readback, complete file roles, invalid batch rollback, source positions, RLS and rerun cleanup; fixtures rolled back';
