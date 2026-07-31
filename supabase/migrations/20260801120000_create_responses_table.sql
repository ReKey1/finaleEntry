-- The table netlify/functions/submit.mjs writes to. One column per question,
-- named to match the `key` of each entry in the FIELDS array in
-- public/index.html — the function sends the row as-is, so the names must agree.
--
-- Once this has been applied, never edit it — Supabase tracks migrations by the
-- timestamp in the filename and will skip one it has already seen, so a change
-- here would silently never reach the database. Add a new migration instead.

-- `if not exists` because the table may already have been built by hand in the
-- SQL editor. Without it, a push against such a project fails outright.
create table if not exists public.responses (
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
-- request carrying an anon or publishable key, and the secret key used by the
-- function bypasses RLS entirely. That leaves no public read or write path to
-- this table.
alter table public.responses enable row level security;
