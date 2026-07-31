-- The table netlify/functions/submit.mjs writes to. One column per question,
-- named to match the `key` of each entry in the FIELDS array in
-- public/index.html — the function sends the row as-is, so the names must agree.
--
-- DESTRUCTIVE. The drop is here because an earlier version of this project had
-- a placeholder `responses` table with different columns, and a plain
-- `create table if not exists` would leave that stale table in place while
-- every insert failed on a missing column. Applying this migration deletes any
-- rows already collected. Once you have real responses, never edit this file —
-- add a new migration alongside it instead.
drop table if exists public.responses;

create table public.responses (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  email        text not null,
  full_name    text not null,   -- おなまえ【フルネーム】
  line_name    text not null,   -- Line名
  tshirt_size  text not null,   -- finaleTシャツのサイズ  S/M/L/XL/XXL
  grade        text not null,   -- W+I&Sでの学年         22/23/24/25/26
  extra_parts  text not null,   -- finaleでパートを増やしたくない  かまわない！/はい
  content_idea text             -- finaleコマでやりたいコンテンツ (optional)
);

-- No policies, deliberately. Row level security with zero policies denies every
-- request carrying an anon or publishable key, and the service_role key used by
-- the function bypasses RLS entirely. That leaves no public write path to this
-- table.
alter table public.responses enable row level security;
