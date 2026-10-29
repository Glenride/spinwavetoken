/**
 * GET /api/certificate — canonical certificate JSON (D7/D8, 2026-10-29).
 * Public, read-only. ?id=<work id, record id, or certificate id>.
 * Returns the canonical JSON document only for a certified work with
 * a confirmed anchor (>= 12 confirmations). Anything else is
 * not_certified / not_found — never a certificate for an uncertified
 * work, and never a PDF/JSON pair that disagree: the JSON here IS
 * the canonical document; the printable page renders this same JSON.
 */
function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
export async function onRequestGet({ request, env }) {
  if (!env.SPINWAVE_DB) return json({ error: 'not_configured' }, 500);
  const id = (new URL(request.url).searchParams.get('id') || '').trim();
  if (!id) return json({ error: 'bad_request' }, 400);
  const db = env.SPINWAVE_DB;
  await db.prepare('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, title TEXT, authors TEXT, version TEXT, scholar_wallet TEXT, state TEXT, anchor_tx TEXT, anchored_at INTEGER, certificate_id TEXT, created_at INTEGER)').run();
  for (const col of ['document_fingerprint TEXT', 'anchor_confirmations INTEGER', 'anchor_status TEXT']) {
    try { await db.prepare(`ALTER TABLE records ADD COLUMN ${col}`).run(); } catch {}
  }
  const row = await db.prepare('SELECT id, title, authors, version, scholar_wallet, state, anchor_tx, anchored_at, certificate_id, created_at, document_fingerprint, anchor_confirmations FROM records WHERE id = ? OR certificate_id = ?').bind(id, id).first();
  if (!row) return json({ status: 'not_found' }, 404);
  if (row.state !== 'certified' || !row.anchor_tx || row.anchor_confirmations == null || row.anchor_confirmations < 12) {
    return json({ status: 'not_certified', message: 'This record is not certified with a confirmed anchor yet.', record: { id: row.id, state: row.state } }, 200);
  }
  // Work-level identifiers (verdict, payment) come from the pipeline
  // tables when present; a missing link is shown as null, never invented.
  let workId = row.id.startsWith('rec-') ? row.id.slice(4) : null;
  let verdict = null, paymentRef = null;
  if (workId) {
    const v = await db.prepare('SELECT verdict, created_at FROM review_verdicts WHERE work_id = ?').bind(workId).first().catch(() => null);
    if (v) verdict = v;
    const p = await db.prepare('SELECT tx_hash FROM payment_proposals WHERE work_id = ?').bind(workId).first().catch(() => null);
    if (p) paymentRef = p.tx_hash;
  }
  return json({
    certificate_id: row.certificate_id,
    record_id: row.id,
    work_id: workId,
    title: row.title,
    version: row.version,
    scholar: row.authors,
    scholar_wallet: row.scholar_wallet,
    verdict: verdict ? verdict.verdict : null,
    verdict_at: verdict ? verdict.created_at : null,
    payment_transaction: paymentRef,
    anchor_transaction: row.anchor_tx,
    anchor_confirmations: row.anchor_confirmations,
    confirmations_required: 12,
    document_fingerprint: row.document_fingerprint || null,
    anchored_at: row.anchored_at,
    basescan_url: `https://basescan.org/tx/${row.anchor_tx}`,
    record_url: `/records?id=${encodeURIComponent(row.id)}`,
    verify_url: `/api/verify?id=${encodeURIComponent(row.id)}`,
    note: 'Canonical certificate JSON. The printable PDF is a rendering of this document — if they disagree, this JSON + the record + the anchor win.',
  }, 200);
}
