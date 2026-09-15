/* ============================================================
   teamsheet.js — templates, and turning a line-up into a sheet.

   A TEMPLATE says what the form looks like: title, how many rows,
   which columns in which order, which staff rows, which two languages
   the labels are in. A coach can use a built-in one or make their own
   (a tournament that wants the cap colour, a friendly with no referee
   row). buildModel() fills a template from a team, a match and a line-up
   and hands SHEETDOC a layout model — it does no drawing itself.

   Built-ins, and why there are two:
   · sa-2025 — the CURRENT official Swiss Aquatics form
     (Formular_Off.Spielaufstellung.doc, saved 18.12.2025): 14 rows,
     licence number in the LAST and widest column, gender-inclusive
     "Trainer:in". 14 rows because WR-WB Art. 4 allows 14 players.
   · sa-classic — the older layout clubs still carry around (13 rows,
     licence number FIRST). It is what a real club sheet from 2023 looks
     like. Offered so a coach can match what their league still accepts;
     sa-2025 is the default because it is what is published now.

   Row n is cap n. The form has no cap-number column because the coach
   shows the player passes to the table in cap order (Reglement 5.1.1,
   Anhang 35) — so the line-up ORDER is the information.

   No federation logo, deliberately: Swiss Aquatics offers its logos to
   member clubs under a CD manual, with no grant for software that
   generates forms. A template can carry the club's own name instead.

   Labels are only official in German and French — there is no Italian
   form; Ticino clubs use the DE/FR one. IT and EN labels exist so a coach
   CAN build such a template, and are marked unofficial.
   ============================================================ */
const TEAMSHEET = (() => {

  /* Every label, per language. de/fr are copied from the official form, character for
     character (including "AssistantCoach" with no space — that is how the form spells it). */
  const LABELS = {
    title:      { de: 'OFFIZIELLE SPIELAUFSTELLUNG', fr: 'FEUILLE DE MATCH OFFICIELLE', it: 'DISTINTA UFFICIALE', en: 'OFFICIAL TEAM SHEET' },
    club:       { de: 'Verein', fr: 'Club', it: 'Società', en: 'Club' },
    league:     { de: 'Liga', fr: 'Ligue', it: 'Lega', en: 'League' },
    date:       { de: 'Datum', fr: 'Date', it: 'Data', en: 'Date' },
    opponent:   { de: 'Gegner', fr: 'Adversaire', it: 'Avversario', en: 'Opponent' },
    venue:      { de: 'Spielort', fr: 'Lieu', it: 'Luogo', en: 'Venue' },
    matchNo:    { de: 'Spielnummer', fr: 'No de match', it: 'N. partita', en: 'Match no.' },
    capColour:  { de: 'Kappenfarbe', fr: 'Couleur des bonnets', it: 'Colore calottine', en: 'Cap colour' },
    nr:         { de: '', fr: '', it: '', en: '' },
    licence:    { de: 'Lizenznummer', fr: 'No de Licence', it: 'N. di licenza', en: 'Licence no.' },
    name:       { de: 'Name', fr: 'Nom', it: 'Cognome', en: 'Surname' },
    firstName:  { de: 'Vorname', fr: 'Prénom', it: 'Nome', en: 'First name' },
    birthYear:  { de: 'Jahrgang', fr: 'Année', it: 'Anno', en: 'Born' },
    gk:         { de: 'TH', fr: 'GB', it: 'P', en: 'GK' },
    coach:      { de: 'Coach/Trainer:in', fr: 'Coach/entraîneur', it: 'Allenatore/trice', en: 'Coach' },
    assistant1: { de: 'Betreuer:in Coach', fr: 'AssistantCoach', it: 'Assistente allenatore', en: 'Assistant coach' },
    assistant2: { de: 'Betreuer:in 2', fr: 'Assistant2', it: 'Assistente 2', en: 'Assistant 2' },
    captain:    { de: 'Captain', fr: 'Captain', it: 'Capitano', en: 'Captain' },
    referee:    { de: 'Schiedsrichter:in', fr: 'Arbitre', it: 'Arbitro', en: 'Referee' },
    signature:  { de: 'Unterschrift', fr: 'Signature', it: 'Firma', en: 'Signature' },
    noteLead:   { de: 'Wichtig:', fr: 'Important:', it: 'Importante:', en: 'Important:' },
    noteText:   { de: 'Dieses Formular muss vor dem Spiel am Kampfrichtertisch abgegeben werden.',
                  fr: 'Ce formulaire doit être laissé avant le match à la table des juges.',
                  it: 'Questo modulo deve essere consegnato al tavolo della giuria prima della partita.',
                  en: 'This form must be handed in at the officials’ table before the match.' },
  };
  // the older form, as clubs still carry it: no ":in"
  const CLASSIC_LABELS = { coach: { de: 'Coach/Trainer' }, assistant1: { de: 'Betreuer Coach' }, assistant2: { de: 'Betreuer 2' }, referee: { de: 'Schiedsrichter' } };

  const OFFICIAL_LANGS = ['de', 'fr'];
  const COLUMN_KEYS = ['nr', 'licence', 'name', 'firstName', 'birthYear', 'gk'];
  const HEADER_KEYS = ['club', 'league', 'date', 'opponent', 'venue', 'matchNo', 'capColour'];
  const STAFF_KEYS = ['coach', 'assistant1', 'assistant2', 'captain', 'referee'];

  const BUILTIN = [
    { id: 'sa-2025', builtin: true, name: 'Swiss Aquatics — official form (2025)', labelSet: 'official',
      langs: ['de', 'fr'], rows: 14,
      header: ['club', 'league', 'date'],
      columns: [{ key: 'nr', w: 0.07 }, { key: 'name', w: 0.28 }, { key: 'firstName', w: 0.28 }, { key: 'licence', w: 0.37 }],
      staff: ['coach', 'assistant1', 'assistant2', 'captain', 'referee'], note: true },
    { id: 'sa-classic', builtin: true, name: 'Classic layout — licence number first', labelSet: 'classic',
      langs: ['de', 'fr'], rows: 13,
      header: ['club', 'league', 'date'],
      columns: [{ key: 'nr', w: 0.064 }, { key: 'licence', w: 0.217 }, { key: 'name', w: 0.25 }, { key: 'firstName', w: 0.469 }],
      staff: ['coach', 'assistant1', 'assistant2', 'captain', 'referee'], note: true },
  ];

  const clampInt = (v, lo, hi, dflt) => { const n = Math.round(+v); return isNaN(n) ? dflt : Math.min(hi, Math.max(lo, n)); };

  /* Normalise anything a coach saved (or an old version saved) into a template that renders.
     Unknown keys are dropped, widths are re-scaled to fill the page, and nothing throws: a
     malformed template must not stand between a coach and a match. */
  function normalizeTemplate(t) {
    const src = t || {};
    const langs = (Array.isArray(src.langs) ? src.langs : OFFICIAL_LANGS).filter(l => LABELS.club[l]).slice(0, 2);
    let columns = (Array.isArray(src.columns) ? src.columns : BUILTIN[0].columns)
      .map(c => (typeof c === 'string' ? { key: c } : c))
      .filter(c => c && COLUMN_KEYS.includes(c.key))
      .filter((c, i, a) => a.findIndex(x => x.key === c.key) === i);
    if (!columns.some(c => c.key === 'licence')) columns.push({ key: 'licence', w: 0.3 });   // the one column the form cannot do without
    const DEFAULT_W = { nr: 0.07, licence: 0.25, name: 0.26, firstName: 0.26, birthYear: 0.1, gk: 0.06 };
    columns = columns.map(c => ({ key: c.key, w: +c.w > 0 ? +c.w : DEFAULT_W[c.key] }));
    const sum = columns.reduce((n, c) => n + c.w, 0);
    columns = columns.map(c => ({ key: c.key, w: c.w / sum }));
    return {
      id: String(src.id || ''), builtin: !!src.builtin, name: String(src.name || 'Template').slice(0, 80),
      labelSet: src.labelSet === 'classic' ? 'classic' : 'official',
      title: src.title != null ? String(src.title).slice(0, 80) : null,
      langs: langs.length ? (langs.length === 1 ? [langs[0], ''] : langs) : OFFICIAL_LANGS,
      rows: clampInt(src.rows, 1, 30, 14),
      header: (Array.isArray(src.header) ? src.header : BUILTIN[0].header).filter(k => HEADER_KEYS.includes(k)),
      columns,
      staff: (Array.isArray(src.staff) ? src.staff : STAFF_KEYS).filter(k => STAFF_KEYS.includes(k)),
      note: src.note !== false,
    };
  }

  /* A copy the coach can edit. Built-ins are never modified in place. */
  function cloneTemplate(t, newId, name) {
    const n = normalizeTemplate(t);
    return Object.assign(n, { id: newId, builtin: false, name: name || (n.name + ' (copy)') });
  }

  const label = (key, langs, set) => {
    const pick = l => (set === 'classic' && CLASSIC_LABELS[key] && CLASSIC_LABELS[key][l]) || (LABELS[key] && LABELS[key][l]) || '';
    return [pick(langs[0]), langs[1] ? pick(langs[1]) : ''];
  };
  const isOfficial = tpl => tpl.langs.every(l => !l || OFFICIAL_LANGS.includes(l));

  const pad2 = n => String(n).padStart(2, '0');
  function swissDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || '');
  }

  /* buildModel(template, { club, team, match, lineup, staff }) → SHEETDOC model.
     lineup rows are players in CAP order; empty rows up to template.rows stay empty on the
     form, because the official sheet always shows all of its rows. */
  function buildModel(template, data) {
    const tpl = normalizeTemplate(template);
    const d = data || {};
    const team = d.team || {}, match = d.match || {}, staff = d.staff || team.staff || {};
    const lineup = (d.lineup || []).slice(0, tpl.rows);
    const L = key => label(key, tpl.langs, tpl.labelSet);

    const headerValue = {
      club: d.club || team.club || '',
      league: match.league || team.leagueLabel || team.name || '',
      date: swissDate(match.date),
      opponent: match.opponent || '',
      venue: match.venue || '',
      matchNo: match.matchNo || '',
      capColour: match.capColour || '',
    };
    const cellOf = (p, key, i) => {
      if (key === 'nr') return String(i + 1);
      if (!p) return '';
      if (key === 'gk') return p.gk ? 'X' : '';     // not ✓: WinAnsi has no tick, the PDF would print '?'
      return String(p[key] == null ? '' : p[key]);
    };
    const captainIdx = lineup.findIndex(p => p && p.captain);
    const captain = captainIdx >= 0 ? lineup[captainIdx] : null;
    const staffValue = {
      coach: staff.coach || '', assistant1: staff.assistant1 || '', assistant2: staff.assistant2 || '',
      // the real form reads "Firstname Surname #" — the # is followed by the cap, which is the row
      captain: captain ? `${[captain.firstName, captain.name].filter(Boolean).join(' ')} #${captainIdx + 1}` : '',
      referee: staff.referee || '',
    };

    const titleLang = tpl.langs[0];
    const blocks = [];
    if (tpl.header.length) blocks.push({ type: 'fields', split: 0.3, rows: tpl.header.map(k => ({ label: L(k), value: headerValue[k] })) });
    blocks.push({
      type: 'roster',
      columns: tpl.columns.map(c => ({ label: L(c.key), w: c.w })),
      rows: Array.from({ length: tpl.rows }, (_, i) => tpl.columns.map(c => cellOf(lineup[i], c.key, i))),
    });
    if (tpl.staff.length) blocks.push({ type: 'signatures', rows: tpl.staff.map(k => ({ label: L(k), value: staffValue[k], sign: L('signature') })) });
    if (tpl.note) blocks.push({ type: 'note', lines: tpl.langs.filter(Boolean).map((l, i) => ({ lead: LABELS.noteLead[l], text: LABELS.noteText[l], italic: i > 0 })) });

    const title = tpl.title != null && tpl.title !== '' ? tpl.title : LABELS.title[titleLang];
    const docTitle = [LABELS.title.de === title ? 'Spielaufstellung' : title, headerValue.club, headerValue.league, headerValue.date].filter(Boolean).join(' – ');
    return { title, docTitle, blocks, official: isOfficial(tpl) };
  }

  /* A filename a club secretary can file without renaming it. */
  function fileName(data, ext) {
    const d = data || {}, t = d.team || {}, m = d.match || {};
    const clean = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const date = /^\d{4}-\d{2}-\d{2}/.test(String(m.date || '')) ? String(m.date).slice(0, 10).replace(/-/g, '') : '';
    return ['Spielaufstellung', clean(d.club || t.club), clean(m.league || t.name), date].filter(Boolean).join('_') + '.' + ext;
  }

  return { LABELS, BUILTIN, COLUMN_KEYS, HEADER_KEYS, STAFF_KEYS, OFFICIAL_LANGS,
           normalizeTemplate, cloneTemplate, buildModel, fileName, swissDate };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = TEAMSHEET;
