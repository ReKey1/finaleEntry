/**
 * POST /api/submit
 *
 * The only place in this project that holds Supabase credentials. They are
 * read from environment variables at runtime and never sent to the browser,
 * so nothing secret ends up in the deployed page or in Git.
 *
 * Required environment variables:
 *   SUPABASE_URL           https://<project-ref>.supabase.co
 *   SUPABASE_SECRET_KEY    Project Settings -> API Keys -> Secret keys
 *
 * It has to be a *secret* key (sb_secret_...). Those bypass row level
 * security, which is why the database needs no public insert policy at all
 * - see README.md. A publishable key (sb_publishable_...) is subject to RLS,
 * so with no policies on the table every insert it makes is denied.
 */

const TABLE = 'responses';

// Keep in step with the options offered in public/index.html. The function
// rejects anything else, so a renamed option has to be changed in both files.
const ALLOWED_SIZES = new Set(['S', 'M', 'L', 'XL', 'XXL']);
const ALLOWED_GRADES = new Set(['22', '23', '24', '25', '26']);
const ALLOWED_PARTS = new Set(['かまわない！', 'はい']);

const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 320;
const MAX_TEXT_LENGTH = 1000;

// Same expression the page uses, so the two agree on what an address is.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // The headers block in netlify.toml does not reliably reach function
      // responses, so this one is set here as well as there.
      'x-content-type-options': 'nosniff',
    },
  });
}

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Answers are read in the Supabase dashboard and exported to CSV, and a cell
 * beginning with any of these is run as a formula by Excel and Sheets. A
 * leading apostrophe makes the spreadsheet treat the value as plain text; it
 * is not shown in the cell. Applied only to the free-text answers - email is
 * already constrained by EMAIL_RE, and the rest come from closed lists.
 */
function neutralize(value) {
  if (!value) return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * Returns a reason the key cannot be used, or null when it looks usable.
 *
 * Supabase issues two formats. The current one is prefixed - sb_secret_ for
 * server use, sb_publishable_ for the browser. The legacy one is a JWT whose
 * payload carries a `role` claim, either service_role or anon. Only the two
 * server-side variants bypass row level security; the other two are denied by
 * a table with no policies, and the only symptom would be a generic 502.
 */
function keyProblem(key) {
  if (key.startsWith('sb_secret_')) return null;
  if (key.startsWith('sb_publishable_')) {
    return 'it is a publishable key (sb_publishable_...)';
  }

  if (key.startsWith('eyJ')) {
    let role;
    try {
      role = JSON.parse(atob(key.split('.')[1])).role;
    } catch {
      return 'it looks like a JWT but could not be decoded';
    }
    if (role === 'service_role') return null;
    return `it is a legacy key with role "${role}"`;
  }

  return 'it matches no key format Supabase issues';
}

/**
 * The form is the only intended client, so a request that did not come from
 * the page is refused. Netlify sets URL and DEPLOY_PRIME_URL itself, and the
 * request's own origin covers `netlify dev` on localhost, so this needs no
 * configuration to work in every environment.
 *
 * A same-origin JSON POST is not preflighted and carries no CORS requirement,
 * which is why nothing is sent back to make cross-origin calls succeed.
 */
function isAllowedOrigin(req) {
  const origin = req.headers.get('origin');
  // Browsers send Origin on every POST, including same-origin ones. Its
  // absence means the caller is not a browser running our page.
  if (!origin) return false;

  const allowed = [
    new URL(req.url).origin,
    process.env.URL,
    process.env.DEPLOY_PRIME_URL,
  ].filter(Boolean);

  return allowed.some((candidate) => {
    try {
      return new URL(candidate).origin === origin;
    } catch {
      return false;
    }
  });
}

/** Returns an error string, or null when the payload is acceptable. */
function validate(row) {
  if (!row.email) return 'Email is required.';
  if (row.email.length > MAX_EMAIL_LENGTH) return 'That email address is too long.';
  if (!EMAIL_RE.test(row.email)) return 'That email address looks wrong.';

  if (!row.full_name) return 'Name is required.';
  if (row.full_name.length > MAX_NAME_LENGTH) return 'That name is too long.';

  if (!row.line_name) return 'Line name is required.';
  if (row.line_name.length > MAX_NAME_LENGTH) return 'That Line name is too long.';

  if (!row.tshirt_size) return 'T-shirt size is required.';
  if (!ALLOWED_SIZES.has(row.tshirt_size)) return 'Unrecognised option.';

  if (!row.grade) return 'Year is required.';
  if (!ALLOWED_GRADES.has(row.grade)) return 'Unrecognised option.';

  if (!row.extra_parts) return 'This is a required question.';
  if (!ALLOWED_PARTS.has(row.extra_parts)) return 'Unrecognised option.';

  // The only optional question on the form.
  if (row.content_idea !== null && row.content_idea.length > MAX_TEXT_LENGTH) {
    return 'That answer is too long.';
  }

  return null;
}

export default async (req) => {
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed.' });
  }

  if (!isAllowedOrigin(req)) {
    return json(403, { error: 'Requests are only accepted from the form.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !secretKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY.');
    return json(500, { error: 'The server is not configured yet.' });
  }

  // Fail loudly on the wrong class of key, rather than letting row level
  // security deny the insert and surface a generic 502. That symptom invites
  // "fixing" the database by adding a public insert policy or turning RLS off
  // - the two changes that would actually expose the responses.
  const badKey = keyProblem(secretKey);
  if (badKey) {
    console.error(
      `SUPABASE_SECRET_KEY cannot be used: ${badKey}. Only a secret key ` +
      'bypasses row level security; anything else has every insert denied by ' +
      'a table with no policies. Take one from Project Settings -> API Keys ' +
      '-> Secret keys.'
    );
    return json(500, { error: 'The server is not configured yet.' });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'Expected a JSON body.' });
  }

  // Never trust the client: re-derive every field rather than forwarding
  // the request body, so extra keys cannot reach the table.
  const row = {
    email: str(payload.email),
    full_name: str(payload.full_name),
    line_name: str(payload.line_name),
    tshirt_size: str(payload.tshirt_size),
    grade: str(payload.grade),
    extra_parts: str(payload.extra_parts),
    content_idea: str(payload.content_idea) || null,
  };

  const problem = validate(row);
  if (problem) {
    return json(400, { error: problem });
  }

  // After validate(), so the length limits are measured against what was
  // actually typed rather than against an added apostrophe.
  row.full_name = neutralize(row.full_name);
  row.line_name = neutralize(row.line_name);
  row.content_idea = neutralize(row.content_idea);

  const res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
      prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    // Log the detail, return something generic - Supabase errors quote
    // column names and constraints we would rather not publish.
    console.error('Supabase insert failed:', res.status, await res.text());
    return json(502, { error: 'Could not save your response. Please try again.' });
  }

  return json(201, { ok: true });
};
