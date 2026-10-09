-- Clerk owns identity. This table is only the local cascade root, not a membership copy.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Fail closed for every new public table, even before it has a policy.
create function private.enable_public_table_rls()
returns event_trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  command record;
begin
  for command in
    select ddl.objid, ddl.object_identity
    from pg_event_trigger_ddl_commands() ddl
    join pg_class relation on relation.oid = ddl.objid
    where ddl.schema_name = 'public' and ddl.classid = 'pg_class'::regclass
      and relation.relkind in ('r', 'p')
  loop
    execute format('alter table %s enable row level security', command.object_identity);
    execute format('alter table %s force row level security', command.object_identity);
  end loop;
end;
$$;
revoke all on function private.enable_public_table_rls() from public, anon, authenticated;
create event trigger cartograph_enable_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function private.enable_public_table_rls();

create table public.organizations (
  id text primary key check (id <> ''),
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  repository_url text not null check (repository_url <> ''),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, repository_url)
);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  is_seed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete cascade
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null,
  path text not null check (path <> ''),
  unique (id, analysis_id, organization_id),
  unique (analysis_id, organization_id, path),
  foreign key (analysis_id, organization_id) references public.analyses(id, organization_id) on delete cascade
);

-- Both ends must belong to the same analysis as the edge, not just the same team.
create table public.edges (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null,
  source_file_id uuid not null,
  target_file_id uuid not null,
  foreign key (analysis_id, organization_id) references public.analyses(id, organization_id) on delete cascade,
  foreign key (source_file_id, analysis_id, organization_id) references public.files(id, analysis_id, organization_id) on delete cascade,
  foreign key (target_file_id, analysis_id, organization_id) references public.files(id, analysis_id, organization_id) on delete cascade,
  unique (analysis_id, organization_id, source_file_id, target_file_id)
);

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid not null,
  method text not null check (method <> ''),
  path text not null check (path <> ''),
  foreign key (analysis_id, organization_id) references public.analyses(id, organization_id) on delete cascade,
  foreign key (file_id, analysis_id, organization_id) references public.files(id, analysis_id, organization_id) on delete cascade
);

create table public.explanations (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid not null,
  content text not null check (content <> ''),
  foreign key (analysis_id, organization_id) references public.analyses(id, organization_id) on delete cascade,
  foreign key (file_id, analysis_id, organization_id) references public.files(id, analysis_id, organization_id) on delete cascade
);

create table public.file_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid not null,
  role text not null check (role <> ''),
  foreign key (analysis_id, organization_id) references public.analyses(id, organization_id) on delete cascade,
  foreign key (file_id, analysis_id, organization_id) references public.files(id, analysis_id, organization_id) on delete cascade
);

create table public.insights (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  analysis_id uuid not null,
  content text not null check (content <> ''),
  foreign key (analysis_id, organization_id) references public.analyses(id, organization_id) on delete cascade
);

-- Organization predicates and cascade lookups need leading indexes.
create index analyses_dashboard_idx on public.analyses (organization_id, created_at desc, id desc);
create index analyses_project_idx on public.analyses (project_id, organization_id);
create index files_organization_idx on public.files (organization_id);
create index edges_organization_idx on public.edges (organization_id);
create index edges_source_idx on public.edges (source_file_id, analysis_id, organization_id);
create index edges_target_idx on public.edges (target_file_id, analysis_id, organization_id);
create index routes_organization_idx on public.routes (organization_id);
create index routes_analysis_idx on public.routes (analysis_id, organization_id);
create index routes_file_idx on public.routes (file_id, analysis_id, organization_id);
create index explanations_organization_idx on public.explanations (organization_id);
create index explanations_analysis_idx on public.explanations (analysis_id, organization_id);
create index explanations_file_idx on public.explanations (file_id, analysis_id, organization_id);
create index file_roles_organization_idx on public.file_roles (organization_id);
create index file_roles_analysis_idx on public.file_roles (analysis_id, organization_id);
create index file_roles_file_idx on public.file_roles (file_id, analysis_id, organization_id);
create index insights_organization_idx on public.insights (organization_id);
create index insights_analysis_idx on public.insights (analysis_id, organization_id);

-- Phase 02 only reads. Do not grant writes for functionality that does not exist yet.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['organizations', 'projects', 'analyses', 'files', 'edges', 'routes', 'explanations', 'file_roles', 'insights']
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format(
      'create policy organization_read on public.%I for select to authenticated using (%I = (select coalesce(auth.jwt()->''o''->>''id'', auth.jwt()->>''org_id'')))',
      table_name, case when table_name = 'organizations' then 'id' else 'organization_id' end
    );
  end loop;
end;
$$;
