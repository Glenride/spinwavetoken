/**
 * SpinWave markdown middleware — the ONE markdown handler (Prompt 1).
 *
 * - GET /<page>.md            -> static markdown file for that page
 * - GET /<page> (or /<page>.html) with Accept: text/markdown preferred
 *   over text/html             -> the same markdown
 * - GET /api/md/<slug>        -> markdown for that page (debugging)
 * - GET /api/md/_catalog      -> JSON catalog of every markdown route
 * - GET /records.md?id=X / /certificate.md?id=X (and /api/md/records,
 *   /api/md/certificate)      -> markdown rendered from the live record /
 *   certificate via /api/records / /api/certificate; without ?id= the
 *   generic template page is served.
 * - Unknown .md / unknown slug -> a markdown 404 body, status 404, never HTML.
 *
 * Accept parsing: markdown is served only when text/markdown has a higher
 * q-value than text/html. A missing Accept header, a wildcard Accept, or
 * any tie gets HTML.
 * Static .md files are served by Pages; this middleware only adds the
 * Prompt-1 headers (and serves negotiated / API responses). The internal
 * fetch header below keeps asset fetches from re-entering this middleware.
 *
 * Excluded, always: /api/* (except /api/md/*) and /auth/* are never
 * markdown-rendered and never appear in llms.txt / the catalog.
 */
import { REGISTRY, SITE_URL } from "./md-registry.js";

const INTERNAL = "x-spinwave-md-internal";
const DESCRIBEDBY =
  `<${SITE_URL}/llms.txt>; rel="describedby", ` +
  `<${SITE_URL}/llms-full.txt>; rel="describedby", ` +
  `<${SITE_URL}/ai.txt>; rel="describedby"`;

const BY_MD = new Map(Object.values(REGISTRY).map((e) => [e.md, e]));
const BY_ROUTE = new Map();
for (const e of Object.values(REGISTRY)) {
  BY_ROUTE.set(e.route, e);
  BY_ROUTE.set(e.clean_route, e);
  BY_ROUTE.set(`/${e.html}`, e);
}

function qOf(accept, type) {
  // q-value for `type` (e.g. "text/markdown") in an Accept header.
  // Falls back to */* and type/* entries; 0 when not acceptable at all.
  if (!accept) return 0;
  let best = 0;
  for (const part of accept.split(",")) {
    const [rawType, ...params] = part.split(";").map((s) => s.trim());
    let q = 1;
    for (const p of params) {
      const m = p.match(/^q=([0-9.]+)$/);
      if (m) q = parseFloat(m[1]);
    }
    if (rawType === type || rawType === "*/*" ||
        rawType === type.split("/")[0] + "/*") {
      best = Math.max(best, q);
    }
  }
  return best;
}

function prefersMarkdown(request) {
  const accept = request.headers.get("Accept");
  if (!accept) return false;
  return qOf(accept, "text/markdown") > qOf(accept, "text/html");
}

function mdHeaders(entry, body, { negotiated = false } = {}) {
  const headers = new Headers();
  headers.set("Content-Type", "text/markdown; charset=utf-8");
  headers.set("X-Markdown-Tokens", String(Math.ceil(body.length / 4)));
  headers.set("X-Robots-Tag", "noindex, follow");
  headers.set("Content-Location", entry.canonical);
  headers.set("Link", `<${entry.canonical}>; rel="canonical"`);
  headers.set("Cache-Control",
    "public, s-maxage=3600, stale-while-revalidate=86400");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  if (negotiated) headers.set("Vary", "Accept");
  if (entry.lastmod) {
    headers.set("Last-Modified",
      new Date(`${entry.lastmod}T00:00:00Z`).toUTCString());
  }
  return headers;
}

function mdResponse(entry, body, status = 200, opts = {}) {
  return new Response(body, { status, headers: mdHeaders(entry, body, opts) });
}

function md404(pathname) {
  const body =
    `# Not found\n\n> No markdown version exists for this address.\n\n` +
    `Canonical: ${SITE_URL}/\nLast updated: ${new Date().toISOString().slice(0, 10)}\n\n` +
    `No page at \`${pathname}\` exists on SpinWave. ` +
    `See [SpinWave](${SITE_URL}/) or the [markdown catalog](${SITE_URL}/api/md/_catalog).\n`;
  const entry = { canonical: `${SITE_URL}/`, lastmod: null };
  return mdResponse(entry, body, 404);
}

function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

async function fetchAsset(context, path) {
  // env.ASSETS fetches the static asset without re-entering this
  // middleware. Fall back to a same-origin fetch flagged internal.
  if (context.env.ASSETS) {
    return context.env.ASSETS.fetch(new Request(`https://assets${path}`));
  }
  const req = new Request(new URL(path, context.request.url), {
    headers: { [INTERNAL]: "1" },
  });
  return fetch(req);
}

async function staticMd(context, entry) {
  const res = await fetchAsset(context, entry.md);
  if (!res.ok) return md404(entry.md);
  const body = await res.text();
  const headers = mdHeaders(entry, body);
  const lastMod = res.headers.get("Last-Modified");
  if (lastMod) headers.set("Last-Modified", lastMod);
  return new Response(body, { headers });
}

function recordMd(record, kind) {
  // kind: "record" | "certificate" — fields exactly as the HTML page
  // renders them from /api/records / /api/certificate.
  const esc = (v) => (v == null ? "—" : String(v));
  const rows = kind === "record"
    ? [
        ["Record ID", `\`${esc(record.id)}\``],
        ["Title", esc(record.title)],
        ["Authors", esc(record.authors)],
        ["Version", esc(record.version)],
        ["Scholar wallet", record.scholar_wallet ? `\`${esc(record.scholar_wallet)}\`` : "—"],
        ["State", esc(record.state)],
        ["Anchor (Base hash)", record.anchor_tx
          ? `[${esc(record.anchor_tx)}](https://basescan.org/tx/${esc(record.anchor_tx)})`
          : "Pending — no confirmed anchor yet."],
        ["Anchor confirmations", record.anchor_confirmations != null
          ? `${esc(record.anchor_confirmations)} (required: 12)` : "Not recorded yet."],
        ["Document fingerprint", record.document_fingerprint
          ? `\`${esc(record.document_fingerprint)}\`` : "Not recorded yet."],
        ["Certificate", record.certificate_id
          ? `[${esc(record.certificate_id)}](${SITE_URL}/certificate?id=${encodeURIComponent(record.certificate_id)})`
          : "Not issued yet — a certificate is issued only after the anchor confirms."],
      ]
    : [
        ["Certificate ID", `\`${esc(record.certificate_id)}\``],
        ["Record ID", `\`${esc(record.record_id)}\``],
        ["Title", esc(record.title)],
        ["Version", esc(record.version)],
        ["Scholar", esc(record.scholar)],
        ["Scholar wallet", record.scholar_wallet ? `\`${esc(record.scholar_wallet)}\`` : "—"],
        ["Verdict", esc(record.verdict)],
        ["Payment transaction", record.payment_transaction
          ? `\`${esc(record.payment_transaction)}\`` : "—"],
        ["Base anchor transaction", record.anchor_transaction
          ? `[${esc(record.anchor_transaction)}](${esc(record.basescan_url)})`
          : "—"],
        ["Anchor confirmations", `${esc(record.anchor_confirmations)} (required: 12)`],
        ["Document fingerprint", record.document_fingerprint
          ? `\`${esc(record.document_fingerprint)}\`` : "—"],
      ];
  const title = kind === "record"
    ? (record.title || record.id) : `SpinWave Certificate — ${esc(record.title || record.record_id)}`;
  const canonical = kind === "record"
    ? `${SITE_URL}/records?id=${encodeURIComponent(record.id)}`
    : `${SITE_URL}/certificate?id=${encodeURIComponent(record.certificate_id || record.record_id)}`;
  const lines = [
    `# ${title}`, "",
    kind === "record"
      ? "> A validated SpinWave record, with its pipeline state and, once confirmed, its Base anchor."
      : "> A SpinWave certificate, rendered from its canonical JSON.",
    "",
    `Canonical: ${canonical}`,
    `Last updated: ${new Date().toISOString().slice(0, 10)}`, "",
    "## At a glance", "",
    "| Fact | Detail |", "|---|---|",
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    "",
    kind === "record"
      ? "A record is certified only when its anchor has confirmed on Base."
      : "A certificate verifies only with a confirmed anchor (12 or more Base confirmations).",
    "",
    "## Related", "",
    `- [Record — SpinWave](${SITE_URL}/records.html)`,
    `- [Certificate — SpinWave](${SITE_URL}/certificate.html)`,
    `- [Trust Center — SpinWave](${SITE_URL}/trust.html)`,
    "",
  ];
  return { body: lines.join("\n"), canonical };
}

async function dynamicMd(context, entry, url) {
  const id = url.searchParams.get("id") || url.searchParams.get("certificate") || "";
  if (!id) return staticMd(context, entry); // generic template page
  const kind = entry.md === "/records.md" ? "record" : "certificate";
  const apiPath = kind === "record"
    ? `/api/records?id=${encodeURIComponent(id)}`
    : `/api/certificate?id=${encodeURIComponent(id)}`;
  let apiRes;
  try {
    apiRes = await fetch(new URL(apiPath, url), {
      headers: { [INTERNAL]: "1" },
    });
  } catch {
    return mdResponse(entry,
      `# ${entry.title}\n\n> ${entry.description}\n\n` +
      `Canonical: ${entry.canonical}\n\n` +
      `The record could not be loaded right now. Try the HTML page: ` +
      `[${entry.title}](${entry.canonical}).\n`, 502);
  }
  const data = await apiRes.json().catch(() => null);
  if (!data) return md404(url.pathname);
  if (kind === "record") {
    if (apiRes.status === 404 || data.error === "not_found" || !data.record) {
      // A 5xx / not_configured from /api/records is not a "not found":
      // say so (502) instead of misreporting it as a missing record.
      if (!apiRes.ok && apiRes.status !== 404) {
        return mdResponse(entry,
          `# ${entry.title}\n\n> ${entry.description}\n\n` +
          `Canonical: ${entry.canonical}\n\n` +
          `The record could not be loaded right now (the record service ` +
          `is unavailable). Try the HTML page: ` +
          `[${entry.title}](${entry.canonical}).\n`, 502);
      }
      return md404(url.pathname);
    }
    const { body, canonical } = recordMd(data.record, "record");
    return mdResponse({ ...entry, canonical }, body);
  }
  // certificate API: 404 / not_certified are JSON 200s with a status field
  if (!apiRes.ok) {
    if (apiRes.status === 404) return md404(url.pathname);
    return mdResponse(entry,
      `# ${entry.title}\n\n> ${entry.description}\n\n` +
      `Canonical: ${entry.canonical}\n\n` +
      `The certificate could not be loaded right now (the certificate ` +
      `service is unavailable). Try the HTML page: ` +
      `[${entry.title}](${entry.canonical}).\n`, 502);
  }
  if (data.status === "not_found" || data.error === "not_found") return md404(url.pathname);
  if (data.status === "not_certified") {
    const body =
      `# Not certified\n\n> This record is not certified with a confirmed anchor yet.\n\n` +
      `Canonical: ${entry.canonical}\n\n` +
      `Record \`${escId(id)}\` exists but is not certified. A certificate ` +
      `verifies only with a confirmed Base anchor (12 or more confirmations).\n`;
    return mdResponse({ ...entry, canonical: entry.canonical }, body, 200);
  }
  const { body, canonical } = recordMd(data, "certificate");
  return mdResponse({ ...entry, canonical }, body);
}

function escId(v) { return String(v).replace(/`/g, ""); }

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Internal asset/API fetches from this middleware go straight through.
  if (request.headers.get(INTERNAL)) return next();

  if (request.method === "OPTIONS" &&
      (path.endsWith(".md") || path.startsWith("/api/md/"))) {
    return corsPreflight();
  }

  // --- /api/md/_catalog
  if (path === "/api/md/_catalog") {
    const catalog = {
      site: SITE_URL,
      routes: Object.values(REGISTRY).map((e) => ({
        html: e.canonical, md: `${SITE_URL}${e.md}`,
        api: `${SITE_URL}/api/md/${e.md.slice(1, -3)}`,
        title: e.title, lastmod: e.lastmod,
      })),
    };
    return new Response(JSON.stringify(catalog, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // --- /api/md/<slug>
  if (path.startsWith("/api/md/")) {
    const slug = path.slice("/api/md/".length).replace(/\.md$/, "");
    const entry = REGISTRY[slug];
    if (!entry) return md404(path);
    if (request.method === "HEAD") {
      const res = entry.dynamic
        ? await dynamicMd(context, entry, url)
        : await staticMd(context, entry);
      return new Response(null, { status: res.status, headers: res.headers });
    }
    return entry.dynamic
      ? dynamicMd(context, entry, url)
      : staticMd(context, entry);
  }

  // --- .md suffix
  if (path.endsWith(".md")) {
    const entry = BY_MD.get(path);
    if (!entry) return md404(path);
    if (request.method === "HEAD") {
      const res = entry.dynamic
        ? await dynamicMd(context, entry, url)
        : await staticMd(context, entry);
      return new Response(null, { status: res.status, headers: res.headers });
    }
    return entry.dynamic
      ? dynamicMd(context, entry, url)
      : staticMd(context, entry);
  }

  // --- content negotiation on HTML routes
  const entry = BY_ROUTE.get(path);
  if (entry && prefersMarkdown(request)) {
    if (request.method === "HEAD") {
      const res = entry.dynamic
        ? await dynamicMd(context, entry, url)
        : await staticMd(context, entry);
      const headers = new Headers(res.headers);
      headers.set("Vary", "Accept");
      return new Response(null, { status: res.status, headers });
    }
    const res = entry.dynamic
      ? await dynamicMd(context, entry, url)
      : await staticMd(context, entry);
    const headers = new Headers(res.headers);
    headers.set("Vary", "Accept");
    return new Response(await res.text(), { status: res.status, headers });
  }

  // --- passthrough: advertise llms.txt / llms-full.txt / ai.txt on HTML
  const res = await next();
  const contentType = res.headers.get("Content-Type") || "";
  if (contentType.includes("text/html")) {
    const headers = new Headers(res.headers);
    headers.set("Link", DESCRIBEDBY);
    return new Response(res.body, { status: res.status, headers });
  }
  return res;
}
