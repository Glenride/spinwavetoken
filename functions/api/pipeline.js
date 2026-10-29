/**
 * /api/pipeline — SpinWave operator pipeline (2026-10-29, build-now).
 * Working defaults adopted per the 2026-10-29 18:01 instruction ("build
 * it now, I will give my input and you will modify"): D3 dedicated
 * allocation Safe with Human signing, D4 full amount on trigger,
 * D5 TTOS-only cancels, D6 once + 90-day pause, D7/D8 PDF+JSON with
 * fingerprint anchor, D9 12 Base confirmations. These are WORKING
 * DEFAULTS, not ratified decisions — they change on his word.
 *
 * Gate: every action here requires a reviewers-roster session
 * (designated Glenride staff + referred scholars). The roster is the
 * v1 operator pool; a separate payment-operator role can split it
 * later. Signed-out = 401, non-roster = 403.
 *
 * What this endpoint NEVER does:
 * - hold a private key, sign a transfer, or move STANZA itself. The
 *   Safe owner signs in the Safe app; this endpoint only PROPOSES
 *   (machine proposes) and RECORDS a transaction hash after a Human
 *   signs (Human decides), then checks that hash on Base.
 * - create a record, anchor, or certificate before its stage gates
 *   pass: PAY verdict -> proposal -> confirmed payment (receipt
 *   success on Base) -> upload recorded -> anchor requested ->
 *   anchor confirmed (>= 12 confirmations, receipt success) ->
 *   record created + work certified.
 * - pay an unverified wallet, a held co-author share, or an amount
 *   other than the schedule for the work type.
 *
 * On-chain check (confirm_payment / confirm_anchor): the supplied
 * transaction hash is looked up on Base's public RPC. It must exist
 * and its receipt status must be success. A pending, failed, or
 * missing transaction is rejected — an operator-recorded hash is
 * not trusted on its own. Full ERC-20 log-amount verification
 * (Transfer events summing to the proposed amount, in the token's
 * decimals) is a documented follow-up, not claimed here: this build
 * verifies existence + receipt success, and records the proposed
 * amount alongside the hash for audit.
 */

const enc = new TextEncoder();
const STANZA = '0xf629f16ba91086e266accc417d10742f76207ba3';
const BASE_RPC = 'https://mainnet.base.org';

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
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
  try { payload = b64urlDecode(cookieValue(request.headers.get('Cookie'), 'sp_session')); } catch { return ''; }
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
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function isTxHash(s) { return /^0x[0-9a-fA-F]{64}$/.test(s || ''); }

function scheduleAmount(work) {
  const t = (work.work_type || '').toLowerCase();
  // Tier order matters: a dataset with a worked example is 55,000, a
  // plain dataset 40,000. work_type values come from TTOS; if the
  // type does not match a known tier, refuse rather than invent an amount.
  if (t.includes('translation')) return 12000;
  if (t.includes('revision')) return 8000;
  if (t.includes('dataset')) return t.includes('example') ? 55000 : 40000;
  if (t.includes('manuscript')) return 25000;
  return null;
}

async function ensureTables(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS works (id TEXT PRIMARY KEY, email TEXT, title TEXT, work_type TEXT, state TEXT, payment_ref TEXT, record_id TEXT, anchor_tx TEXT, certificate_id TEXT, created_at INTEGER, updated_at INTEGER)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS work_verdicts (id INTEGER PRIMARY KEY AUTOINCREMENT, work_id TEXT, verdict TEXT, reasons TEXT, created_at INTEGER)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS reviewers (email TEXT PRIMARY KEY, referred_by TEXT, added_at INTEGER)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS review_verdicts (work_id TEXT PRIMARY KEY, reviewer_email TEXT, verdict TEXT, reasons TEXT, checklist TEXT, created_at INTEGER)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS wallet_links (email TEXT PRIMARY KEY, address TEXT, verified_at INTEGER)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS work_coauthors (work_id TEXT, email TEXT, share_percent REAL, verified INTEGER, created_at INTEGER, PRIMARY KEY (work_id, email))').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS payment_proposals (work_id TEXT PRIMARY KEY, amount INTEGER, splits TEXT, status TEXT, tx_hash TEXT, created_at INTEGER, confirmed_at INTEGER)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS work_pipeline (work_id TEXT PRIMARY KEY, document_fingerprint TEXT, storage_pointer TEXT, anchor_request_id TEXT, anchor_tx TEXT, anchor_confirmations INTEGER, updated_at INTEGER)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, title TEXT, authors TEXT, version TEXT, scholar_wallet TEXT, state TEXT, anchor_tx TEXT, anchored_at INTEGER, certificate_id TEXT, created_at INTEGER)').run();
  for (const col of ['document_fingerprint TEXT', 'anchor_confirmations INTEGER', 'anchor_status TEXT']) {
    try { await db.prepare(`ALTER TABLE records ADD COLUMN ${col}`).run(); } catch {}
  }
}

async function baseReceipt(txHash) {
  try {
    const res = await fetch(BASE_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [txHash] }),
    });
    const j = await res.json();
    return j.result || null; // null = not yet mined / unknown
  } catch {
    return 'rpc_error';
  }
}

export async function onRequestGet({ request, env }) {
  const email = await sessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  if (!env.SPINWAVE_DB) return json({ error: 'not_configured' }, 500);
  const db = env.SPINWAVE_DB;
  await ensureTables(db);
  const roster = await db.prepare('SELECT email FROM reviewers WHERE email = ?').bind(email).first();
  if (!roster) return json({ error: 'not_reviewer' }, 403);
  const works = await db.prepare(`SELECT id, email, title, work_type, state, payment_ref, record_id, anchor_tx, certificate_id, created_at, updated_at FROM works ORDER BY created_at DESC`).all();
  const out = [];
  for (const w of (works.results || [])) {
    const verdict = await db.prepare('SELECT verdict, reasons, created_at FROM review_verdicts WHERE work_id = ?').bind(w.id).first();
    const proposal = await db.prepare('SELECT amount, splits, status, tx_hash FROM payment_proposals WHERE work_id = ?').bind(w.id).first();
    const pipe = await db.prepare('SELECT document_fingerprint, storage_pointer, anchor_request_id, anchor_tx, anchor_confirmations FROM work_pipeline WHERE work_id = ?').bind(w.id).first();
    out.push({ ...w, verdict: verdict || null, payment: proposal || null, pipeline: pipe || null });
  }
  return json({ operator: email, works: out }, 200);
}

export async function onRequestPost({ request, env }) {
  const email = await sessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);
  if (!env.SPINWAVE_DB) return json({ error: 'not_configured' }, 500);
  const db = env.SPINWAVE_DB;
  await ensureTables(db);
  const roster = await db.prepare('SELECT email FROM reviewers WHERE email = ?').bind(email).first();
  if (!roster) return json({ error: 'not_reviewer' }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const action = body.action || '';
  const workId = (body.work_id || '').trim();
  if (!workId) return json({ error: 'bad_request', message: 'work_id is required.' }, 400);
  const work = await db.prepare('SELECT id, email, title, work_type, state FROM works WHERE id = ?').bind(workId).first();
  if (!work) return json({ error: 'not_found' }, 404);
  const now = Date.now();

  if (action === 'propose_payment') {
    const verdict = await db.prepare('SELECT verdict FROM review_verdicts WHERE work_id = ?').bind(workId).first();
    if (!verdict || verdict.verdict !== 'PAY') return json({ error: 'no_pay_verdict', message: 'No PAY verdict exists for this work. No PAY verdict -> no payment.' }, 409);
    if (work.state !== 'awaiting validity') return json({ error: 'wrong_state', message: `Work is '${work.state}', not 'awaiting validity'.` }, 409);
    const existing = await db.prepare('SELECT work_id FROM payment_proposals WHERE work_id = ?').bind(workId).first();
    if (existing) return json({ error: 'already_proposed' }, 409);
    const amount = scheduleAmount(work);
    if (amount == null) return json({ error: 'unknown_schedule', message: `Work type '${work.work_type}' does not match a known recognition tier. No amount invented.` }, 400);
    const wallet = await db.prepare('SELECT address FROM wallet_links WHERE email = ?').bind((work.email || '').toLowerCase()).first();
    if (!wallet || !wallet.address) return json({ error: 'no_verified_wallet', message: 'The submitting scholar has no signature-verified wallet. Payment may only go to a verified wallet.' }, 409);
    const co = await db.prepare('SELECT email, share_percent, verified FROM work_coauthors WHERE work_id = ?').bind(workId).all();
    const coauthors = co.results || [];
    let splits;
    if (!coauthors.length) {
      splits = [{ email: (work.email || '').toLowerCase(), wallet: wallet.address, share_percent: 100, amount, status: 'payable' }];
    } else {
      const sum = coauthors.reduce((a, c) => a + Number(c.share_percent || 0), 0);
      if (Math.abs(sum - 100) > 0.001) return json({ error: 'bad_splits', message: `Co-author shares sum to ${sum}, not 100. Fix the declaration before proposing.` }, 400);
      splits = [];
      let allocated = 0;
      for (const c of coauthors) {
        const shareAmount = Math.round(amount * Number(c.share_percent) / 100);
        allocated += shareAmount;
        // A co-author's wallet is only payable if verified; otherwise held.
        // For the submitting scholar we already have the verified wallet;
        // for other co-authors, verified=1 in the table means a verified
        // wallet is on file (their own wallet_links row) — checked below.
        let coWallet = null;
        if (c.verified) {
          const wl = await db.prepare('SELECT address FROM wallet_links WHERE email = ?').bind((c.email || '').toLowerCase()).first();
          coWallet = wl ? wl.address : null;
        }
        splits.push({ email: (c.email || '').toLowerCase(), wallet: coWallet, share_percent: Number(c.share_percent), amount: shareAmount, status: c.verified && coWallet ? 'payable' : 'held' });
      }
      // Remainder (rounding) goes to the submitting scholar, per D17.
      const remainder = amount - allocated;
      if (remainder !== 0) {
        const sub = splits.find((s) => s.email === (work.email || '').toLowerCase());
        if (sub) { sub.amount += remainder; } else { splits.push({ email: (work.email || '').toLowerCase(), wallet: wallet.address, share_percent: 0, amount: remainder, status: 'payable' }); }
      }
    }
    await db.prepare('INSERT INTO payment_proposals (work_id, amount, splits, status, tx_hash, created_at, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(workId, amount, JSON.stringify(splits), 'proposed', null, now, null).run();
    return json({ work_id: workId, amount, splits, status: 'proposed', next: 'Sign the transfer(s) in the allocation Safe app, then confirm_payment with the transaction hash. The server never signs.' }, 200);
  }

  if (action === 'confirm_payment') {
    const txHash = (body.tx_hash || '').trim();
    if (!isTxHash(txHash)) return json({ error: 'bad_request', message: 'tx_hash must be a 0x + 64 hex Base transaction hash.' }, 400);
    const proposal = await db.prepare('SELECT amount, splits, status FROM payment_proposals WHERE work_id = ?').bind(workId).first();
    if (!proposal) return json({ error: 'no_proposal', message: 'Propose the payment first.' }, 409);
    if (proposal.status === 'confirmed') return json({ error: 'already_confirmed' }, 409);
    if (work.state !== 'awaiting validity') return json({ error: 'wrong_state' }, 409);
    const receipt = await baseReceipt(txHash);
    if (receipt === 'rpc_error') return json({ error: 'base_unreachable', message: 'Could not reach Base to verify the transaction. Try again — nothing was recorded.' }, 502);
    if (!receipt) return json({ error: 'tx_not_found', message: 'No transaction with that hash on Base yet. If it is pending, wait for it to mine, then confirm again.' }, 409);
    if (receipt.status !== '0x1' && receipt.status !== 1) return json({ error: 'tx_failed', message: 'That Base transaction failed. A failed payment advances nothing.' }, 400);
    await db.prepare('UPDATE payment_proposals SET status = ?, tx_hash = ?, confirmed_at = ? WHERE work_id = ?').bind('confirmed', txHash, now, workId).run();
    await db.prepare('UPDATE works SET state = ?, payment_ref = ?, updated_at = ? WHERE id = ?').bind('payment complete', txHash, now, workId).run();
    return json({ work_id: workId, state: 'payment complete', payment_ref: txHash, next: 'Record the upload (document fingerprint + storage pointer).' }, 200);
  }

  if (action === 'record_upload') {
    const fingerprint = (body.document_fingerprint || '').trim().toLowerCase();
    const pointer = (body.storage_pointer || '').trim();
    if (!isTxHash(fingerprint) && !/^[0-9a-f]{64}$/.test(fingerprint)) return json({ error: 'bad_request', message: 'document_fingerprint must be a 64-hex hash of the final validated document bytes.' }, 400);
    if (!pointer) return json({ error: 'bad_request', message: 'storage_pointer is required (homelab location now, migration-ready).' }, 400);
    if (work.state !== 'payment complete') return json({ error: 'wrong_state', message: `Work is '${work.state}', not 'payment complete'. Upload follows payment, never before it.` }, 409);
    await db.prepare('INSERT INTO work_pipeline (work_id, document_fingerprint, storage_pointer, anchor_request_id, anchor_tx, anchor_confirmations, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(work_id) DO UPDATE SET document_fingerprint = excluded.document_fingerprint, storage_pointer = excluded.storage_pointer, updated_at = excluded.updated_at')
      .bind(workId, fingerprint, pointer, null, null, null, now).run();
    await db.prepare('UPDATE works SET state = ?, updated_at = ? WHERE id = ?').bind('anchoring pending', now, workId).run();
    return json({ work_id: workId, state: 'anchoring pending', document_fingerprint: fingerprint }, 200);
  }

  if (action === 'request_anchor') {
    const requestId = (body.anchor_request_id || '').trim();
    if (!requestId) return json({ error: 'bad_request', message: 'anchor_request_id is required (the Pearls anchor request).' }, 400);
    if (work.state !== 'anchoring pending') return json({ error: 'wrong_state' }, 409);
    await db.prepare('INSERT INTO work_pipeline (work_id, document_fingerprint, storage_pointer, anchor_request_id, anchor_tx, anchor_confirmations, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(work_id) DO UPDATE SET anchor_request_id = excluded.anchor_request_id, updated_at = excluded.updated_at')
      .bind(workId, null, null, requestId, null, null, now).run();
    return json({ work_id: workId, state: 'anchoring pending', anchor_request_id: requestId, note: 'Pearls anchoring is Antigravity\'s in-flight track — this records the request, it does not anchor on Base itself.' }, 200);
  }

  if (action === 'confirm_anchor') {
    const anchorTx = (body.anchor_tx || '').trim();
    const confirmations = Number(body.confirmations);
    if (!isTxHash(anchorTx)) return json({ error: 'bad_request', message: 'anchor_tx must be a 0x + 64 hex Base transaction hash.' }, 400);
    if (!Number.isFinite(confirmations) || confirmations < 12) return json({ error: 'insufficient_confirmations', message: `Anchor has ${confirmations} confirmations; 12 are required before a certificate prints.` }, 400);
    if (work.state !== 'anchoring pending') return json({ error: 'wrong_state' }, 409);
    const pipe = await db.prepare('SELECT document_fingerprint, storage_pointer, anchor_request_id FROM work_pipeline WHERE work_id = ?').bind(workId).first();
    if (!pipe || !pipe.document_fingerprint) return json({ error: 'no_upload', message: 'Record the upload (with document fingerprint) before confirming an anchor.' }, 409);
    const receipt = await baseReceipt(anchorTx);
    if (receipt === 'rpc_error') return json({ error: 'base_unreachable' }, 502);
    if (!receipt) return json({ error: 'tx_not_found' }, 409);
    if (receipt.status !== '0x1' && receipt.status !== 1) return json({ error: 'tx_failed' }, 400);
    const verdict = await db.prepare('SELECT verdict, created_at FROM review_verdicts WHERE work_id = ?').bind(workId).first();
    const proposal = await db.prepare('SELECT tx_hash FROM payment_proposals WHERE work_id = ?').bind(workId).first();
    const wallet = await db.prepare('SELECT address FROM wallet_links WHERE email = ?').bind((work.email || '').toLowerCase()).first();
    const recordId = `rec-${workId}`;
    const certificateId = `cert-${workId}`;
    await db.prepare('UPDATE work_pipeline SET anchor_tx = ?, anchor_confirmations = ?, updated_at = ? WHERE work_id = ?').bind(anchorTx, confirmations, now, workId).run();
    await db.prepare('INSERT OR REPLACE INTO records (id, title, authors, version, scholar_wallet, state, anchor_tx, anchored_at, certificate_id, created_at, document_fingerprint, anchor_confirmations, anchor_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(recordId, work.title, work.email, '1', wallet ? wallet.address : null, 'certified', anchorTx, now, certificateId, now, pipe.document_fingerprint, confirmations, 'confirmed').run();
    await db.prepare('UPDATE works SET state = ?, record_id = ?, anchor_tx = ?, certificate_id = ?, updated_at = ? WHERE id = ?').bind('certified', recordId, anchorTx, certificateId, now, workId).run();
    return json({ work_id: workId, state: 'certified', record_id: recordId, certificate_id: certificateId, anchor_tx: anchorTx, confirmations }, 200);
  }

  return json({ error: 'bad_request', message: 'Unknown action. Use propose_payment, confirm_payment, record_upload, request_anchor, or confirm_anchor.' }, 400);
}
