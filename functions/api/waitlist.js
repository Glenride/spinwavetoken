/**
 * /api/waitlist — SpinWave waitlist (live 2026-10-28, D1 spinwave-waitlist).
 * Session-gated: only a signed-in visitor (sp_session, same verification
 * as /api/me) can join or read their place. No sign-in, no row.
 *
 * GET  → { joined, track, wallet, position } (position = 1-based place in
 *         line by signup order; joined:false when no row exists).
 * POST → { track?: 'scholar'|'supporter', wallet?: '0x…' } — joins or
 *         updates the caller's row. Joining sets the track; a wallet-only
 *         POST links a wallet to an existing row (409 when not joined).
 *         The signup order (created_at) never moves on update.
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
  // Split from the right: the email itself may contain dots.
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

async function statusFor(db, email) {
  const row = await db
    .prepare('SELECT rowid AS rid, track, wallet FROM waitlist WHERE email = ?')
    .bind(email)
    .first();
  if (!row) return { joined: false, track: null, wallet: null, position: null };
  // rowid is insertion order, so the place in line is exact even when two
  // visitors join in the same second (created_at ties would double-count).
  const pos = await db
    .prepare('SELECT COUNT(*) AS n FROM waitlist WHERE rowid <= ?')
    .bind(row.rid)
    .first();
  return {
    joined: true,
    track: row.track,
    wallet: row.wallet || null,
    position: pos ? pos.n : null,
  };
}

export async function onRequestGet({ request, env }) {
  const email = await sessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  if (!env.SPINWAVE_DB) return json({ error: 'not_configured' }, 500);
  return json(await statusFor(env.SPINWAVE_DB, email), 200);
}

export async function onRequestPost({ request, env }) {
  const email = await sessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  if (!env.SPINWAVE_DB) return json({ error: 'not_configured' }, 500);
  let body = null;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const track = body && body.track;
  const wallet = body && body.wallet;
  if (track !== undefined && track !== 'scholar' && track !== 'supporter') {
    return json({ error: 'bad_track' }, 400);
  }
  if (wallet !== undefined && wallet !== null && !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return json({ error: 'bad_wallet' }, 400);
  }
  if (track === undefined && wallet === undefined) {
    return json({ error: 'bad_request' }, 400);
  }
  const db = env.SPINWAVE_DB;
  const now = Math.floor(Date.now() / 1000);
  if (track !== undefined) {
    // Join (or switch tracks). created_at stays original on update, so a
    // track switch never moves the caller's place in line.
    await db
      .prepare(
        `INSERT INTO waitlist (email, track, wallet, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET track = excluded.track,
           wallet = COALESCE(excluded.wallet, waitlist.wallet)`,
      )
      .bind(email, track, wallet === undefined ? null : wallet, now)
      .run();
  } else {
    // Wallet-only link: requires an existing row.
    const existing = await db
      .prepare('SELECT email FROM waitlist WHERE email = ?')
      .bind(email)
      .first();
    if (!existing) return json({ error: 'not_joined' }, 409);
    await db
      .prepare('UPDATE waitlist SET wallet = ? WHERE email = ?')
      .bind(wallet, email)
      .run();
  }
  return json(await statusFor(db, email), 200);
}
