/* ============================================================
   legal.js — what somebody agreed to, and how anyone could ever prove it.

   Shared by the app and the server the way js/teamsync.js is, so a rule cannot be enforced on one
   side and forgotten on the other.

   THE FIELD EVERYONE FORGETS IS THE VERSION. A tick-box that records "accepted: yes" is worth
   nothing the moment the document changes — which it will, because the first lawyer to read it
   will change it. The question a club, a parent or a court actually asks is "what did they agree
   to", and only the exact text answers that.

   SO A VERSION IS DERIVED FROM THE TEXT, NOT TYPED BY HAND. It is the date in the document's own
   front matter plus the first eight characters of its sha256. Edit a comma and the version moves
   on its own: there is no way to change a document and leave the version claiming otherwise, and
   no discipline for anybody to keep.

   WHO ACCEPTS WHAT IS NOT ONE ANSWER.
     · An ADMIN accepts for the CLUB — the terms and the data-processing agreement bind the club as
       a legal entity, not the person who happened to click.
     · A COACH or TRAINER accepts personally: they are told how the data they handle is used.
     · A PLAYER is often a CHILD, and a child's tick is not consent. The app does not pretend
       otherwise: it records nothing legally meaningful from them, shows them the privacy notice in
       their own language, and the CLUB warrants that a parent agreed. Where that warranty is
       recorded is the club's acceptance, which is why it names the documents it covers.
   ============================================================ */
const LEGAL = (() => {
  /* Each document, who it binds, and whether work stops until it is accepted.
     `blocking` is deliberately false for a changed document: a coach halfway through a season
     should be told, not locked out of their own team sheet on a Saturday. A brand-new club
     accepting for the first time is a different case and is handled at sign-up. */
  const DOCS = [
    { id: 'terms',        scope: 'club',      blocking: true,  title: 'Terms of Service' },
    { id: 'privacy',      scope: 'personal',  blocking: false, title: 'Privacy notice' },
    { id: 'dpa',          scope: 'club',      blocking: true,  title: 'Data Processing Agreement' },
    /* PUBLISHED, never accepted. A sub-processor list is a disclosure, not an agreement — asking a
       club to "accept" who our hosting provider is would be theatre, and it has to be able to
       change without putting every club into a re-acceptance it cannot refuse anyway. It gets its
       own document precisely so its version moves when it changes and nothing else's does. */
    { id: 'subprocessors', scope: 'published', blocking: false, title: 'Who else is involved' },
    { id: 'impressum',     scope: 'published', blocking: false, title: 'Who runs this' },
    /* Collected by the CLUB on paper or in its own system, never ticked in the app: consent to
       being filmed belongs to the person filmed, and for a younger child to their parent. The app
       publishes the template and records nothing, because recording a tick here would suggest a
       consent that was never actually given to us. */
    { id: 'consent',       scope: 'published', blocking: false, title: 'Filming and match video' },
  ];
  const BY_ID = Object.fromEntries(DOCS.map(d => [d.id, d]));
  const LANGS = ['en', 'de', 'fr', 'it'];
  const ID_RE = /^[a-z][a-z0-9-]{1,20}$/;
  const VERSION_RE = /^\d{4}-\d{2}-\d{2}\+[0-9a-f]{8}$/;

  /* the version IS the content: a date a human can say out loud, and eight characters that make
     it impossible for the text to change without the version changing with it */
  const versionOf = (date, sha256) => `${date}+${String(sha256 || '').slice(0, 8)}`;

  /* Which documents this person still owes, given what they have accepted. Returns the whole list
     with its state rather than a bare boolean, because "you must accept something" is not a thing
     anybody can act on. */
  function outstanding(role, current, accepted) {
    const mine = DOCS.filter(d => d.scope === 'published' ? false
      : d.scope === 'club' ? role === 'admin'
      : ['admin', 'coach', 'trainer'].includes(role));
    /* Every version of each document this person has accepted, not just one. Taking "the last one
       seen" made the answer depend on the order rows came back in — and they come back newest
       first, so the OLDEST acceptance won and a document that had just been re-accepted still
       read as stale. Membership of the set is order-independent and cannot go wrong that way. */
    const have = {};
    for (const a of accepted || []) {
      if (!a || !a.doc) continue;
      (have[a.doc] || (have[a.doc] = [])).push(String(a.version || ''));
    }
    return mine.map(d => {
      const want = (current || {})[d.id];
      const seen = have[d.id] || [];
      const onThis = !!(want && seen.includes(want));
      return {
        doc: d.id, scope: d.scope, blocking: d.blocking,
        version: want || null,
        accepted: seen.length > 0,
        // agreed to something, just not to this text
        stale: seen.length > 0 && !onThis,
        acceptedVersion: onThis ? want : (seen[0] || null),
      };
    }).filter(x => x.version);      // a document the deployment does not carry is not owed
  }

  /* Does this acceptance hold together? Checked on the way in, because a record that cannot be
     read back is not evidence of anything. */
  function checkAcceptance(a, current) {
    if (!a || typeof a !== 'object') return { ok: false, error: 'bad-acceptance' };
    if (!ID_RE.test(String(a.doc || '')) || !BY_ID[a.doc]) return { ok: false, error: 'unknown-document' };
    // a disclosure cannot be "accepted": recording agreement to a fact would be theatre
    if (BY_ID[a.doc].scope === 'published') return { ok: false, error: 'not-an-agreement' };
    if (!LANGS.includes(String(a.lang || ''))) return { ok: false, error: 'unknown-language' };
    if (!VERSION_RE.test(String(a.version || ''))) return { ok: false, error: 'bad-version' };
    // accepting a version this deployment does not serve means they read something else entirely
    const want = (current || {})[a.doc];
    if (!want) return { ok: false, error: 'document-not-published' };
    if (want !== a.version) return { ok: false, error: 'stale-version', current: want };
    return { ok: true, value: { doc: a.doc, lang: a.lang, version: a.version } };
  }

  const blockingOutstanding = list => (list || []).filter(x => x.blocking && (!x.accepted || x.stale));

  /* WHICH LANGUAGE A READER IS REALLY SHOWN. The version is derived from the ENGLISH text, so a
     translation is only the same document while it still translates the current English. When the
     English changes its version moves on, and a German text of last month's English would be a
     different document wearing this month's version. So a translation is used only while its
     `translates:` names the current version; until it catches up the reader gets English, and the
     server and the app both say so. One rule, here, so the app cannot show German while the
     server records English, or the other way round. */
  function pickLang(entry, lang) {
    if (!entry || !entry.langs) return null;
    const t = entry.langs[lang];
    if (t && (lang === 'en' || t.translates === entry.version)) return lang;
    return entry.langs.en ? 'en' : null;
  }

  /* A document on disk is Markdown with a few lines of front matter (date, status, and for a
     translation, which English version it translates). */
  function parse(md) {
    const s = String(md == null ? '' : md).replace(/\r\n?/g, '\n');
    const m = /^---\n([\s\S]*?)\n---\n/.exec(s);
    const meta = {};
    if (m) m[1].split('\n').forEach(line => { const kv = /^([a-z][a-z0-9_-]*):\s*(.*)$/.exec(line); if (kv) meta[kv[1]] = kv[2].trim(); });
    return { meta, body: m ? s.slice(m[0].length) : s };
  }

  /* THE RENDERER. These texts are shown to parents and bind clubs, so they are rendered by one
     small function that EVERY reader goes through, and it trusts nothing: the text is escaped
     first and only a closed set of Markdown is recognised afterwards — headings, paragraphs,
     lists, tables, rules, bold, italic, code, and links to http(s) or mailto. Raw HTML in a
     document comes out as visible text, never as markup, so a document edited carelessly (or by
     someone else) cannot put a script or a form in front of a reader. */
  const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function inline(t) {
    return esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, text, url) => /^(https?:\/\/|mailto:)/i.test(url)
        ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>` : text);
  }
  function render(md) {
    const { meta, body } = parse(md);
    const lines = body.split('\n');
    const out = [];
    let para = [], list = null;      // list = { tag, items: [string] }
    const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.tag}>` + list.items.map(i => '<li>' + inline(i) + '</li>').join('') + `</${list.tag}>`); list = null; } };
    const flush = () => { flushPara(); flushList(); };
    const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) { flush(); continue; }
      let m;
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { flush(); const n = m[1].length; out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
      if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        flush();
        const head = cells(line); i++;
        const rows = [];
        while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) { i++; rows.push(cells(lines[i])); }
        out.push('<div class="legal-table"><table><thead><tr>' + head.map(h => '<th>' + inline(h) + '</th>').join('') + '</tr></thead><tbody>'
          + rows.map(r => '<tr>' + head.map((_, k) => '<td>' + inline(r[k] || '') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
        continue;
      }
      if ((m = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(line))) {
        flushPara();
        const tag = /\d/.test(m[1]) ? 'ol' : 'ul';
        if (list && list.tag !== tag) flushList();
        if (!list) list = { tag, items: [] };
        list.items.push(m[2]);
        continue;
      }
      // an indented line under a list item continues that item; anything else is running text
      if (list && /^\s+\S/.test(line)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; }
      flushList();
      para.push(line.trim());
    }
    flush();
    return { meta, html: out.join('\n') };
  }

  return { DOCS, BY_ID, LANGS, VERSION_RE, versionOf, outstanding, checkAcceptance, blockingOutstanding, pickLang, parse, render };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = LEGAL;
