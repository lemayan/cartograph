begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- This is our registry: native Realtime has no channel-pattern registration API.
create table private.progress_topic_patterns (
  pattern text primary key,
  description text not null
);
alter table private.progress_topic_patterns enable row level security;
alter table private.progress_topic_patterns force row level security;
revoke all on private.progress_topic_patterns from public, anon, authenticated;
grant select on private.progress_topic_patterns to authenticated, service_role;
create policy declared_progress_topics on private.progress_topic_patterns for select to authenticated using (true);
insert into private.progress_topic_patterns values
  ('^analysis:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', 'Private progress for one stored analysis'),
  ('^organization:org_[A-Za-z0-9_]+$', 'Private dashboard invalidation for one organization');

create policy organization_progress_read on realtime.messages for select to authenticated using (
  extension = 'broadcast'
  and topic = (select realtime.topic())
  and exists (select 1 from private.progress_topic_patterns p where topic ~ p.pattern)
  and (
    topic = 'organization:' || coalesce((select auth.jwt())->'o'->>'id', (select auth.jwt())->>'org_id')
    or exists (select 1 from public.analyses a where topic = 'analysis:' || a.id::text)
  )
);

create function private.publish_analysis_progress()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  channel text;
  payload jsonb;
begin
  if new.stage is null or new.stage_message is null then return new; end if;
  if tg_op = 'UPDATE' and (new.stage, new.stage_message, new.status)
    is not distinct from (old.stage, old.stage_message, old.status) then return new; end if;
  payload := jsonb_build_object('stage', case when new.status in ('complete', 'failed') then new.status else new.stage end,
    'message', case when new.status = 'failed' then 'Failed during ' || new.failure_stage || ': ' || new.stage_message else new.stage_message end);
  foreach channel in array array['analysis:' || new.id::text, 'organization:' || new.organization_id] loop
    if not exists (select 1 from private.progress_topic_patterns p where channel ~ p.pattern) then
      raise exception 'Undeclared progress topic: %', channel;
    end if;
    -- Native send() swallows insertion errors and adds payload fields. Insert its documented
    -- message shape directly so a broken stream aborts the write, and only stage/message travel.
    insert into realtime.messages (id, topic, extension, event, payload, private)
      values (gen_random_uuid(), channel, 'broadcast', 'progress', payload, true);
  end loop;
  return new;
end;
$$;
revoke all on function private.publish_analysis_progress() from public, anon, authenticated;
grant execute on function private.publish_analysis_progress() to service_role;
create trigger analysis_progress after insert or update of stage, stage_message, status on public.analyses
  for each row execute function private.publish_analysis_progress();

-- A deliberate rerun keeps the analysis URL and never resets a job that can still write.
create function public.restart_repository_analysis(p_organization_id text, p_analysis_id uuid)
returns table (analysis_id uuid, created boolean, status text, repository_url text)
language plpgsql security invoker set search_path = '' as $$
declare current_run public.analyses%rowtype;
begin
  select * into current_run from public.analyses a
    where a.id = p_analysis_id and a.organization_id = p_organization_id for update;
  if not found then raise exception 'Analysis is absent in this organization'; end if;
  if current_run.status in ('complete', 'failed') then
    delete from public.insights where public.insights.analysis_id = p_analysis_id;
    delete from public.routes where public.routes.analysis_id = p_analysis_id;
    delete from public.files where public.files.analysis_id = p_analysis_id;
    update public.analyses set status = 'running', stage = 'fetching', stage_message = 'Fetching the public repository archive.',
      started_at = clock_timestamp(), updated_at = clock_timestamp(), finished_at = null,
      failure_stage = null, failure_message = null, commit_sha = null, parser_schema_version = null,
      repository_name = null, adapter = null, coverage = null where id = p_analysis_id;
  end if;
  return query select a.id, current_run.status in ('complete', 'failed'), a.status, p.repository_url
    from public.analyses a join public.projects p on p.id = a.project_id where a.id = p_analysis_id;
end;
$$;
revoke all on function public.restart_repository_analysis(text, uuid) from public, anon, authenticated;
grant execute on function public.restart_repository_analysis(text, uuid) to service_role;
grant delete on public.files, public.edges, public.routes, public.insights to service_role;

commit;
