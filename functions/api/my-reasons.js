/**
 * GET /api/my-reasons — SpinWave MVP (2026-10-29).
 * Signed-in only, own works only. Returns verdicts (PAY / CANCEL /
 * INCONCLUSIVE) with their written reasons, for works the caller owns.
 * A verdict without reasons is a pipeline defect — this endpoint
 * returns whatever reasons are stored, verbatim, and never invents
 * a reason to fill a blank. No verdicts yet → an empty list, not
 * a placeholder verdict.
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
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS work_verdicts (id INTEGER PRIMARY KEY AUTOINCREMENT, work_id TEXT, verdict TEXT, reasons TEXT, created_at INTEGER)',
    )
    .run();
  const url = new URL(request.url);
  const workId = url.searchParams.get('work_id') || '';
  let rows;
  if (workId) {
    rows = await db
      .prepare(
        `SELECT v.work_id, w.title, v.verdict, v.reasons, v.created_at FROM work_verdicts v
         JOIN works w ON w.id = v.work_id WHERE w.email = ? AND v.work_id = ?
         ORDER BY v.created_at DESC`,
      )
      .bind(email, workId)
      .all();
  } else {
    rows = await db
      .prepare(
        `SELECT v.work_id, w.title, v.verdict, v.reasons, v.created_at FROM work_verdicts v
         JOIN works w ON w.id = v.work_id WHERE w.email = ?
         ORDER BY v.created_at DESC`,
      )
      .bind(email)
      .all();
  }
  return json({ verdicts: rows.results || [] }, 200);
}
