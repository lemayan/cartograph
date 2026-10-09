begin;
create temporary table progress_fixture (analysis_id uuid, run_id uuid, other_id uuid);
grant select, insert on progress_fixture to service_role;
grant select on progress_fixture to authenticated;
set local role service_role;
do $$ declare own record; other record; restarted record; begin
  select * into own from public.begin_repository_analysis('org_cartograph_progress_a', 'https://github.com/cartograph/progress');
  select * into other from public.begin_repository_analysis('org_cartograph_progress_b', 'https://github.com/cartograph/progress');
  insert into pg_temp.progress_fixture values (own.analysis_id, own.run_id, other.analysis_id);
  if not exists (select 1 from realtime.messages where topic = 'analysis:' || own.analysis_id::text
    and private and event = 'progress' and payload = '{"status":"running","stage":"fetching","message":"Fetching the public repository archive."}') then
    raise exception 'Reservation did not publish minimal private progress'; end if;
  select * into restarted from public.restart_repository_analysis('org_cartograph_progress_a', own.analysis_id);
  if restarted.created then raise exception 'Fresh active run can be reset'; end if;
  perform public.advance_repository_analysis('org_cartograph_progress_a', own.analysis_id, own.run_id, 'selecting', 'Selecting.', repeat('a',40));
  perform public.advance_repository_analysis('org_cartograph_progress_a', own.analysis_id, own.run_id, 'parsing', 'Parsing 0 files, 0 skipped.');
  perform public.advance_repository_analysis('org_cartograph_progress_a', own.analysis_id, own.run_id, 'storing', 'Storing 0 files.');
  perform public.store_repository_analysis('org_cartograph_progress_a', own.analysis_id, own.run_id,
    '{"schemaVersion":1,"repository":"fixture","adapter":"none","files":[],"edges":[],"coverage":{"filesFound":0,"filesParsed":0,"filesSkipped":0}}');
  select * into restarted from public.restart_repository_analysis('org_cartograph_progress_a', own.analysis_id);
  if not restarted.created or restarted.analysis_id <> own.analysis_id or restarted.run_id = own.run_id then raise exception 'Completed rerun did not keep analysis and replace generation'; end if;
  perform public.fail_repository_analysis('org_cartograph_progress_a', own.analysis_id, restarted.run_id, 'fetching', 'Repository was not found.');
  if not exists (select 1 from realtime.messages where topic = 'analysis:' || own.analysis_id::text
    and payload = '{"status":"failed","stage":"fetching","message":"Repository was not found."}') then raise exception 'Failure was not published'; end if;
  if (select count(*) from realtime.messages where topic = 'analysis:' || own.analysis_id::text) <> 7 then raise exception 'Expected seven committed progress transitions'; end if;
  if exists (select 1 from realtime.messages where topic = 'analysis:' || own.analysis_id::text
    and (not private or event <> 'progress' or (select count(*) from jsonb_object_keys(payload)) <> 3
      or not payload ?& array['status','stage','message'])) then raise exception 'Broadcast contains unintended fields'; end if;
end; $$;
reset role;

set local role authenticated;
select set_config('realtime.topic', 'analysis:' || analysis_id::text, true) from pg_temp.progress_fixture;
select set_config('request.jwt.claims', '{"role":"authenticated","o":{"id":"org_cartograph_progress_a"}}', true);
do $$ begin if (select count(*) from realtime.messages) <> 7 then raise exception 'Own organization does not see seven messages on this topic'; end if; end; $$;
select set_config('request.jwt.claims', '{"role":"authenticated","o":{"id":"org_cartograph_progress_b"}}', true);
do $$ begin if (select count(*) from realtime.messages) <> 0 then raise exception 'Other organization sees messages on the same topic'; end if; end; $$;
reset role;

do $$ declare own uuid; other uuid; previous_run uuid; current_run record; decision record; topic text; claims text; begin
  select analysis_id, run_id, other_id into own, previous_run, other from pg_temp.progress_fixture;
  claims := '{"role":"authenticated","o":{"id":"org_cartograph_progress_a"}}';
  foreach topic in array array['analysis:' || own::text, 'organization:org_cartograph_progress_a'] loop
    select * into decision from realtime.authorize('authenticated', topic, claims, 'user_fixture', '{}', array['broadcast'], array['broadcast']);
    if decision.read_allowed is distinct from array[true] or decision.write_allowed is distinct from array[false] then raise exception 'Own topic is unreadable or browser can publish: %', topic; end if;
  end loop;
  foreach topic in array array['analysis:' || other::text, 'organization:org_cartograph_progress_b', 'undeclared:topic'] loop
    select * into decision from realtime.authorize('authenticated', topic, claims, 'user_fixture', '{}', array['broadcast'], array['broadcast']);
    if decision.read_allowed is distinct from array[false] or decision.write_allowed is distinct from array[false] then raise exception 'Unauthorized topic is subscribable: %', topic; end if;
  end loop;
  select * into decision from realtime.authorize('authenticated', 'analysis:' || own::text,
    '{"role":"authenticated","org_id":"org_cartograph_progress_a"}', 'user_fixture', '{}', array['broadcast'], '{}');
  if decision.read_allowed is distinct from array[true] then raise exception 'Legacy claim cannot subscribe'; end if;
  select * into decision from realtime.authorize('authenticated', 'analysis:' || own::text,
    '{"role":"authenticated"}', 'user_fixture', '{}', array['broadcast'], '{}');
  if decision.read_allowed is distinct from array[false] then raise exception 'Missing organization can subscribe'; end if;
  select * into current_run from public.restart_repository_analysis('org_cartograph_progress_a', own);
  update public.analyses set updated_at = clock_timestamp() - interval '6 minutes' where id = own;
  previous_run := current_run.run_id;
  select * into current_run from public.restart_repository_analysis('org_cartograph_progress_a', own);
  if not current_run.created or current_run.run_id = previous_run then raise exception 'Stale run was not deliberately replaced'; end if;
  if public.fail_repository_analysis('org_cartograph_progress_a', own, previous_run, 'fetching', 'Old process failed.') then raise exception 'Old process failed the replacement'; end if;
  begin
    perform public.advance_repository_analysis('org_cartograph_progress_a', own, previous_run, 'selecting', 'Old process.', repeat('a',40));
    raise exception 'Superseded process advanced the replacement';
  exception when raise_exception then if sqlerrm = 'Superseded process advanced the replacement' then raise; end if; end;
  begin
    delete from private.progress_topic_patterns where pattern like '^analysis:%';
    perform public.advance_repository_analysis('org_cartograph_progress_a', own, current_run.run_id, 'selecting', 'Selected.', repeat('a',40));
    raise exception 'Undeclared publication was accepted';
  exception when raise_exception then if sqlerrm not like 'Undeclared progress topic:%' then raise; end if; end;
  if not exists (select 1 from public.analyses where id = own and stage = 'fetching' and stage_messages = '{"fetching":"Fetching the public repository archive."}') then raise exception 'Failed publication or rerun retained old stage history'; end if;
  if has_function_privilege('authenticated','public.restart_repository_analysis(text,uuid)','execute')
    or has_function_privilege('anon','public.restart_repository_analysis(text,uuid)','execute') then raise exception 'Rerun writer is publicly callable'; end if;
end; $$;
rollback;
select 'phase_07 realtime passed: same topic, own org sees 7 messages, other org sees 0; native subscriptions permit own org only; browsers cannot publish; fresh/stale reruns and superseded writes guarded; fixtures rolled back';
