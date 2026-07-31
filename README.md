# 23引退公演finaleエントリーフォーム

A rebuild of a Google Form as a static page, with responses saved to Supabase.

```
public/index.html            the form - no credentials, safe to publish
netlify/functions/submit.mjs the only code that talks to Supabase
netlify.toml                 publish dir, /api/submit route, security headers
.env.example                 the environment variables you need to set
supabase/migrations/         the schema, as SQL files applied in filename order
.github/workflows/           applies those migrations on push to main
test.original.html           the saved Google Form this page is copied from
```

## What a submit does

The Submit button always scrolls the spectrum. Everything else is the original
purple until a response is actually saved, at which point `is-rainbow` goes on
`<html>` and the card borders, headings, options and controls join it — themed
off a single animated hue (`--rb-hue`, registered with `@property` in
`public/index.html`). Browsers without `@property` stay on the static purple.
"Submit another response" takes the class back off.

- **Saved** (function returns 201) — the page turns rainbow, then ten
  full-width panes of sandblasted glass wipe in from the top. Even rows scroll
  踊る阿呆に見る阿呆同じ阿呆なら踊らにゃ損々; the five odd rows each repeat
  "welcome" in one of the languages of the form description — ようこそ,
  welcome, 환영합니다, مرحبًا, 欢迎. They hold for a few seconds, then wipe
  back out from the bottom up onto the confirmation card. Timing lives in the
  `ROW_*`/`HOLD_MS`/`SCROLL_PPS` constants next to the handler. Skipped for
  `prefers-reduced-motion`.
- **Failed** (anything else, including an unreachable function) — the answers
  are not saved, so a dialog says so and OK sends the person to the original
  Google Form, which still accepts responses. Cancel keeps them on the page
  with their answers and a link to that form. `BACKUP_FORM_URL` holds the
  address. Client-side validation failures do not trigger this.

## Questions and columns

`test.original.html` is the saved original. Everything below was read out of the
`FB_PUBLIC_LOAD_DATA_` blob in that file, and `public/index.html` reproduces it
question for question.

| Question | Type | Required | Column |
|---|---|---|---|
| *(none - the original uses your Google account)* | short answer | yes | `email` |
| おなまえ【フルネーム】 | short answer | yes | `full_name` |
| Line名 | short answer | yes | `line_name` |
| finaleTシャツのサイズ | dropdown, S/M/L/XL/XXL | yes | `tshirt_size` |*
| W+I&S での学年 | radio, 22/23/24/25/26 | yes | `grade` |
| finaleでパートを増やしたくない | radio, かまわない！/はい | yes | `extra_parts` |
| finaleコマでやりたいコンテンツ | short answer | no | `content_idea` |

The Email question is the one addition. Google Forms fills that in from the
signed-in account, which only works inside Forms, so the rebuild asks for it as
an ordinary required text field and validates it on both sides.

\* finaleTシャツのサイズ is a dropdown on the original. The rebuild renders it as
a radio list instead — a native `<select>` cannot be styled to match Forms
without replacing it wholesale, and the answer set is short enough to show in
full. The stored values are unchanged.

The form also opens with a YouTube item (M9 フィナーレ, `QhTF_ZH1AMY`). It has no
answer and no column.

## How secrets are handled

The browser never receives a Supabase key. `public/index.html` POSTs answers to
`/api/submit`; the function reads `SUPABASE_SECRET_KEY` from the environment and
performs the insert itself.

This is why there is no build step. A bundler could inject a publishable key at
build time and keep it out of Git, but it would still be readable in the
deployed page — every key the browser holds is public. Moving the call
server-side is what actually keeps it secret.

It has to be a **secret** key (`sb_secret_…`, from Project Settings → API Keys →
Secret keys). Only secret keys bypass row level security, and the responses
table has no policies, so a publishable key has every insert denied. The
function checks the key's format on each request and logs the reason rather than
failing with a bare 502 — the point being that an unexplained failure here tempts
you into adding a public insert policy, which is the one change that would
expose the responses.

`/api/submit` also refuses requests whose `Origin` is not this site, so the
endpoint is not usable straight from someone else's page. It is a low fence: a
script that sets the header itself still gets through, and nothing rate-limits or
deduplicates submissions. That is a deliberate trade-off for a form shared inside
the club, and Netlify's rate limiting is the thing to add if it ever spreads
further.

## Database setup

The schema lives in `supabase/migrations/`, not in the dashboard.
`.github/workflows/migrations.yml` runs `supabase db push` on every push to
`main`, applying any migration the database has not run yet.

Supabase's own GitHub integration does the same job from the dashboard, but it
is built on Branching, which needs a paid plan — hence the Action.

It reads three repository secrets, set under **Settings → Secrets and variables
→ Actions**:

| Secret | Where to find it |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Account settings → Access Tokens → Generate new token |
| `SUPABASE_DB_PASSWORD` | the database password chosen when the project was created |
| `SUPABASE_PROJECT_ID` | the project ref — the subdomain in your project URL |

To apply migrations by hand instead:

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

The CLI does not support `npm i -g supabase`; use `npx`, or `scoop install
supabase` on Windows.

Leave the table with **no policies**. RLS then denies every request carrying a
publishable or anon key, and the secret key used by the function bypasses RLS.
There is no public read or write path to the database.

A second migration revokes the default grants Supabase gives the `anon` and
`authenticated` roles, so the table stays unreadable even if RLS is ever
switched off by accident. Until it is applied, RLS is the only thing standing
in front of the responses — you can tell which state you are in by reading the
table with the publishable key: `[]` means the grant is still there, `permission
denied for table responses` means it has been revoked.

If you followed an earlier setup that added an anon insert policy, remove it:

```sql
drop policy if exists "anon can insert responses" on public.responses;
```

## Reading the responses

The Supabase dashboard is the only way in, so the account that owns the project
is now the whole security boundary — put MFA on it, and on Netlify.

Answers that begin with `=`, `+`, `-` or `@` are stored with a leading
apostrophe. Excel and Sheets run such a cell as a formula, and these answers are
free text that gets exported to CSV, so the function neutralises them on the way
in. If you see a name starting with `'`, that is why; the apostrophe is not
shown once the spreadsheet reads it as text.

### Changing the schema later

Never edit a migration that has already run — Supabase tracks them by the
timestamp in the filename and will skip a file it has seen. Add a new one:

```bash
npx supabase migration new add_some_column
```

Write the `alter table` into the file it creates, then push.

## Local development

```bash
npm i -g netlify-cli
cp .env.example .env      # then fill in both values
netlify dev
```

Open the address it prints. Opening `public/index.html` from the filesystem
will not work — there is no function to answer `/api/submit`.

## Deploying

```bash
netlify deploy --prod
```

Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` under **Site configuration →
Environment variables** first, otherwise submissions return
"The server is not configured yet."

## Changing the form

A question lives in three places, and all three have to agree:

1. **`public/index.html`** — the card markup, plus one entry in the `FIELDS`
   array in the script. `key` is the column name; `required` drives both the
   asterisk and the validation.
2. **`netlify/functions/submit.mjs`** — a line in the `row` object and a check
   in `validate()`. Closed lists have their own set: `ALLOWED_SIZES`,
   `ALLOWED_GRADES`, `ALLOWED_PARTS`. Rename an option in the page and you must
   rename it in the matching set, or the function will reject it.
3. **`public.responses`** — a column with the same name as `key`. The function
   sends the row as-is, so an unknown key makes Supabase reject the insert.
