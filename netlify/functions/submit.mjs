/**
 * POST /api/submit
 *
 * The only place in this project that holds Supabase credentials. They are
 * read from environment variables at runtime and never sent to the browser,
 * so nothing secret ends up in the deployed page or in Git.
 *
 * Required environment variables:
 *   SUPABASE_URL                 https://<project-ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY    Settings -> API -> service_role (secret)
 *
 * The service_role key bypasses row level security, which is why the
 * database needs no public insert policy at all - see README.md.
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
    headers: { 'content-type': 'application/json' },
  });
}

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
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

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
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

  const res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
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
