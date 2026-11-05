#!/usr/bin/env python3
"""Generate the AI-readable surface for spinwave.tech from the site itself.

Single source of truth: status.js (token facts) + the HTML pages (content)
+ the PAGES registry below (routes, descriptions, ai-summaries).

Outputs (all generated — do not hand-edit; re-run this script):
  <slug>.md for every public HTML page, llms.txt, llms-full.txt, ai.txt,
  sitemap.xml, robots.txt, _headers, functions/md-registry.js

Usage:  python3 scripts/generate-ai-files.py
Check:   python3 scripts/check-ai-files.py   (fails on drift)

No new dependencies: Python 3 standard library only.
"""
import html as htmlmod
import json
import re
import subprocess
import sys
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE_URL = "https://spinwave.tech"
SITE_NAME = "SpinWave"
SITE_DESC = (
    "SpinWave is the database and storage layer of the Glenride think tank. "
    "STANZA is its mode of data transfer, represented by monetary value or "
    "attested certificates, for recognizing scholars and licensing their "
    "work directly."
)
SITE_LOGO = f"{SITE_URL}/spinwave-fox-mark.jpg"
CONTACT = "Glenride team via the contact page at https://dvaughnhouse.com"
TODAY = date.today().isoformat()  # generation date for ai.txt / llms-full.txt

# slug, html file, description (llms.txt, factual), ai-summary (1-2 sentences)
PAGES = [
    {
        "slug": "index", "html": "index.html",
        "desc": "SpinWave — the database and storage layer of the Glenride "
                "think tank; STANZA is the mode of data transfer. The "
                "straight line through the paywall maze.",
        "ai_summary": "SpinWave is the database and storage layer of the "
                "Glenride think tank. STANZA is its mode of data transfer, "
                "represented by monetary value or attested certificates; "
                "the STANZA token is live on Base with 100 billion supply "
                "and no trades yet.",
        "related": ["token", "trust", "flow", "how"],
    },
    {
        "slug": "flow", "html": "flow.html",
        "desc": "Where the 100 billion STANZA sits today and how it will "
                "move, hop by hop.",
        "ai_summary": "Capital flow for STANZA: 100 billion minted October "
                "17, 2026; 85 billion in the Uniswap V4 pool paired with "
                "Wrapped TAO, 15 billion under creator vesting, and no "
                "trades since deployment. Scholar and reader flows are "
                "locked until Phases 1 and 2.",
        "related": ["token", "trust", "how"],
    },
    {
        "slug": "token", "html": "token.html",
        "desc": "STANZA exactly as it stands: live on Base, pool deployed, "
                "no trades yet.",
        "ai_summary": "STANZA is live on Base at contract "
                "0xf629f16ba91086e266accc417d10742f76207ba3, with 100 "
                "billion supply, 85 billion in the liquidity pool and 15 "
                "billion under creator vesting. No trade has ever executed, "
                "so there is no price.",
        "related": ["flow", "letter", "trust"],
    },
    {
        "slug": "trust", "html": "trust.html",
        "desc": "What is live, what is not, and what a pending recognition "
                "actually is. The SpinWave trust center.",
        "ai_summary": "The SpinWave trust center: what is live, what is "
                "not, and what a pending recognition actually is. Scholar "
                "recognition and reader licensing are locked until Phases 1 "
                "and 2; the STANZA token is live on Base with no trades yet.",
        "related": ["token", "flow", "how"],
    },
    {
        "slug": "how", "html": "how.html",
        "desc": "The frozen SpinWave mechanism: scholar upload, license "
                "tiers, reader access. What's being built next.",
        "ai_summary": "How SpinWave will work: scholars upload manuscripts "
                "and datasets, recognition is recorded as pending STANZA, "
                "and readers will pay STANZA to license work directly. The "
                "mechanism is decided, not built.",
        "related": ["trust", "flow", "token"],
    },
    {
        "slug": "letter", "html": "letter.html",
        "desc": "$SPIN is now STANZA. SpinWave is the database and storage "
                "layer of the Glenride think tank; STANZA is the mode of "
                "data transfer — both contracts, plainly stated.",
        "ai_summary": "$SPIN is now STANZA. SpinWave is the database and "
                "storage layer of the Glenride think tank; STANZA is the "
                "mode of data transfer. The STANZA contract is "
                "0xf629f16ba91086e266accc417d10742f76207ba3 on Base.",
        "related": ["token", "trust"],
    },
    {
        "slug": "certificate", "html": "certificate.html",
        "desc": "A SpinWave certificate, rendered from its canonical JSON. "
                "If this page and the JSON disagree, the JSON, the record, "
                "and the Base anchor win.",
        "ai_summary": "A SpinWave certificate, rendered from its canonical "
                "JSON. A certificate verifies only with a confirmed Base "
                "anchor (12 or more confirmations); if the page and the "
                "JSON disagree, the JSON, the record, and the anchor win.",
        "related": ["records", "trust"],
    },
    {
        "slug": "records", "html": "records.html",
        "desc": "A validated SpinWave record, with its pipeline state and, "
                "once confirmed, its Base anchor.",
        "ai_summary": "A validated SpinWave record, with its pipeline "
                "state and, once confirmed, its Base anchor. A record is "
                "certified only when its anchor has confirmed on Base.",
        "related": ["certificate", "trust"],
    },
    {
        "slug": "privacy", "html": "privacy.html",
        "desc": "What SpinWave collects (almost nothing) and what it does "
                "not. Plain language.",
        "ai_summary": "SpinWave is a static website with no accounts, no "
                "sign-ups, no analytics, and no advertising trackers. It "
                "collects almost nothing.",
        "related": ["terms", "trust"],
    },
    {
        "slug": "terms", "html": "terms.html",
        "desc": "What STANZA is, what it is not, and the responsibilities "
                "of using this site. Plain language.",
        "ai_summary": "STANZA is a utility token for recognizing scholars "
                "and licensing their work. It is not an investment, and "
                "SpinWave makes no promises about its value.",
        "related": ["privacy", "trust"],
    },
]

# Pages whose markdown is a template: the HTML page itself is rendered
# client-side from /api/records or /api/certificate for a given ?id=.
# Their .md files describe the page + the fields; the middleware renders
# a specific record/certificate when ?id= is given.
DYNAMIC = {"records", "certificate"}

EXCLUDED = ["/api/*", "/auth/*"]  # never in markdown / llms surfaces


def html_url(page):
    return SITE_URL + "/" if page["slug"] == "index" else f"{SITE_URL}/{page['html']}"


def md_url(page):
    return f"{SITE_URL}/{page['slug']}.md"


def git_lastmod(path):
    try:
        out = subprocess.check_output(
            ["git", "log", "-1", "--format=%cs", "--", str(path)],
            cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
        if out:
            return out
    except Exception:
        pass
    import os
    return date.fromtimestamp(os.path.getmtime(ROOT / path)).isoformat()


# ---------------------------------------------------------------- status.js
def load_status():
    """Parse status.js (trusted local file) for the token facts."""
    text = (ROOT / "status.js").read_text()
    # status.js is a small object-literal file; convert window.X = {...}
    # into JSON by extracting the literal and evaluating it as Python
    # after a light JS->JSON transform (keys unquoted, single quotes).
    def literal(name):
        m = re.search(rf"window\.{name}\s*=\s*(\{{.*?\n\}});",
                      text, re.S)
        if not m:
            m = re.search(rf"window\.{name}\s*=\s*(\[.*?\]);", text, re.S)
        raw = m.group(1)
        raw = re.sub(r"//[^\n]*", "", raw)          # strip comments
        raw = re.sub(r"(\w+):", r'"\1":', raw)      # quote keys
        raw = raw.replace("'", '"')
        raw = re.sub(r",\s*([}\]])", r"\1", raw)    # trailing commas
        return json.loads(raw)

    return {
        "status": literal("SPIN_STATUS"),
        "stanza": literal("STANZA_META"),
        "spin": literal("SPIN_META"),
    }


# ---------------------------------------------------------------- HTML tree
VOID = {"meta", "link", "br", "hr", "img", "input", "area", "base", "col",
        "embed", "source", "track", "wbr"}


class Node:
    def __init__(self, tag, attrs):
        self.tag = tag
        self.attrs = dict(attrs)
        self.children = []

    def text(self):
        return "".join(c.text() if isinstance(c, Node) else c
                       for c in self.children)

    def cls(self):
        return self.attrs.get("class", "")


class TreeParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("root", {})
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(Node(tag, attrs))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        if data:
            self.stack[-1].children.append(data)


def find(node, tag):
    out = []
    for c in node.children:
        if isinstance(c, Node):
            if c.tag == tag:
                out.append(c)
            out += find(c, tag)
    return out


def first(node, tag):
    found = find(node, tag)
    return found[0] if found else None


def clean_ws(s):
    return re.sub(r"\s+", " ", s).strip()


# ---------------------------------------------------------------- markdown
def abs_url(href, page):
    href = (href or "").strip()
    if not href or href.startswith(("#", "javascript:", "mailto:")):
        return None
    if href.startswith("http://") or href.startswith("https://"):
        return href
    if href.startswith("/"):
        return SITE_URL + href
    # relative link from a page at the site root
    return SITE_URL + "/" + href.lstrip("./")


def _inline_raw(node):
    """Raw inline text, whitespace preserved so words either side of
    <strong>/<code>/<a> do not glue together; cleaned once at the top."""
    if isinstance(node, str):
        return node
    if node.tag in ("script", "style", "button", "input", "select",
                    "textarea", "noscript", "svg", "img"):
        return ""
    if node.tag == "br":
        return " "
    if node.tag == "a":
        inner = clean_ws("".join(_inline_raw(c) for c in node.children))
        if not inner:
            return ""
        url = abs_url(node.attrs.get("href", ""), None)
        return f"[{inner}]({url})" if url else inner
    if node.tag == "code":
        return f"`{clean_ws(node.text())}`"
    if node.tag in ("strong", "b"):
        inner = clean_ws("".join(_inline_raw(c) for c in node.children))
        return f"**{inner}**" if inner else ""
    if node.tag in ("em", "i"):
        inner = clean_ws("".join(_inline_raw(c) for c in node.children))
        return f"*{inner}*" if inner else ""
    return "".join(_inline_raw(c) for c in node.children)


def inline(node):
    """Inline markdown for a node (text / a / code / strong / em / br…)."""
    return clean_ws(_inline_raw(node))


SKIP_TAGS = {"script", "style", "nav", "footer", "form", "button", "input",
             "select", "textarea", "noscript", "svg", "head", "title",
             "meta", "link", "img"}
DECORATIVE = {"❦", "✦", "✧", "·", "—"}


class Converter:
    def __init__(self, page):
        self.page = page
        self.lines = []
        self.last_heading = ""
        self.seen = set()

    def emit(self, line):
        line = clean_ws(line)
        if not line or line in DECORATIVE:
            return
        if line in ("Loading…", "Loading certificate…",
                    "Loading this record…"):
            return
        if line in self.seen and line.startswith("#"):
            return
        self.lines.append(line)

    def walk(self, node):
        if isinstance(node, str):
            txt = clean_ws(node)
            if txt and txt not in DECORATIVE:
                self.emit(txt)
            return
        tag = node.tag
        if tag in SKIP_TAGS:
            return
        if node.attrs.get("id") in ("dashboard", "notify"):
            return  # logged-in dashboard + signup form: never in markdown
        if "noprint" in node.cls() or "swipe-hint" in node.cls():
            return
        if tag == "a":
            txt = inline(node)
            if txt:
                self.emit(txt)
            return
        if tag in ("h1", "h2"):
            txt = inline(node)
            if txt:
                self.last_heading = txt
                self.emit(f"## {txt}")
            return
        if tag == "h3":
            txt = inline(node)
            if txt:
                self.emit(f"### {txt}")
            return
        if tag == "h4":
            txt = inline(node)
            if txt:
                self.emit(f"#### {txt}")
            return
        if tag == "p":
            txt = inline(node)
            if txt:
                self.emit(txt)
            return
        if tag in ("ul", "ol"):
            for c in node.children:
                if isinstance(c, Node) and c.tag == "li":
                    txt = inline(c)
                    if txt:
                        self.emit(f"- {txt}")
            return
        if tag == "li":
            txt = inline(node)
            if txt:
                self.emit(f"- {txt}")
            return
        if tag == "blockquote":
            txt = inline(node)
            if txt:
                self.emit(f"> {txt}")
            return
        if tag == "hr":
            self.emit("---")
            return
        if tag == "pre":
            self.emit("```\n" + clean_ws(node.text()) + "\n```")
            return
        if tag == "table":
            self.table(node)
            return
        if "fields" in node.cls().split():
            # Token page: the "STANZA — the current token" fields are
            # already the At a glance table above; don't repeat them.
            if (self.page["slug"] == "token"
                    and self.last_heading.startswith("STANZA — the current")):
                return
            rows = []
            for c in node.children:
                if isinstance(c, Node) and "field" in c.cls().split():
                    k = v = ""
                    for sub in c.children:
                        if isinstance(sub, Node) and "k" in sub.cls().split():
                            k = inline(sub)
                        if isinstance(sub, Node) and "v" in sub.cls().split():
                            v = inline(sub)
                    if k or v:
                        rows.append((k, v))
            if rows:
                self.lines.append("| Fact | Detail |")
                self.lines.append("|---|---|")
                for k, v in rows:
                    v = v.replace("|", "\\|")
                    self.lines.append(f"| {k} | {v} |")
            return
        if "field" in node.cls().split():
            k = v = ""
            for sub in node.children:
                if isinstance(sub, Node) and "k" in sub.cls().split():
                    k = inline(sub)
                if isinstance(sub, Node) and "v" in sub.cls().split():
                    v = inline(sub)
            if k or v:
                self.emit(f"**{k}:** {v}" if k else v)
            return
        if "warn" in node.cls().split():
            txt = inline(node)
            if txt:
                self.emit(f"> {txt}")
            return
        # generic container: recurse
        for c in node.children:
            self.walk(c)

    def table(self, node):
        rows = []
        for tr in find(node, "tr"):
            cells = [inline(c) for c in tr.children
                     if isinstance(c, Node) and c.tag in ("th", "td")]
            if cells:
                rows.append(cells)
        if not rows:
            return
        self.lines.append("| " + " | ".join(rows[0]) + " |")
        self.lines.append("|" + "---|" * len(rows[0]))
        for r in rows[1:]:
            self.lines.append("| " + " | ".join(r) + " |")


def at_a_glance(page, st):
    """Prompt 2 at-a-glance tables, from status.js / the API schemas."""
    s = st["stanza"]
    if page["slug"] == "token":
        rows = [
            ("Status", "Live — deployed and on-chain, as of October 19, 2026"),
            ("Contract (STANZA)",
             f"`{s['contract']}` ([View on Basescan]"
             f"(https://basescan.org/address/{s['contract']}))"),
            ("Network", "Base — and only Base"),
            ("Supply", f"{s['supply']} STANZA"),
            ("Launched", f"{s['launched']} via {s['launchRoute']}"),
            ("Liquidity pool", "85B STANZA, paired with Wrapped TAO"),
            ("Creator vesting", "15B STANZA, 1 year, 30-day cliff"),
            ("Trades to date", "None — no trade has ever executed"),
            ("Superseded token",
             f"$SPIN, `{st['spin']['contract']}`, launched "
             f"{st['spin']['launched']}, no trades ever"),
        ]
        out = ["## At a glance", "",
               "| Fact | Detail |", "|---|---|"]
        out += [f"| {k} | {v} |" for k, v in rows]
        out += ["",
                "Amounts are counted in STANZA, never in dollars.",
                "The address above is the only STANZA contract."]
        return out
    if page["slug"] == "records":
        rows = [
            ("Record ID", "The record's id, as in `/records?id=<id>`"),
            ("Title / Authors / Version", "From the validated record"),
            ("Scholar wallet", "The scholar's wallet, when recorded"),
            ("State", "Pipeline state, e.g. certified"),
            ("Anchor (Base hash)",
             "The Base anchor transaction, once confirmed"),
            ("Anchor confirmations", "12 required for certification"),
            ("Document fingerprint", "Recorded on transfer"),
            ("Certificate", "Issued only after the anchor confirms"),
        ]
        out = ["## At a glance", "",
               "A record is certified only when its anchor has confirmed "
               "on Base. An anchor shown as pending is not a certificate, "
               "and a record without a payment reference was never paid "
               "through this pipeline.", "",
               "| Field | What it means |", "|---|---|"]
        out += [f"| {k} | {v} |" for k, v in rows]
        return out
    if page["slug"] == "certificate":
        rows = [
            ("Certificate ID", "The certificate's id, as in "
             "`/certificate?id=<id>`"),
            ("Record ID", "The SpinWave record this certificate is for"),
            ("Title / Version", "From the certified record"),
            ("Scholar / Scholar wallet", "From the certified record"),
            ("Verdict", "The review verdict, when recorded"),
            ("Payment transaction", "The payment transaction, when recorded"),
            ("Base anchor transaction", "The confirmed Base anchor"),
            ("Anchor confirmations", "12 required; a certificate verifies "
             "only with a confirmed anchor"),
            ("Document fingerprint", "From the certified record"),
        ]
        out = ["## At a glance", "",
               "A certificate verifies only with a confirmed anchor (12 or "
               "more Base confirmations). If this page and the canonical "
               "JSON disagree, the JSON, the record, and the Base anchor "
               "win.", "",
               "| Field | What it means |", "|---|---|"]
        out += [f"| {k} | {v} |" for k, v in rows]
        return out
    return []


def page_markdown(page, st):
    src = (ROOT / page["html"]).read_text()
    parser = TreeParser()
    parser.feed(src)
    root = parser.root
    title_node = first(root, "title")
    title = clean_ws(title_node.text()) if title_node else page["slug"]
    meta_desc = ""
    for m in find(root, "meta"):
        if m.attrs.get("name") == "description":
            meta_desc = m.attrs.get("content", "")
    lastmod = git_lastmod(page["html"])

    main = first(root, "main")
    body = first(root, "body")
    # index.html: the hero lives in <header> outside <main>, and the
    # signed-in dashboard lives outside <main> too — use the whole body
    # and let the converter drop #dashboard / #notify / forms.
    source = body if page["slug"] == "index" else (main or body)

    conv = Converter(page)
    for c in source.children:
        conv.walk(c)
    # collapse repeats / blank runs
    body_lines, prev = [], None
    for ln in conv.lines:
        if ln == prev:
            continue
        body_lines.append(ln)
        prev = ln

    out = [f"# {title}", "", f"> {meta_desc or page['desc']}", "",
           f"Canonical: {html_url(page)}", f"Last updated: {lastmod}", ""]
    glance = at_a_glance(page, st)
    if glance:
        out += glance + [""]
    out += body_lines
    out += ["", "## Related", ""]
    by_slug = {p["slug"]: p for p in PAGES}
    for rel in page["related"]:
        r = by_slug[rel]
        # Title text is filled in by main() once all pages are parsed.
        out.append(f"- [{rel}]({html_url(r)})")
    return "\n".join(out) + "\n", title, meta_desc or page["desc"], lastmod


def main():
    st = load_status()
    pages_meta = []
    md_by_slug = {}
    for page in PAGES:
        md, title, desc, lastmod = page_markdown(page, st)
        # Related section: replace slug-title placeholders with real titles.
        md_by_slug[page["slug"]] = md
        pages_meta.append({**page, "title": title, "desc": desc,
                           "lastmod": lastmod, "md": md})
    # Fix Related links to use each related page's real <title>.
    titles = {p["slug"]: p["title"] for p in pages_meta}
    for p in pages_meta:
        lines = p["md"].split("\n")
        fixed = []
        in_related = False
        for ln in lines:
            if ln.startswith("## Related"):
                in_related = True
            if in_related and ln.startswith("- ["):
                m = re.match(r"- \[([^\]]+)\]\(([^)]+)\)", ln)
                if m:
                    slug = next((q["slug"] for q in PAGES
                                 if html_url(q) == m.group(2)), None)
                    if slug:
                        ln = f"- [{titles[slug]}]({m.group(2)})"
            fixed.append(ln)
        p["md"] = "\n".join(fixed) + "\n"
        (ROOT / f"{p['slug']}.md").write_text(p["md"])
        print(f"wrote {p['slug']}.md ({len(p['md'])} chars)")

    by_slug = {p["slug"]: p for p in pages_meta}
    core = ["index", "token", "flow", "trust", "how", "letter"]
    docs = ["certificate", "records"]
    legal = ["privacy", "terms"]

    def link_line(p):
        return f"- [{p['title']}]({md_url(p)}): {p['desc']}"

    llms = [f"# {SITE_NAME}", "", f"> {SITE_DESC}", "",
            "SpinWave is the database and storage layer of the Glenride "
            "think tank. STANZA is the mode of data transfer, represented "
            "by monetary value or attested certificates, for recognizing "
            "scholars and licensing their work directly. The STANZA token "
            f"is live on Base (contract "
            f"{st['stanza']['contract']}), launched "
            f"{st['stanza']['launched']} via Bankr, with a supply of "
            f"{st['stanza']['supply']} STANZA. No trade has ever executed. "
            "Scholar recognition opens in Phase 1; reader licensing opens "
            "in Phase 2. Contact: " + CONTACT + ".", "",
            "## Core pages", ""]
    llms += [link_line(by_slug[s]) for s in core] + ["", "## Token and trust", ""]
    llms += [link_line(by_slug[s]) for s in docs] + ["", "## Machine-readable", "",
            f"- [Full content]({SITE_URL}/llms-full.txt): every page concatenated",
            f"- [Markdown catalog]({SITE_URL}/api/md/_catalog)",
            f"- [Sitemap]({SITE_URL}/sitemap.xml)",
            f"- [AI usage policy]({SITE_URL}/ai.txt)", "",
            "## Cite this site for", "",
            f"- [Token status]({md_url(by_slug['token'])}#at-a-glance): "
            f"STANZA contract {st['stanza']['contract']} on Base, supply "
            f"{st['stanza']['supply']}, 85B in the liquidity pool, 15B "
            "under creator vesting, no trades ever executed.",
            f"- [Capital flow]({md_url(by_slug['flow'])}): 100 billion "
            "STANZA minted October 17, 2026; 85 billion in the Uniswap V4 "
            "pool, 15 billion under creator vesting.",
            f"- [Certificate]({md_url(by_slug['certificate'])}#at-a-glance): "
            "a certificate verifies only with a confirmed Base anchor "
            "(12 or more confirmations).", "",
            "## Optional", ""]
    llms += [link_line(by_slug[s]) for s in legal]
    llms_txt = "\n".join(llms) + "\n"
    (ROOT / "llms.txt").write_text(llms_txt)
    print(f"wrote llms.txt ({len(llms_txt)} chars)")

    full_parts = [f"# {SITE_NAME} - full content", "", f"> {SITE_DESC}", "",
                  f"Generated: {TODAY}", ""]
    for slug in core + docs + legal:
        p = by_slug[slug]
        full_parts += ["---", "",
                       f"<!-- source: {html_url(p)} -->", "",
                       p["md"].rstrip(), ""]
    full_txt = "\n".join(full_parts)
    if len(full_txt) > 500_000:
        print("WARNING: llms-full.txt exceeds 500k chars", file=sys.stderr)
    (ROOT / "llms-full.txt").write_text(full_txt)
    print(f"wrote llms-full.txt ({len(full_txt)} chars)")

    ai = f"""[identity]
name: {SITE_NAME}
url: {SITE_URL}
description: {SITE_DESC}
logo: {SITE_LOGO}
contact: {CONTACT}
llms: {SITE_URL}/llms.txt

[permissions]
allowed: summarise, quote with attribution, cite, index for search/answers

[restrictions]
no fabricated quotes
no fake reviews/ratings
no presenting our content as the model's own
no training on user-generated private data

[attribution]
Cite as: SpinWave — <canonical page URL, e.g. {SITE_URL}/token.html>

[scope]
included: {", ".join(html_url(p) for p in pages_meta)}
excluded: /api/*, /auth/*
# Keep in sync with /llms.txt and /robots.txt.

[contact]
{CONTACT}

Last updated: {TODAY}
"""
    (ROOT / "ai.txt").write_text(ai)
    print(f"wrote ai.txt ({len(ai)} chars)")

    prio = {"index": "1.0", "token": "0.8", "flow": "0.7", "trust": "0.7",
            "how": "0.6", "letter": "0.6", "certificate": "0.5",
            "records": "0.5", "privacy": "0.3", "terms": "0.3"}
    sm = ['<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for p in pages_meta:
        sm += ["  <url>", f"    <loc>{html_url(p)}</loc>",
               f"    <lastmod>{p['lastmod']}</lastmod>",
               f"    <priority>{prio[p['slug']]}</priority>", "  </url>"]
    sm.append("</urlset>")
    (ROOT / "sitemap.xml").write_text("\n".join(sm) + "\n")
    print("wrote sitemap.xml")

    robots = """# AI answer engines may read and cite this site's public pages.
# Training crawlers: not newly allowed or blocked here — they were already
# covered by the pre-existing "User-agent: *" Allow: / rule. Blocking them
# needs an explicit decision; see the implementation summary.
# Keep in sync with /llms.txt and /ai.txt.
User-agent: OAI-SearchBot
User-agent: ChatGPT-User
User-agent: Claude-SearchBot
User-agent: Claude-User
User-agent: PerplexityBot
User-agent: Perplexity-User
User-agent: meta-webindexer
User-agent: *
Allow: /
Disallow: /api/
Disallow: /auth/

Sitemap: https://spinwave.tech/sitemap.xml
"""
    (ROOT / "robots.txt").write_text(robots)
    print("wrote robots.txt")

    headers = """/llms.txt
  Content-Type: text/plain; charset=utf-8
  Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800
/llms-full.txt
  Content-Type: text/plain; charset=utf-8
  Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800
/ai.txt
  Content-Type: text/plain; charset=utf-8
  Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800
/sitemap.xml
  Content-Type: application/xml; charset=utf-8
  Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400
/robots.txt
  Content-Type: text/plain; charset=utf-8
  Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400
/*.md
  Content-Type: text/markdown; charset=utf-8
  X-Robots-Tag: noindex, follow
  Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400
  Access-Control-Allow-Origin: *
/api/md/*
  Content-Type: text/markdown; charset=utf-8
  X-Robots-Tag: noindex, follow
  Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400
  Access-Control-Allow-Origin: *
"""
    (ROOT / "_headers").write_text(headers)
    print("wrote _headers")

    registry = {
        p["slug"]: {
            "html": p["html"], "route": "/" if p["slug"] == "index"
                    else f"/{p['html']}",
            "clean_route": "/" if p["slug"] == "index"
                    else f"/{p['slug']}",
            "md": f"/{p['slug']}.md", "canonical": html_url(p),
            "title": p["title"], "description": p["desc"],
            "ai_summary": p["ai_summary"], "lastmod": p["lastmod"],
            "dynamic": p["slug"] in DYNAMIC,
        } for p in pages_meta
    }
    reg_js = ("// Generated by scripts/generate-ai-files.py — do not hand-edit.\n"
              "// Single source of truth for the markdown middleware.\n"
              f"export const SITE_URL = {json.dumps(SITE_URL)};\n"
              f"export const REGISTRY = {json.dumps(registry, indent=2)};\n")
    (ROOT / "functions" / "md-registry.js").write_text(reg_js)
    print("wrote functions/md-registry.js")


if __name__ == "__main__":
    main()
