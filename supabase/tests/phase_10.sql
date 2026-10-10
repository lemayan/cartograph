begin;
create temporary table phase10_fixture(id uuid, run_id uuid);
grant all on phase10_fixture to service_role;
grant select on phase10_fixture to authenticated;
set local role service_role;
do $$ declare own record; result jsonb; roles jsonb; begin
  result := jsonb_build_object('schemaVersion',1,'repository','fixture','adapter','generic','files',jsonb_build_array(
    jsonb_build_object('path','util.ts','folder','.','extension','.ts','lines',1,'hash',repeat('a',64),'module','module','kind',null,'fanIn',0,'fanOut',0)),
    'edges','[]'::jsonb,'coverage',jsonb_build_object('filesParsed',1,'filesFound',1,'filesSkipped',0));
  roles := jsonb_build_array(jsonb_build_object('path','util.ts','hash',repeat('a',64),'role','util','model','gemini-3.8-flash'));
  select * into own from public.begin_repository_analysis('org_phase10_test_a','https://github.com/cartograph/phase10');
  perform public.advance_repository_analysis('org_phase10_test_a',own.analysis_id,own.run_id,'selecting','Selecting',repeat('a',40));
  perform public.advance_repository_analysis('org_phase10_test_a',own.analysis_id,own.run_id,'parsing','Parsing');
  perform public.advance_repository_analysis('org_phase10_test_a',own.analysis_id,own.run_id,'storing','Storing');
  begin
    perform public.store_repository_analysis_with_roles('org_phase10_test_a',own.analysis_id,own.run_id,result,jsonb_set(roles,'{0,role}','"page"'));
    raise exception 'Structural role accepted';
  exception when raise_exception then if sqlerrm <> 'Role references an absent, changed, or convention-labelled file' then raise; end if; end;
  if exists(select 1 from public.files where analysis_id = own.analysis_id) then raise exception 'Invalid role left partial parse'; end if;
  perform public.store_repository_analysis_with_roles('org_phase10_test_a',own.analysis_id,own.run_id,result,roles);
  if exists(select 1 from public.files where analysis_id = own.analysis_id and kind is not null) then raise exception 'AI overwrote adapter kind'; end if;
  if not exists(select 1 from public.file_roles where analysis_id = own.analysis_id and role = 'util') then raise exception 'Role not saved'; end if;
  perform public.save_explanation('org_phase10_test_a',own.analysis_id,own.run_id,'file','util.ts','gemini-3.8-flash',repeat('b',64),jsonb_build_object('util.ts',repeat('a',64)),'Explanation');
  perform public.save_explanation('org_phase10_test_a',own.analysis_id,own.run_id,'folder','.','gemini-3.8-flash',repeat('c',64),jsonb_build_object('util.ts',repeat('a',64)),'Folder explanation');
  begin
    perform public.save_explanation('org_phase10_test_a',own.analysis_id,gen_random_uuid(),'file','util.ts','gemini-3.8-flash',repeat('b',64),jsonb_build_object('util.ts',repeat('a',64)),'Old run');
    raise exception 'Superseded run accepted';
  exception when raise_exception then if sqlerrm <> 'Analysis was replaced; reload the map' then raise; end if; end;
  insert into public.ai_cache(organization_id,task,model,input_hash,content) values('org_phase10_test_a','explain.file','gemini-3.8-flash',repeat('b',64),'Explanation');
  insert into phase10_fixture values(own.analysis_id,own.run_id);
end; $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","o":{"id":"org_phase10_test_a"}}',true);
do $$ begin
  if (select count(*) from public.explanations where analysis_id = (select id from phase10_fixture)) <> 2 then raise exception 'Own explanations absent'; end if;
  if (select count(*) from public.ai_cache where input_hash = repeat('b',64)) <> 1 then raise exception 'Own cache absent'; end if;
  begin
    insert into public.ai_cache values('org_phase10_test_a','explain.file','fake',repeat('d',64),'Forged',now());
    raise exception 'Authenticated cache write allowed';
  exception when insufficient_privilege then null; end;
end; $$;
select set_config('request.jwt.claims','{"role":"authenticated","o":{"id":"org_phase10_test_b"}}',true);
do $$ begin
  if exists(select 1 from public.ai_cache where input_hash = repeat('b',64))
    or exists(select 1 from public.explanations where analysis_id = (select id from phase10_fixture))
    or exists(select 1 from public.file_roles where analysis_id = (select id from phase10_fixture)) then raise exception 'Cross-tenant AI data visible'; end if;
end; $$;
reset role;
do $$ begin
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and (not c.relrowsecurity or not c.relforcerowsecurity)) then raise exception 'RLS not forced on every table'; end if;
end; $$;
rollback;
