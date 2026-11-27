create schema wallflow_private;
revoke all on schema wallflow_private from public, anon, authenticated, service_role;

-- PostgreSQL counts Unicode code points. The existing editor and API count UTF-16 units.
create function wallflow_private.utf16_length(value text)
returns integer
language sql immutable strict parallel safe
set search_path = ''
as $$
  select 2 * char_length(value)
    - char_length(regexp_replace(value collate pg_catalog."C", U&'[\+010000-\+10FFFF]', '', 'g'));
$$;

create function wallflow_private.trim_legacy_text(value text)
returns text
language sql immutable strict parallel safe
set search_path = ''
as $$
  select btrim(value, U&'\0009\000a\000b\000c\000d\001c\001d\001e\001f\0020\0085\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000');
$$;

create function wallflow_private.note_position_valid(
  x double precision, y double precision, rotation double precision,
  width double precision, height double precision
)
returns boolean
language sql immutable strict parallel safe
set search_path = ''
as $$
  select case
    when rotation between -9007199254740991 and 9007199254740991 then
      abs(x) <= 16 - greatest(2.62, (abs(cos(rotation)) * width + abs(sin(rotation)) * height) / 2 + 0.15) + 1e-9
      and abs(y) <= 11 - greatest(2.78, (abs(sin(rotation)) * width + abs(cos(rotation)) * height) / 2 + 0.15) + 1e-9
    else false
  end;
$$;

revoke all on all functions in schema wallflow_private from public, anon, authenticated, service_role;

create table public.profiles (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 150),
  -- A trusted provisioning path activates the profile after resolving legacy identity.
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles (owner_id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  active_board_id uuid not null,
  active_board_is_live boolean generated always as (true) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.boards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  owner_id uuid not null,
  sort_index bigint not null check (sort_index >= 0),
  name text not null default 'My everyday wall',
  tilt_deg double precision not null default 0 check (tilt_deg between -25 and 25),
  turn_deg double precision not null default 0 check (turn_deg between -30 and 30),
  version bigint not null default 0 check (version >= 0),
  deleted_at timestamptz,
  is_live boolean generated always as (deleted_at is null) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint boards_name_valid check (
    name = wallflow_private.trim_legacy_text(name) and wallflow_private.utf16_length(name) between 1 and 48
  ),
  foreign key (workspace_id, owner_id) references public.workspaces (id, owner_id) on delete cascade,
  unique (id, owner_id),
  unique (id, workspace_id, owner_id, is_live),
  unique (workspace_id, sort_index) deferrable initially immediate
);

alter table public.workspaces add constraint workspaces_active_board_fkey
  foreign key (active_board_id, id, owner_id, active_board_is_live)
  references public.boards (id, workspace_id, owner_id, is_live)
  deferrable initially deferred;

create table public.board_preferences (
  board_id uuid primary key,
  owner_id uuid not null,
  theme text not null default 'minimal' check (theme in ('minimal', 'office', 'study', 'studio', 'lab')),
  photo_workspace text not null default 'professor' check (photo_workspace in ('professor', 'teacher', 'scientist')),
  wall_shade text not null default 'theme' check (wall_shade in ('theme', 'chalk', 'ivory', 'mist')),
  light_intensity smallint not null default 100 check (light_intensity between 85 and 115 and light_intensity % 5 = 0),
  ambience text not null default 'theme' check (ambience in ('theme', 'quiet', 'airy')),
  lighting text not null default 'daylight' check (lighting in ('daylight', 'warm')),
  default_note_color text not null default 'yellow'
    check (default_note_color in ('yellow', 'pink', 'green', 'blue', 'violet', 'cream', 'mint', 'white', 'grey')),
  default_note_typography text not null default 'handwritten' check (default_note_typography in ('handwritten', 'sans')),
  default_note_size text not null default 'standard' check (default_note_size in ('compact', 'standard', 'large')),
  default_note_rotation text not null default 'varied' check (default_note_rotation in ('varied', 'straight')),
  show_hints boolean not null default true,
  onboarding_complete boolean not null default false,
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (board_id, owner_id) references public.boards (id, owner_id) on delete cascade
);

create table public.sections (
  board_id uuid not null,
  owner_id uuid not null,
  id text not null check (wallflow_private.trim_legacy_text(id) <> ''),
  sort_index smallint not null check (sort_index between 0 and 23),
  name text not null,
  x double precision not null,
  y double precision not null,
  width double precision,
  height double precision,
  version bigint not null default 0 check (version >= 0),
  primary key (board_id, id),
  unique (board_id, owner_id, id),
  unique (board_id, sort_index) deferrable initially immediate,
  foreign key (board_id, owner_id) references public.boards (id, owner_id) on delete cascade,
  constraint sections_name_valid check (
    name = wallflow_private.trim_legacy_text(name) and wallflow_private.utf16_length(name) between 1 and 40
  ),
  constraint sections_size_valid check (
    (width is null and height is null)
    or (width is not null and height is not null and width between 2 and 31.7 and height between 1.6 and 21.7)
  ),
  constraint sections_position_valid check (
    abs(x) <= (32 - coalesce(width, 7.4)) / 2 - 0.15 + 1e-9
    and abs(y) <= (22 - coalesce(height, 5.6)) / 2 - 0.15 + 1e-9
  )
);

create table public.notes (
  board_id uuid not null,
  owner_id uuid not null,
  id text not null check (wallflow_private.trim_legacy_text(id) <> ''),
  sort_index bigint not null check (sort_index >= 0),
  active_slot smallint check (active_slot between 1 and 60),
  section_id text,
  title text not null default '' check (wallflow_private.utf16_length(title) <= 72),
  body text not null default '' check (wallflow_private.utf16_length(body) <= 240),
  color text not null check (color in ('yellow', 'pink', 'green', 'blue', 'violet', 'cream', 'mint', 'white', 'grey')),
  typography text check (typography in ('handwritten', 'sans')),
  doodle text check (doodle in (
    'open-book', 'closed-book', 'graduation-cap', 'pencil', 'pen', 'notebook',
    'document', 'bookmark', 'light-bulb', 'brain', 'star', 'target',
    'magnifying-glass', 'sparkles', 'flask', 'microscope', 'atom', 'molecule',
    'dna', 'test-tube', 'calendar', 'clock', 'checklist', 'bar-chart',
    'line-graph', 'computer', 'folder', 'layers', 'presentation', 'paintbrush',
    'palette', 'camera', 'music-note', 'paper-plane', 'light-rays', 'spark', 'flower', 'leaf'
  )),
  inline_sketches boolean,
  x double precision not null,
  y double precision not null,
  rotation_rad double precision not null default 0,
  width double precision,
  height double precision,
  priority text check (priority in ('low', 'medium', 'high')),
  due_date date check (due_date between date '0001-01-01' and date '9999-12-31'),
  planned_on date check (planned_on between date '0001-01-01' and date '9999-12-31'),
  completed boolean,
  archived boolean,
  deleted_at timestamptz,
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (board_id, id),
  unique (board_id, owner_id, id),
  unique (board_id, sort_index) deferrable initially immediate,
  constraint notes_active_slot_unique unique (board_id, active_slot) deferrable initially immediate,
  constraint notes_active_slot_matches_state check (
    (active_slot is not null) = (archived is not true and deleted_at is null)
  ),
  foreign key (board_id, owner_id) references public.boards (id, owner_id) on delete cascade,
  foreign key (board_id, owner_id, section_id) references public.sections (board_id, owner_id, id)
    on delete set null (section_id),
  constraint notes_size_valid check (
    (width is null and height is null)
    or (
      width is not null and height is not null
      and width between 2.62::double precision * 0.65 and 2.62::double precision * 2.2
      and height between 2.78::double precision * 0.65 and 2.78::double precision * 2.2
    )
  ),
  constraint notes_position_valid check (
    wallflow_private.note_position_valid(x, y, rotation_rad, coalesce(width, 2.62), coalesce(height, 2.78))
  )
);

create table public.checklist_items (
  board_id uuid not null,
  owner_id uuid not null,
  note_id text not null,
  id text not null check (wallflow_private.trim_legacy_text(id) <> ''),
  sort_index smallint not null check (sort_index between 0 and 23),
  text text not null check (wallflow_private.utf16_length(text) <= 120),
  done boolean not null default false,
  planned_on date check (planned_on between date '0001-01-01' and date '9999-12-31'),
  version bigint not null default 0 check (version >= 0),
  primary key (board_id, note_id, id),
  unique (board_id, note_id, sort_index) deferrable initially immediate,
  foreign key (board_id, owner_id, note_id) references public.notes (board_id, owner_id, id) on delete cascade
);

create table public.reminder_occurrences (
  board_id uuid not null,
  owner_id uuid not null,
  note_id text not null,
  id text not null check (
    wallflow_private.trim_legacy_text(id) <> '' and wallflow_private.utf16_length(id) <= 100
  ),
  scheduled_at timestamptz not null,
  cancelled_at timestamptz,
  version bigint not null default 0 check (version >= 0),
  primary key (board_id, id),
  unique (board_id, owner_id, id),
  foreign key (board_id, owner_id, note_id) references public.notes (board_id, owner_id, id) on delete cascade,
  constraint reminder_occurrences_time_valid check (
    scheduled_at between timestamptz '0001-01-01 00:00:00+00' and timestamptz '9999-12-31 23:59:59.999+00'
    and date_trunc('milliseconds', scheduled_at, 'UTC') = scheduled_at
  )
);

create unique index reminder_occurrences_current_note_idx
  on public.reminder_occurrences (board_id, note_id) where cancelled_at is null;

create table public.reminder_receipts (
  board_id uuid not null,
  owner_id uuid not null,
  reminder_id text not null check (wallflow_private.trim_legacy_text(reminder_id) <> ''),
  occurrence_id text check (occurrence_id = reminder_id),
  acknowledged_at timestamptz,
  primary key (board_id, reminder_id),
  foreign key (board_id, owner_id) references public.boards (id, owner_id) on delete cascade,
  foreign key (board_id, owner_id, occurrence_id)
    references public.reminder_occurrences (board_id, owner_id, id) on delete cascade,
  constraint reminder_receipts_acknowledgement_valid check (acknowledged_at is null or occurrence_id is not null)
);

create table public.change_batches (
  workspace_id uuid not null,
  owner_id uuid not null,
  revision bigint not null check (revision > 0),
  changes jsonb not null check (jsonb_typeof(changes) = 'array'),
  committed_at timestamptz not null default now(),
  primary key (workspace_id, revision),
  foreign key (workspace_id, owner_id) references public.workspaces (id, owner_id) on delete cascade
);

create table wallflow_private.operation_receipts (
  owner_id uuid not null,
  workspace_id uuid not null,
  operation_id uuid not null,
  operation_kind text not null check (wallflow_private.trim_legacy_text(operation_kind) <> ''),
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  revision bigint not null check (revision >= 0),
  result jsonb not null default '{}' check (jsonb_typeof(result) = 'object'),
  committed_at timestamptz not null default now(),
  primary key (owner_id, operation_id),
  foreign key (workspace_id, owner_id) references public.workspaces (id, owner_id) on delete cascade
);

create table wallflow_private.import_sources (
  source_id uuid primary key,
  owner_id uuid not null,
  workspace_id uuid not null,
  board_id uuid,
  -- Historical ID survives board deletion and also covers missing legacy boards.
  claimed_board_id uuid not null,
  claimed_at timestamptz not null default now(),
  foreign key (workspace_id, owner_id) references public.workspaces (id, owner_id) on delete cascade,
  foreign key (board_id, owner_id) references public.boards (id, owner_id) on delete set null (board_id),
  check (board_id = claimed_board_id)
);

create table wallflow_private.import_intents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  workspace_id uuid not null,
  source_id uuid not null,
  session_id uuid,
  legacy_session_digest text check (legacy_session_digest ~ '^[0-9a-f]{64}$'),
  snapshot_digest text not null check (snapshot_digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null check (isfinite(expires_at)),
  confirmed_revision bigint check (confirmed_revision >= 0),
  foreign key (workspace_id, owner_id) references public.workspaces (id, owner_id) on delete cascade,
  check (num_nonnulls(session_id, legacy_session_digest) = 1)
);

create table wallflow_private.legacy_account_map (
  legacy_user_id uuid primary key,
  google_sub text not null unique check (google_sub collate pg_catalog."C" ~ '^[!-~]{1,255}$'),
  legacy_is_active boolean not null,
  owner_id uuid unique references public.profiles (owner_id) on delete cascade,
  verified_at timestamptz,
  check ((owner_id is null) = (verified_at is null)),
  check (owner_id is null or legacy_is_active)
);

create index boards_owner_workspace_order_idx on public.boards (owner_id, workspace_id, sort_index);
create index board_preferences_owner_idx on public.board_preferences (owner_id);
create index sections_owner_board_order_idx on public.sections (owner_id, board_id, sort_index);
create index notes_owner_board_order_idx on public.notes (owner_id, board_id, sort_index);
create index notes_section_idx on public.notes (board_id, owner_id, section_id) where section_id is not null;
create index checklist_items_owner_board_note_idx on public.checklist_items (owner_id, board_id, note_id);
create index reminder_occurrences_owner_board_due_idx on public.reminder_occurrences (owner_id, board_id, scheduled_at)
  where cancelled_at is null;
create index reminder_occurrences_parent_idx on public.reminder_occurrences (board_id, owner_id, note_id);
create index reminder_receipts_owner_board_idx on public.reminder_receipts (owner_id, board_id);
create index reminder_receipts_occurrence_idx on public.reminder_receipts (board_id, owner_id, occurrence_id)
  where occurrence_id is not null;
create index change_batches_owner_revision_idx on public.change_batches (owner_id, revision);
create index operation_receipts_workspace_idx on wallflow_private.operation_receipts (workspace_id, owner_id);
create index import_sources_workspace_idx on wallflow_private.import_sources (workspace_id, owner_id);
create index import_sources_board_idx on wallflow_private.import_sources (board_id) where board_id is not null;
create index import_intents_workspace_idx on wallflow_private.import_intents (workspace_id, owner_id);
create index import_intents_source_expiry_idx on wallflow_private.import_intents (source_id, expires_at)
  where confirmed_revision is null;

-- Every table starts closed, including on projects with permissive API default grants.
do $$
declare
  relation regclass;
begin
  foreach relation in array array[
    'public.profiles', 'public.workspaces', 'public.boards', 'public.board_preferences', 'public.sections',
    'public.notes', 'public.checklist_items', 'public.reminder_occurrences', 'public.reminder_receipts',
    'public.change_batches', 'wallflow_private.operation_receipts', 'wallflow_private.import_sources',
    'wallflow_private.import_intents', 'wallflow_private.legacy_account_map'
  ]::regclass[] loop
    execute format('alter table %s enable row level security', relation);
    execute format('revoke all on table %s from public, anon, authenticated, service_role', relation);
  end loop;
end;
$$;
