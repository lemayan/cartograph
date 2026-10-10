begin;
create table public.ai_cache (
  organization_id text not null references public.organizations(id) on delete cascade,
  task text not null check (task in ('explain.file','explain.folder','classify.files')),
  model text not null check (model <> ''),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  content text not null check (length(content) between 1 and 262144),
  created_at timestamptz not null default now(),
  primary key (organization_id, task, model, input_hash)
);
alter table public.ai_cache enable row level security;
alter table public.ai_cache force row level security;
create policy organization_read on public.ai_cache for select to authenticated using
  (organization_id = (select coalesce(auth.jwt()->'o'->>'id', auth.jwt()->>'org_id')));
revoke all on public.ai_cache from public, anon, authenticated;
grant select on public.ai_cache to authenticated;
grant select, insert on public.ai_cache to service_role;

alter table public.file_roles add column model text, add column content_hash text;
alter table public.file_roles add constraint file_roles_ai_contract check (model is null or
  (model <> '' and content_hash is not null and content_hash ~ '^[0-9a-f]{64}$' and role in ('service','repository','model','util','config','component','hook')));
create unique index file_roles_one_label_idx on public.file_roles (analysis_id, file_id) where model is not null;
grant select, insert on public.file_roles to service_role;

alter table public.explanations alter column file_id drop not null;
alter table public.explanations add column target_type text, add column target_path text,
  add column model text, add column context_hash text, add column content_hashes jsonb, add column run_id uuid;
alter table public.explanations add constraint explanations_ai_contract check (model is null or
  (model <> '' and target_type is not null and target_type in ('file','folder') and target_path is not null and target_path <> ''
    and run_id is not null and context_hash is not null and context_hash ~ '^[0-9a-f]{64}$'
    and content_hashes is not null and jsonb_typeof(content_hashes) = 'object'
    and (target_type = 'folder' or file_id is not null)));
create unique index explanations_target_idx on public.explanations (analysis_id, target_type, target_path, model);
grant select, insert, update on public.explanations to service_role;

-- Calls the existing parser writer and adds labels in the same transaction. Parser kinds stay intact.
create function public.store_repository_analysis_with_roles(p_organization_id text, p_analysis_id uuid,
  p_run_id uuid, p_result jsonb, p_roles jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare expected integer; inserted integer;
begin
  if jsonb_typeof(p_roles) is distinct from 'array' then raise exception 'Invalid roles list'; end if;
  expected := jsonb_array_length(p_roles);
  perform public.store_repository_analysis(p_organization_id, p_analysis_id, p_run_id, p_result);
  insert into public.file_roles(organization_id, analysis_id, file_id, role, model, content_hash)
    select p_organization_id, p_analysis_id, f.id, r.role, r.model, r.hash
    from jsonb_to_recordset(p_roles) r(path text, role text, model text, hash text)
    join public.files f on f.analysis_id = p_analysis_id and f.organization_id = p_organization_id
      and f.path = r.path and f.hash = r.hash and f.kind is null
    where r.model is not null and r.model <> '' and r.role in ('service','repository','model','util','config','component','hook');
  get diagnostics inserted = row_count;
  if inserted <> expected then raise exception 'Role references an absent, changed, or convention-labelled file'; end if;
end; $$;
revoke all on function public.store_repository_analysis_with_roles(text,uuid,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.store_repository_analysis_with_roles(text,uuid,uuid,jsonb,jsonb) to service_role;

create function public.save_explanation(p_organization_id text, p_analysis_id uuid, p_run_id uuid,
  p_type text, p_path text, p_model text, p_context_hash text, p_hashes jsonb, p_content text)
returns void language plpgsql security invoker set search_path = '' as $$
declare selected_file uuid;
begin
  perform 1 from public.analyses where id = p_analysis_id and organization_id = p_organization_id
    and run_id = p_run_id and status = 'complete' for update;
  if not found then raise exception 'Analysis was replaced; reload the map'; end if;
  if jsonb_typeof(p_hashes) is distinct from 'object' or p_hashes = '{}'::jsonb
    or exists(select 1 from jsonb_each_text(p_hashes) h
      where not exists(select 1 from public.files f where f.analysis_id = p_analysis_id
        and f.organization_id = p_organization_id and f.path = h.key and f.hash = h.value)) then
    raise exception 'Explanation references absent or changed files';
  end if;
  if p_type = 'file' then
    select id into selected_file from public.files where analysis_id = p_analysis_id and organization_id = p_organization_id and path = p_path;
    if selected_file is null or not (p_hashes ? p_path) then raise exception 'Explanation file is absent'; end if;
  elsif p_type <> 'folder' then raise exception 'Invalid explanation target'; end if;
  insert into public.explanations(organization_id, analysis_id, file_id, target_type, target_path, model, context_hash, content_hashes, content, run_id)
    values(p_organization_id, p_analysis_id, selected_file, p_type, p_path, p_model, p_context_hash, p_hashes, p_content, p_run_id)
    on conflict(analysis_id, target_type, target_path, model) do update set
      context_hash = excluded.context_hash, content_hashes = excluded.content_hashes, content = excluded.content, run_id = excluded.run_id;
end; $$;
revoke all on function public.save_explanation(text,uuid,uuid,text,text,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.save_explanation(text,uuid,uuid,text,text,text,text,jsonb,text) to service_role;
commit;
