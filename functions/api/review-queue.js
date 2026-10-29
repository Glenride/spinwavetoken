/**
 * /api/review-queue — SpinWave MVP Phase A reviewer queue (2026-10-29).
 * D2 = D, phase A: a Human finds every verdict. No model verdicts, no
 * automated PAY/CANCEL, in this build.
 *
 * GET  — roster-gated. Returns works in state 'awaiting validity' plus
 *        the check packet a reviewer must complete. Not a reviewer?
 *        403 { error: 'not_reviewer' } — never an empty queue, so a
 *        non-reviewer cannot mistake "no access" for "nothing to do".
 * POST — roster-gated verdict submission. Rules, all enforced here:
 *   - caller must be on the reviewers roster (designated Glenride
 *     staff + scholars in good standing REFERRED by designated staff;
 *     referral is the gate — the roster table is seeded by the operator,
 *     never by a browser form, and never by self-registration).
 *   - caller must not be the work's owner (conflict: author, co-author,
 *     or collaborator on the work may not judge it).
 *   - work must be in 'awaiting validity', and must have no verdict
 *     yet — one Human verdict per work in phase A. Later verdicts are
 *     409 { error: 'already_judged' }.
 *   - verdict must be PAY, CANCEL, or INCONCLUSIVE, with non-empty
 *     written reasons (a verdict without reasons is a pipeline defect
 *     and is rejected here, not stored blank).
 *   - the full check packet must be present (see CHECK_PACKET below):
 *     an incomplete packet is 400, not a partial verdict.
 *   - a CANCEL verdict moves the work to scholar-private 'cancelled'.
 *     A PAY or INCONCLUSIVE verdict does NOT advance the work to any
 *     money stage: payment is blocked until D3 is decided and D11 is
 *     frozen, so a PAY verdict is recorded and the work stays
 *     'awaiting validity' for the operator pipeline to advance later.
 *     This endpoint never creates a payment, a record, an anchor, or
 *     a certificate — those are pipeline stages, not browser actions.
 *   - appeal reviewers (D15) must be uninvolved in the original
 *     finding; that check lives in the appeal flow, not here, because
 *     this endpoint records first findings only.
 *
 * Roster seeding: the reviewers table is created on first use and
 * starts EMPTY. Until the operator seeds it, every signed-in caller
 * gets 403 not_reviewer. That is the safe default, not a bug.
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

// The check packet, from frozen §7.2/§7.3 + D1 (original + complete +
// cleanly declared) + D2 phase A. Every field must be answered; a
// finding is made by the Human reviewer, never by a score alone.
const CHECK_FIELDS = [
  'original', // no unattributed copying beyond fair quotation, no fabricated data, no undisclosed prior publication, no falsely claimed work
  'complete', // manuscript / dataset / codebook / worked example as declared for its tier
  'declared', // cleanly declared: self-reuse disclosed with a clear new contribution, co-authors declared
  'duplicate_checked', // duplicate / prior-publication check performed
  'conflict_free', // reviewer is not an author, co-author, or collaborator on this work
];

async function ensureTables(db) {
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
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS reviewers (email TEXT PRIMARY KEY, referred_by TEXT, added_at INTEGER)',
    )
    .run();
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS review_verdicts (work_id TEXT PRIMARY KEY, reviewer_email TEXT, verdict TEXT, reasons TEXT, checklist TEXT, created_at INTEGER)',
    )
    .run();
}

async function isReviewer(db, email) {
  const row = await db
    .prepare('SELECT email FROM reviewers WHERE email = ?')
    .bind(email)
    .first();
  return !!row;
}

export async function onRequestGet({ request, env }) {
  const email = await sessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  if (!env.SPINWAVE_DB) return json({ error: 'not_configured' }, 500);
  const db = env.SPINWAVE_DB;
  await ensureTables(db);
  if (!(await isReviewer(db, email))) {
    return json(
      { error: 'not_reviewer', message: 'You are not on the reviewer roster. Reviewers are designated Glenride staff and scholars in good standing referred by designated staff.' },
      403,
    );
  }
  const rows = await db
    .prepare(
      `SELECT w.id, w.email AS owner_email, w.title, w.work_type, w.state, w.created_at,
              (SELECT COUNT(*) FROM review_verdicts v WHERE v.work_id = w.id) AS verdict_count
       FROM works w WHERE w.state = 'awaiting validity' ORDER BY w.created_at ASC`,
    )
    .all();
  const queue = (rows.results || []).map((w) => ({
    ...w,
    review_by: w.created_at ? w.created_at + 21 * 24 * 3600 * 1000 : null,
    review_window_days: 21,
  }));
  return json(
    {
      reviewer: email,
      queue,
      check_packet_fields: CHECK_FIELDS,
      note: 'Verdicts are Human findings with written reasons. Inconclusive never pays. A PAY verdict does not move money — payment is blocked until D3 is decided and D11 is frozen.',
    },
    200,
  );
}

export async function onRequestPost({ request, env }) {
  const email = await sessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  if (!env.SPINWAVE_DB) return json({ error: 'not_configured' }, 500);
  const db = env.SPINWAVE_DB;
  await ensureTables(db);
  if (!(await isReviewer(db, email))) {
    return json({ error: 'not_reviewer' }, 403);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request', message: 'Body must be JSON.' }, 400);
  }
  const workId = (body.work_id || '').trim();
  const verdict = (body.verdict || '').trim().toUpperCase();
  const reasons = (body.reasons || '').trim();
  const checklist = body.checklist || {};
  if (!workId || !['PAY', 'CANCEL', 'INCONCLUSIVE'].includes(verdict) || !reasons) {
    return json({ error: 'bad_request', message: 'work_id, a verdict of PAY, CANCEL, or INCONCLUSIVE, and non-empty written reasons are required.' }, 400);
  }
  for (const f of CHECK_FIELDS) {
    if (typeof checklist[f] !== 'boolean') {
      return json({ error: 'bad_request', message: `Check packet field '${f}' must be answered true or false.` }, 400);
    }
  }
  if (checklist.conflict_free !== true) {
    return json({ error: 'bad_request', message: 'A verdict cannot be recorded with conflict_free false — a conflicted reviewer must not judge this work.' }, 400);
  }
  const work = await db
    .prepare('SELECT id, email, title, state FROM works WHERE id = ?')
    .bind(workId)
    .first();
  if (!work) return json({ error: 'not_found' }, 404);
  if ((work.email || '').toLowerCase() === email) {
    return json({ error: 'conflict', message: 'You cannot judge your own work.' }, 403);
  }
  if (work.state !== 'awaiting validity') {
    return json({ error: 'not_awaiting_validity', message: `Work is in state '${work.state}', not 'awaiting validity'.` }, 409);
  }
  const existing = await db
    .prepare('SELECT work_id FROM review_verdicts WHERE work_id = ?')
    .bind(workId)
    .first();
  if (existing) return json({ error: 'already_judged', message: 'This work already has a Human verdict in phase A.' }, 409);

  const now = Date.now();
  await db
    .prepare('INSERT INTO review_verdicts (work_id, reviewer_email, verdict, reasons, checklist, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(workId, email, verdict, reasons, JSON.stringify(checklist), now)
    .run();
  await db
    .prepare('INSERT INTO work_verdicts (work_id, verdict, reasons, created_at) VALUES (?, ?, ?, ?)')
    .bind(workId, verdict, reasons, now)
    .run();
  if (verdict === 'CANCEL') {
    await db
      .prepare('UPDATE works SET state = ?, updated_at = ? WHERE id = ?')
      .bind('cancelled', now, workId)
      .run();
  }
  // PAY and INCONCLUSIVE deliberately leave state at 'awaiting validity':
  // PAY must not advance to a money stage while payment is blocked, and
  // INCONCLUSIVE must not default to PAY. The operator pipeline advances
  // a PAY verdict only after D3 + D11 are settled.
  return json(
    {
      work_id: workId,
      verdict,
      reviewer: email,
      state_after: verdict === 'CANCEL' ? 'cancelled' : 'awaiting validity',
      payment_moved: false,
      record_created: false,
      certificate_created: false,
    },
    200,
  );
}
