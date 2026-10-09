-- Metadata remains nullable: missing commits or lifecycle events are not inferred.
alter table public.analyses
  add column commit_sha text,
  add column started_at timestamptz,
  add column finished_at timestamptz,
  add column failure_message text,
  add constraint analyses_commit_sha_check
    check (commit_sha is null or commit_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  add constraint analyses_time_order_check
    check (finished_at is null or started_at is null or finished_at >= started_at),
  add constraint analyses_failure_message_check
    check (failure_message is null or btrim(failure_message) <> '');

alter table public.analyses drop constraint analyses_status_check;
update public.analyses set status = case status
  when 'running' then 'parsing'
  when 'completed' then 'complete'
  else status
end
where status in ('running', 'completed');
alter table public.analyses add constraint analyses_status_check
  check (status in ('queued', 'parsing', 'complete', 'failed'));
