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

  return { DOCS, BY_ID, LANGS, VERSION_RE, versionOf, outstanding, checkAcceptance, blockingOutstanding };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = LEGAL;
