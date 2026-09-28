// Database schema. Applied automatically on first request (idempotent) and by `npm run db:setup`.
// RLS is enabled with no policies so the tables are not readable through Supabase's public
// anon API - the app connects directly as the database owner, which bypasses RLS.
export const SCHEMA_SQL = `
create table if not exists rubric_criteria (
  id          text primary key,
  role        text not null check (role in ('PM', 'SPM')),
  position    int  not null,
  name        text not null,
  weight      numeric not null check (weight > 0),
  anchor_5    text not null default '',
  anchor_3    text not null default '',
  anchor_1    text not null default '',
  source      text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists rubric_guidance (
  key      text primary key,
  content  text not null
);

create table if not exists candidates (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  file_name        text,
  content_hash     text unique,
  applied_role     text not null check (applied_role in ('PM', 'SPM')),

  -- Personal details: stored here only, never sent to any AI step.
  personal_details jsonb not null default '{}'::jsonb,
  -- CV content with name / email / phone / profile links redacted. This is all the AI sees.
  cv_text          text not null,

  status           text not null default 'new' check (status in ('new', 'scored', 'error')),
  attempts         int  not null default 0,
  last_error       text,
  claimed_at       timestamptz,

  headline         text,
  pm_score         numeric(5,1),
  spm_score        numeric(5,1),
  scored_at        timestamptz,
  ai_model         text,

  decision_override text check (decision_override in ('invite', 'reject')),
  brief            text,
  draft_decision   text check (draft_decision in ('invite', 'reject')),
  email_subject    text,
  email_body       text,
  draft_edited     boolean not null default false,
  drafted_at       timestamptz,
  draft_error      text,
  draft_attempts   int  not null default 0,

  email_status     text not null default 'none' check (email_status in ('none', 'sending', 'sent', 'failed')),
  sent_at          timestamptz,
  sent_to          text,
  resend_id        text,
  send_error       text
);

alter table candidates add column if not exists ai_model text;

create index if not exists candidates_role_idx on candidates (applied_role, status);

create table if not exists scores (
  candidate_id  uuid not null references candidates(id) on delete cascade,
  criterion_id  text not null references rubric_criteria(id),
  role          text not null check (role in ('PM', 'SPM')),
  score         int  not null check (score between 1 and 5),
  reason        text not null,
  primary key (candidate_id, criterion_id)
);

alter table rubric_criteria enable row level security;
alter table rubric_guidance enable row level security;
alter table candidates      enable row level security;
alter table scores          enable row level security;
`;
