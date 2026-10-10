begin;
lock table public.analyses in share row exclusive mode;
alter table public.analyses
  add column run_id uuid not null default gen_random_uuid(),
  add column stage_messages jsonb not null default '{}'::jsonb check (jsonb_typeof(stage_messages) = 'object');
update public.analyses set stage_messages = jsonb_build_object(stage, stage_message) where stage is not null and stage_message is not null;

drop function public.begin_repository_analysis(text,text);
drop function public.advance_repository_analysis(text,uuid,text,text,text);
drop function public.store_repository_analysis(text,uuid,jsonb);
drop function public.fail_repository_analysis(text,uuid,text,text);
drop function public.restart_repository_analysis(text,uuid);

create function public.begin_repository_analysis(p_organization_id text, p_repository_url text)
returns table (analysis_id uuid, run_id uuid, created boolean, status text)
language plpgsql security invoker set search_path = '' as $$
declare project uuid; reserved uuid;
begin
  if p_organization_id is null or p_organization_id !~ '^org_[A-Za-z0-9_]+$' then raise exception 'A verified Clerk organization is required'; end if;
  if p_repository_url is null or p_repository_url !~ '^https://github[.]com/[a-z0-9][a-z0-9-]*/[a-z0-9_.-]+$'
    or p_repository_url ~ '/[.]{1,2}$' then raise exception 'Repository URL is not normalized'; end if;
  insert into public.organizations (id) values (p_organization_id) on conflict (id) do nothing;
  insert into public.projects (organization_id, repository_url) values (p_organization_id, p_repository_url)
    on conflict (organization_id, repository_url) do update set repository_url = excluded.repository_url returning id into project;
  insert into public.analyses (organization_id, project_id, status, stage, stage_message, stage_messages, started_at)
    values (p_organization_id, project, 'running', 'fetching', 'Fetching the public repository archive.',
      '{"fetching":"Fetching the public repository archive."}', clock_timestamp())
    on conflict (project_id) do nothing returning id into reserved;
  return query select a.id, a.run_id, reserved is not null, a.status from public.analyses a where a.project_id = project;
end;
$$;

create function public.advance_repository_analysis(p_organization_id text, p_analysis_id uuid, p_run_id uuid,
  p_stage text, p_message text, p_commit_sha text default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare previous_stage text;
begin
  previous_stage := case p_stage when 'selecting' then 'fetching' when 'parsing' then 'selecting' when 'storing' then 'parsing' end;
  if previous_stage is null then raise exception 'Invalid next stage'; end if;
  if p_stage = 'selecting' and p_commit_sha is null then raise exception 'Fetched archive must have a full commit SHA'; end if;
  update public.analyses set stage = p_stage, stage_message = p_message,
    stage_messages = stage_messages || jsonb_build_object(p_stage, p_message),
    commit_sha = coalesce(p_commit_sha, commit_sha), updated_at = clock_timestamp()
    where id = p_analysis_id and organization_id = p_organization_id and run_id = p_run_id
      and status = 'running' and stage = previous_stage;
  if not found then raise exception 'Analysis is absent, superseded, belongs to another organization, or has moved past this stage'; end if;
end;
$$;

create function public.fail_repository_analysis(p_organization_id text, p_analysis_id uuid, p_run_id uuid, p_stage text, p_message text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.analyses set status = 'failed', failure_stage = p_stage, failure_message = p_message,
    stage_message = p_message, stage_messages = stage_messages || jsonb_build_object(p_stage, p_message),
    finished_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_analysis_id and organization_id = p_organization_id and run_id = p_run_id and status = 'running';
  if found then return true; end if;
  -- A stale rerun invalidates the old process; it must not fail the replacement job.
  if exists (select 1 from public.analyses where id = p_analysis_id and organization_id = p_organization_id and run_id <> p_run_id) then return false; end if;
  raise exception 'Analysis cannot be failed in this organization or is already terminal';
end;
$$;

create function public.restart_repository_analysis(p_organization_id text, p_analysis_id uuid)
returns table (analysis_id uuid, run_id uuid, created boolean, status text, repository_url text)
language plpgsql security invoker set search_path = '' as $$
declare current_status text; last_progress timestamptz; restart boolean;
begin
  select a.status, a.updated_at into current_status, last_progress from public.analyses a
    where a.id = p_analysis_id and a.organization_id = p_organization_id for update;
  if not found then raise exception 'Analysis is absent in this organization'; end if;
  restart := current_status in ('complete', 'failed') or last_progress <= clock_timestamp() - interval '5 minutes';
  if restart then
    delete from public.insights where public.insights.analysis_id = p_analysis_id;
    delete from public.routes where public.routes.analysis_id = p_analysis_id;
    delete from public.files where public.files.analysis_id = p_analysis_id;
    update public.analyses set status = 'running', run_id = gen_random_uuid(), stage = 'fetching',
      stage_message = 'Fetching the public repository archive.', stage_messages = '{"fetching":"Fetching the public repository archive."}',
      started_at = clock_timestamp(), updated_at = clock_timestamp(), finished_at = null,
      failure_stage = null, failure_message = null, commit_sha = null, parser_schema_version = null,
      repository_name = null, adapter = null, coverage = null where id = p_analysis_id;
  end if;
  return query select a.id, a.run_id, restart, a.status, p.repository_url
    from public.analyses a join public.projects p on p.id = a.project_id where a.id = p_analysis_id;
end;
$$;

create or replace function private.publish_analysis_progress()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare channel text; channels text[]; payload jsonb;
begin
  if new.stage is null or new.stage_message is null then return new; end if;
  if tg_op = 'UPDATE' and (new.stage, new.stage_message, new.status, new.run_id)
    is not distinct from (old.stage, old.stage_message, old.status, old.run_id) then return new; end if;
  payload := jsonb_build_object('status', new.status, 'stage', new.stage, 'message', new.stage_message);
  channels := array['analysis:' || new.id::text];
  -- The dashboard's organization channel discovers new/restarted rows. Each active row
  -- follows its own analysis stream, avoiding a duplicate list read for every stage.
  if tg_op = 'INSERT' or new.run_id is distinct from old.run_id then
    channels := array_append(channels, 'organization:' || new.organization_id);
  end if;
  foreach channel in array channels loop
    if not exists (select 1 from private.progress_topic_patterns p where channel ~ p.pattern) then raise exception 'Undeclared progress topic: %', channel; end if;
    insert into realtime.messages (id, topic, extension, event, payload, private)
      values (gen_random_uuid(), channel, 'broadcast', 'progress', payload, true);
  end loop;
  return new;
end;
$$;
drop trigger analysis_progress on public.analyses;
create trigger analysis_progress after insert or update of stage, stage_message, status, run_id on public.analyses
  for each row execute function private.publish_analysis_progress();

-- Store definition and writer grants follow below.

create function public.store_repository_analysis(p_organization_id text, p_analysis_id uuid, p_run_id uuid, p_result jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  inserted bigint;
  expected_files integer;
  expected_edges integer;
begin
  perform 1 from public.analyses where id = p_analysis_id and organization_id = p_organization_id
     and run_id = p_run_id and status = 'running' and stage = 'storing' and commit_sha is not null for update;
  if not found then raise exception 'Analysis is not ready to store in this organization'; end if;
  if p_result is null or p_result->>'schemaVersion' is distinct from '1'
    or jsonb_typeof(p_result->'files') is distinct from 'array'
    or jsonb_typeof(p_result->'edges') is distinct from 'array'
    or jsonb_typeof(p_result->'coverage') is distinct from 'object'
    or nullif(p_result->>'repository', '') is null or nullif(p_result->>'adapter', '') is null then
    raise exception 'Invalid parser result';
  end if;
  expected_files := jsonb_array_length(p_result->'files');
  expected_edges := jsonb_array_length(p_result->'edges');
  if (p_result->'coverage'->>'filesParsed')::integer is distinct from expected_files
    or (p_result->'coverage'->>'filesFound')::integer is distinct from
      expected_files + (p_result->'coverage'->>'filesSkipped')::integer then
    raise exception 'File coverage does not add up';
  end if;
  insert into public.files (organization_id, analysis_id, path, folder, extension, lines, hash, module, kind, fan_in, fan_out, parser_order)
    select p_organization_id, p_analysis_id, f.path, f.folder, f.extension, f.lines, f.hash, f.module, f.kind, f."fanIn", f."fanOut", element.position::integer
    from jsonb_array_elements(p_result->'files') with ordinality as element(value, position)
    cross join lateral jsonb_to_record(element.value) as f(path text, folder text, extension text, lines integer,
      hash text, module text, kind text, "fanIn" integer, "fanOut" integer);
  get diagnostics inserted = row_count;
  if inserted <> expected_files then raise exception 'File storage is incomplete'; end if;
  insert into public.edges (organization_id, analysis_id, source_file_id, target_file_id, kinds, parser_order)
    select p_organization_id, p_analysis_id, source.id, target.id, e.kinds, element.position::integer
    from jsonb_array_elements(p_result->'edges') with ordinality as element(value, position)
    cross join lateral jsonb_to_record(element.value) as e(source text, target text, kinds text[])
    join public.files source on source.analysis_id = p_analysis_id and source.organization_id = p_organization_id and source.path = e.source
    join public.files target on target.analysis_id = p_analysis_id and target.organization_id = p_organization_id and target.path = e.target;
  get diagnostics inserted = row_count;
  if inserted <> expected_edges then raise exception 'An edge has an absent endpoint'; end if;
  update public.analyses set parser_schema_version = 1, repository_name = p_result->>'repository', adapter = p_result->>'adapter',
    coverage = p_result->'coverage', status = 'complete', stage_message = 'Analysis stored.',
    finished_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_analysis_id and organization_id = p_organization_id and run_id = p_run_id;
end;
$$;

revoke all on function public.begin_repository_analysis(text,text),
  public.advance_repository_analysis(text,uuid,uuid,text,text,text), public.store_repository_analysis(text,uuid,uuid,jsonb),
  public.fail_repository_analysis(text,uuid,uuid,text,text), public.restart_repository_analysis(text,uuid) from public, anon, authenticated;
grant execute on function public.begin_repository_analysis(text,text),
  public.advance_repository_analysis(text,uuid,uuid,text,text,text), public.store_repository_analysis(text,uuid,uuid,jsonb),
  public.fail_repository_analysis(text,uuid,uuid,text,text), public.restart_repository_analysis(text,uuid) to service_role;
commit;
