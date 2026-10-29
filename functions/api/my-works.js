/**
 * GET /api/my-works — SpinWave MVP (2026-10-29).
 * Signed-in only, own works only. Read-only: this endpoint never
 * creates a work. Works are created only by the operator pipeline /
 * ThinkTank OS sync (in-flight track) — a browser POST here must
 * never mint a record, a payment, or a certificate.
 * State labels are the single pipeline set: awaiting validity,
 * payment failed, payment complete, upload pending, anchoring
 * pending, anchored, certified, cancelled. A work in a later state
 * without its earlier outputs (payment reference, record, confirmed
 * hash) is a data defect, not a display choice — the UI shows the
 * state as stored and never upgrades it.
 */

const enc = new TextEncoder();

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookieValue(cookieHeader, name) {
  const m = (cookieHeader || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : '';
}

function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(s + '='.repeat((4 - (s.length % 4)) % 4))));
}

async function sessionEmail(request, env) {
  if (!env.WORKOS_API_KEY) return '';
  let payload = '';
  try {
    payload = b64urlDecode(cookieValue(request.headers.get('Cookie'), 'sp_session'));
  } catch {
    return '';
  }
  const parts = payload.split('.');
  const sig = parts.pop();
  const expiryStr = parts.pop();
  const email = parts.join('.');
  const expiry = Number(expiryStr);
  if (!email || !expiry || expiry * 1000 < Date.now()) return '';
  if (!safeEqual(await hmacHex(env.WORKOS_API_KEY, `${email}.${expiry}`), sig)) return '';
  return email.toLowerCase();
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ request, env }) {
  const email = await sessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  if (!env.SPINWAVE_DB) return json({ error: 'not_configured' }, 500);
  const db = env.SPINWAVE_DB;
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS works (id TEXT PRIMARY KEY, email TEXT, title TEXT, work_type TEXT, state TEXT, payment_ref TEXT, record_id TEXT, anchor_tx TEXT, certificate_id TEXT, created_at INTEGER, updated_at INTEGER)',
    )
    .run();
  const rows = await db
    .prepare(
      'SELECT id, title, work_type, state, payment_ref, record_id, anchor_tx, certificate_id, created_at, updated_at FROM works WHERE email = ? ORDER BY created_at DESC',
    )
    .bind(email)
    .all();
  // D17 co-author splits (v1 data model, read-only here): shares are
  // declared at submission in ThinkTank OS / the operator pipeline,
  // never by a browser POST. A share for an unverified co-author is
  // HELD and released on verification, never redirected.
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS work_coauthors (work_id TEXT, email TEXT, share_percent REAL, verified INTEGER, created_at INTEGER, PRIMARY KEY (work_id, email))',
    )
    .run();
  const works = rows.results || [];
  for (const w of works) {
    const co = await db
      .prepare('SELECT email, share_percent, verified FROM work_coauthors WHERE work_id = ? ORDER BY share_percent DESC')
      .bind(w.id)
      .all();
    w.coauthors = (co.results || []).map((c) => ({
      email: c.email,
      share_percent: c.share_percent,
      verified: !!c.verified,
      share_status: c.verified ? 'payable' : 'held',
    }));
  }
  return json({ works }, 200);
}
