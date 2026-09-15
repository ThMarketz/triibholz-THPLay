/* ============================================================
   teams.js — a coach's teams, rosters, templates and team sheets.

   A coach runs several teams (U10…U18, NLA/NLB, Regionalliga, women's
   leagues, the Swiss-only Swiss Trophy). Each has a roster of licensed
   players, a sheet template and staff; for every match the coach builds
   the official line-up, checks it, and downloads it as Word or PDF.

   WHERE THE DATA LIVES — on this device, in localStorage, deliberately.
   A roster is licence numbers, names, birth years and eligibility status,
   much of it for minors, and the analysis backend has no authentication:
   anything stored there is readable by whoever knows a team code. So
   nothing here is sent to it. Player data comes from wpmatch.ch, which
   publishes it; `date` (a date of birth) is never fetched — see wpmatch.js.

   The pure parts live elsewhere and are tested there: SHEETDOC draws,
   TEAMSHEET lays out, ELIGIBILITY judges, WPMATCH fetches. This file is
   storage and screens.
   ============================================================ */
const TEAMS = (() => {
  const KEY = 'thplay.teams.v1';
  const T = (k, vars) => (typeof I18N !== 'undefined') ? I18N.t(k, vars) : k;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = p => p + Math.random().toString(36).slice(2, 10);

  /* The categories a coach picks from, in the order a club thinks about them. The id is the
     ELIGIBILITY preset; the label key says what the club calls it ("top division") next to
     the official name, because the two rarely match. */
  const CATEGORY_ORDER = ['U10', 'U12', 'U14', 'U14D', 'U16', 'U16D', 'U18', 'U18D', 'NLA', 'NLB', 'RL', 'NLD', 'PLD', 'ST', 'CUP', 'CUPD', 'CUSTOM'];

  /* ------------------------------------------------------------- storage */
  const blank = () => ({ version: 1, teams: [], players: {}, templates: [], sheets: [] });
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (!d || typeof d !== 'object') return blank();
      return { version: 1, teams: Array.isArray(d.teams) ? d.teams : [], players: d.players && typeof d.players === 'object' ? d.players : {},
               templates: Array.isArray(d.templates) ? d.templates : [], sheets: Array.isArray(d.sheets) ? d.sheets : [] };
    } catch (e) { return blank(); }
  }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); return true; } catch (e) { return false; } }

  /* ------------------------------------------------------------- pure helpers (tested) */
  const pidOf = p => p.licence ? 'L' + p.licence : p.pid;

  /* Merge players into the store. A licence number is the identity; a player without one
     (a new signing whose licence is pending) gets a local id until it arrives. wpmatch wins
     for what wpmatch knows (status, birth year); what the coach typed (a corrected name split,
     the goalkeeper flag) is kept. Returns the ids, in the order given. */
  function upsertPlayers(d, list, source) {
    const ids = [];
    (list || []).forEach(p => {
      if (!p) return;
      const pid = p.licence ? 'L' + p.licence : (p.pid || uid('m'));
      const prev = d.players[pid] || {};
      const fromWpm = source === 'wpmatch';
      d.players[pid] = {
        pid, licence: p.licence || prev.licence || '',
        name: prev.edited ? prev.name : (p.name || prev.name || ''),
        firstName: prev.edited ? prev.firstName : (p.firstName || prev.firstName || ''),
        nameGuessed: prev.edited ? false : !!p.nameGuessed,
        birthYear: (fromWpm ? p.birthYear : prev.birthYear) || p.birthYear || prev.birthYear || '',
        gender: (fromWpm ? p.gender : prev.gender) || p.gender || prev.gender || '',
        status: fromWpm ? (p.status || '') : (prev.status || p.status || ''),
        cap: p.cap || prev.cap || '',
        gk: prev.gk != null ? prev.gk : !!p.gk,
        wpId: p.wpId || prev.wpId || null,
        edited: !!prev.edited, source: fromWpm ? 'wpmatch' : (prev.source || source || 'manual'),
        checkedAt: fromWpm ? Date.now() : (prev.checkedAt || null),
      };
      ids.push(pid);
    });
    return ids;
  }

  const roster = (d, team) => (team.players || []).map(pid => d.players[pid]).filter(Boolean);

  /* Cap order for a fresh sheet: goalkeepers take the red caps — 1, and 13 for the substitute
     keeper (from 2026 in every category but U10–U14, where only cap 1 is red, so the second
     keeper just goes next) — and everyone else follows by their usual cap number, then name. */
  function autoOrder(players, rows, category) {
    const n = rows || 14;
    const youth = ['U10', 'U12', 'U14', 'U14D'].includes(category);
    const byCap = (a, b) => ((+a.cap || 99) - (+b.cap || 99)) || String(a.name).localeCompare(String(b.name));
    const gks = players.filter(p => p.gk).sort(byCap), field = players.filter(p => !p.gk).sort(byCap);
    const slots = new Array(n).fill(null);
    if (gks[0]) slots[0] = gks[0];
    if (gks[1]) { const i = !youth && n >= 13 ? 12 : 1; if (!slots[i]) slots[i] = gks[1]; else field.unshift(gks[1]); }
    gks.slice(2).forEach(g => field.push(g));
    let f = 0;
    for (let i = 0; i < n && f < field.length; i++) if (!slots[i]) slots[i] = field[f++];
    return slots;
  }

  const allTemplates = d => TEAMSHEET.BUILTIN.map(t => TEAMSHEET.normalizeTemplate(t))
    .concat((d.templates || []).map(t => TEAMSHEET.normalizeTemplate(t)));
  const templateById = (d, id) => allTemplates(d).find(t => t.id === id) || TEAMSHEET.normalizeTemplate(TEAMSHEET.BUILTIN[0]);

  /* A sheet's rows → the shape ELIGIBILITY and TEAMSHEET both read. */
  function lineupOf(d, sheet) {
    return (sheet.rows || []).map(r => {
      if (!r || !r.pid || !d.players[r.pid]) return null;
      const p = d.players[r.pid];
      return { licence: p.licence, name: p.name, firstName: p.firstName, birthYear: p.birthYear, gender: p.gender,
               status: p.status, gk: !!r.gk, captain: !!r.captain, younger: !!r.younger, pid: p.pid };
    });
  }

  /* ------------------------------------------------------------- screens */
  let root = null, ctx = {}, db = blank();
  const ui = { tab: 'teams', teamId: null, sheetId: null, tplId: null, busy: '', progress: '', notice: '' };

  function render(container, context) {
    root = container; ctx = context || {}; db = load();
    draw();
  }
  const persist = () => { if (!save(db)) toast(T('tm.saveFailed')); };
  const toast = m => (ctx.toast ? ctx.toast(m) : null);
  const team = () => db.teams.find(t => t.id === ui.teamId) || null;
  const sheet = () => db.sheets.find(s => s.id === ui.sheetId) || null;

  function draw() {
    if (!root) return;
    if (!ctx.canEdit) { root.innerHTML = `<div class="dash-wrap"><p class="muted">${T('tm.coachesOnly')}</p></div>`; return; }
    const t = team(), s = sheet();
    let body;
    if (s) body = drawSheet(s);
    else if (ui.tplId) body = drawTemplateEditor();
    else if (t) body = drawTeam(t);
    else body = ui.tab === 'templates' ? drawTemplates() : drawTeamList();
    root.innerHTML = `<div class="dash-wrap tm-wrap">${body}</div>`;
    wire();
  }

  const catLabel = id => T('tm.cat.' + id);
  const statusBadge = raw => {
    const s = ELIGIBILITY.statusOf(raw);
    const cls = { swiss: 'ok', ssn: 'ok', sse: 'mid', foreign: 'mid', inactive: 'bad', other: 'mid', unknown: 'none' }[s];
    return `<span class="tm-status tm-${cls}">${esc(T('tm.status.' + s))}</span>`;
  };

  /* ---------- team list */
  function drawTeamList() {
    const cards = db.teams.map(t => {
      const n = (t.players || []).length, last = db.sheets.filter(x => x.teamId === t.id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      return `<button class="tm-card" data-team="${esc(t.id)}">
        <strong>${esc(t.name)}</strong><span class="tag">${esc(catLabel(t.category))}</span>
        <span class="muted">${T('tm.nPlayers', { n })}${last ? ' · ' + T('tm.lastSheet', { date: esc(TEAMSHEET.swissDate(last.match && last.match.date)) }) : ''}</span></button>`;
    }).join('');
    return `<div class="dash-head"><div><h1>${T('tm.title')}</h1><p class="dash-sub">${T('tm.sub')}</p></div></div>
      ${tabs()}
      <div class="tm-actions"><button class="btn-primary sm" id="tm-new-team">${T('tm.newTeam')}</button></div>
      ${cards ? `<div class="tm-grid">${cards}</div>` : `<div class="film-panel"><p class="muted">${T('tm.noTeams')}</p></div>`}`;
  }
  const tabs = () => `<div class="tm-tabs">
      <button class="phase-btn ${ui.tab === 'teams' ? 'active' : ''}" data-tab="teams">${T('tm.tabTeams')}</button>
      <button class="phase-btn ${ui.tab === 'templates' ? 'active' : ''}" data-tab="templates">${T('tm.tabTemplates')}</button></div>`;

  /* ---------- one team: settings, roster, sheets */
  function drawTeam(t) {
    const rules = t.rules || {}, only = !!(rules.foreigners && rules.foreigners.onlySwiss);
    const tplOptions = allTemplates(db).map(x => `<option value="${esc(x.id)}" ${x.id === (t.templateId || 'sa-2025') ? 'selected' : ''}>${esc(x.builtin ? T('tm.tpl.' + x.id) : x.name)}</option>`).join('');
    const players = roster(db, t);
    const rows = players.map(p => `<tr>
        <td><input type="text" class="tm-cap" data-cap="${esc(p.pid)}" value="${esc(p.cap)}" inputmode="numeric" maxlength="2" aria-label="${T('tm.capNo')}"></td>
        <td>${p.licence ? esc(p.licence) : `<span class="tm-status tm-bad">${T('tm.noLicence')}</span>`}</td>
        <td><input type="text" data-pname="${esc(p.pid)}" value="${esc(p.name)}" aria-label="${T('tm.surname')}">${p.nameGuessed ? `<span class="tm-guess" title="${T('tm.nameGuessedTip')}">?</span>` : ''}</td>
        <td><input type="text" data-pfirst="${esc(p.pid)}" value="${esc(p.firstName)}" aria-label="${T('tm.firstName')}"></td>
        <td>${esc(p.birthYear) || '—'}</td>
        <td>${statusBadge(p.status)}</td>
        <td><label class="fa-check"><input type="checkbox" data-pgk="${esc(p.pid)}" ${p.gk ? 'checked' : ''}> GK</label></td>
        <td><button class="btn-ghost xs" data-premove="${esc(p.pid)}" title="${T('tm.removeFromTeam')}">✕</button></td></tr>`).join('');
    const sheets = db.sheets.filter(x => x.teamId === t.id).sort((a, b) => (b.match.date || '').localeCompare(a.match.date || ''));
    return `<div class="tm-crumbs"><button class="btn-ghost sm" id="tm-back">◀ ${T('tm.allTeams')}</button></div>
      <div class="dash-head"><div><h1>${esc(t.name)}</h1><p class="dash-sub">${esc(catLabel(t.category))}</p></div></div>

      <details class="film-panel" ${players.length ? '' : 'open'}><summary><h3>${T('tm.settings')}</h3></summary>
        <div class="tm-form">
          <label>${T('tm.teamName')}<input type="text" id="tm-name" value="${esc(t.name)}" maxlength="60"></label>
          <label>${T('tm.category')}<select id="tm-cat">${CATEGORY_ORDER.map(c => `<option value="${c}" ${c === t.category ? 'selected' : ''}>${esc(catLabel(c))}</option>`).join('')}</select></label>
          <label>${T('tm.club')}<input type="text" id="tm-club" value="${esc(t.club)}" maxlength="60"></label>
          <label>${T('tm.leagueOnSheet')}<input type="text" id="tm-league" value="${esc(t.leagueLabel)}" maxlength="60" placeholder="${T('tm.leagueOnSheetPh')}"></label>
          <label>${T('tm.template')}<select id="tm-tpl">${tplOptions}</select></label>
          <label>${T('tm.coach')}<input type="text" id="tm-coach" value="${esc((t.staff || {}).coach)}" maxlength="60"></label>
          <label>${T('tm.assistant1')}<input type="text" id="tm-a1" value="${esc((t.staff || {}).assistant1)}" maxlength="60"></label>
          <label>${T('tm.assistant2')}<input type="text" id="tm-a2" value="${esc((t.staff || {}).assistant2)}" maxlength="60"></label>
        </div>
        <div class="tm-special">
          <label class="fa-check"><input type="checkbox" id="tm-onlyswiss" ${only ? 'checked' : ''}> ${T('tm.onlySwiss')}</label>
          <p class="fa-note">${T('tm.onlySwissNote')}</p>
        </div>
        <div class="tm-wpm">${t.wpmatch ? `${T('tm.linkedTo', { name: esc(t.wpmatch.name) })} <button class="btn-ghost xs" id="tm-unlink">${T('tm.unlink')}</button>`
          : `<input type="text" id="tm-wpm-q" placeholder="${T('tm.findOnWpmatchPh')}"> <button class="btn-ghost sm" id="tm-wpm-search">${T('tm.findOnWpmatch')}</button><div id="tm-wpm-hits"></div>`}</div>
        <div class="tm-actions"><button class="btn-primary sm" id="tm-save-team">${T('tm.saveTeam')}</button>
          <button class="btn-ghost sm danger" id="tm-delete-team">${T('tm.deleteTeam')}</button></div>
      </details>

      <div class="film-panel">
        <h3>${T('tm.roster')} <span class="rightbar-hint">${T('tm.nPlayers', { n: players.length })}</span></h3>
        <div class="tm-add">
          <label class="tm-lic">${T('tm.addByLicence')}<textarea id="tm-lic" rows="2" placeholder="${T('tm.addByLicencePh')}"></textarea></label>
          <div class="tm-add-btns">
            <button class="btn-primary sm" id="tm-lookup" ${ui.busy ? 'disabled' : ''}>${T('tm.lookup')}</button>
            ${t.wpmatch ? `<button class="btn-ghost sm" id="tm-crawl" ${ui.busy ? 'disabled' : ''}>${T('tm.findTeamPlayers')}</button>` : ''}
            <button class="btn-ghost sm" id="tm-manual">${T('tm.addManually')}</button>
          </div>
        </div>
        ${ui.progress ? `<p class="muted tm-progress">${esc(ui.progress)}</p>` : ''}
        ${ui.notice ? `<p class="fa-note tm-notice">${ui.notice}</p>` : ''}
        ${players.length ? `<div class="dev-table-wrap"><table class="dev-table tm-roster"><thead><tr>
            <th>${T('tm.capNo')}</th><th>${T('tm.licenceNo')}</th><th>${T('tm.surname')}</th><th>${T('tm.firstName')}</th><th>${T('tm.born')}</th><th>${T('tm.eligibility')}</th><th>GK</th><th></th>
          </tr></thead><tbody>${rows}</tbody></table></div>
          <p class="fa-note">${T('tm.rosterNote')}</p>` : `<p class="muted">${T('tm.emptyRoster')}</p>`}
      </div>

      <div class="film-panel">
        <h3>${T('tm.sheets')}</h3>
        <div class="tm-actions"><button class="btn-primary" id="tm-new-sheet" ${players.length ? '' : 'disabled'}>${T('tm.newSheet')}</button></div>
        ${sheets.length ? `<div class="tm-sheet-list">${sheets.map(x => `<div class="tm-sheet-item">
            <button class="btn-ghost sm" data-sheet="${esc(x.id)}"><strong>${esc(TEAMSHEET.swissDate(x.match.date)) || T('tm.noDate')}</strong> ${x.match.opponent ? '· ' + esc(x.match.opponent) : ''}</button>
            <button class="btn-ghost xs" data-copysheet="${esc(x.id)}" title="${T('tm.copyForNextTip')}">${T('tm.copyForNext')}</button>
            <button class="btn-ghost xs" data-delsheet="${esc(x.id)}" title="${T('tm.deleteSheet')}">✕</button></div>`).join('')}</div>`
          : `<p class="muted">${T('tm.noSheets')}</p>`}
      </div>`;
  }

  /* ---------- the sheet builder */
  function drawSheet(s) {
    const t = db.teams.find(x => x.id === s.teamId) || {};
    const tpl = templateById(db, s.templateId);
    while (s.rows.length < tpl.rows) s.rows.push(null);
    const players = roster(db, t);
    const lineup = lineupOf(db, s).slice(0, tpl.rows);
    const filled = lineup.filter(Boolean);
    const staff = Object.assign({}, t.staff || {}, s.staff || {});
    const result = ELIGIBILITY.check(t, filled, { date: s.match.date });
    const used = new Set(s.rows.slice(0, tpl.rows).filter(r => r && r.pid).map(r => r.pid));
    const youth = ELIGIBILITY.CATEGORIES[t.category] && ELIGIBILITY.CATEGORIES[t.category].kind === 'youth';

    const opt = (p, row) => `<option value="${esc(p.pid)}" ${row && row.pid === p.pid ? 'selected' : ''} ${used.has(p.pid) && !(row && row.pid === p.pid) ? 'disabled' : ''}>` +
      `${esc([p.name, p.firstName].filter(Boolean).join(' '))}${p.licence ? ' · ' + esc(p.licence) : ''}${p.birthYear ? ' · ' + esc(p.birthYear) : ''}</option>`;
    const rowHtml = s.rows.slice(0, tpl.rows).map((r, i) => `<tr class="${r && r.pid ? '' : 'tm-empty'}">
        <td class="tm-capcell">${i + 1}</td>
        <td><select data-row="${i}"><option value="">—</option>${players.map(p => opt(p, r)).join('')}</select></td>
        <td><label class="fa-check"><input type="checkbox" data-rowgk="${i}" ${r && r.gk ? 'checked' : ''} ${r && r.pid ? '' : 'disabled'}> GK</label></td>
        <td><label class="fa-check"><input type="radio" name="tm-captain" data-rowcap="${i}" ${r && r.captain ? 'checked' : ''} ${r && r.pid ? '' : 'disabled'}> C</label></td>
        ${youth ? `<td><label class="fa-check" title="${T('tm.youngerTip')}"><input type="checkbox" data-rowyoung="${i}" ${r && r.younger ? 'checked' : ''} ${r && r.pid ? '' : 'disabled'}> ${T('tm.younger')}</label></td>` : ''}
        <td class="tm-move"><button class="btn-ghost xs" data-up="${i}" ${i ? '' : 'disabled'} aria-label="${T('tm.moveUp')}">↑</button><button class="btn-ghost xs" data-down="${i}" ${i < tpl.rows - 1 ? '' : 'disabled'} aria-label="${T('tm.moveDown')}">↓</button></td>
      </tr>`).join('');

    const name = lic => { const p = filled.find(x => x.licence === lic || x.name === lic); return p ? [p.firstName, p.name].filter(Boolean).join(' ') : lic; };
    const findings = result.findings.map(f => `<li class="tm-f tm-f-${f.severity}">
        <span class="tm-f-sev">${T('tm.sev.' + f.severity)}</span> ${T('tm.f.' + f.code, Object.assign({}, f.vars, { names: esc(f.players.map(name).join(', ')) }))}
        ${f.article ? `<span class="tm-f-art">${esc(f.article)}</span>` : ''}</li>`).join('');

    const tplOptions = allTemplates(db).map(x => `<option value="${esc(x.id)}" ${x.id === tpl.id ? 'selected' : ''}>${esc(x.builtin ? T('tm.tpl.' + x.id) : x.name)}</option>`).join('');
    const model = TEAMSHEET.buildModel(tpl, { club: t.club, team: { name: t.leagueLabel || catLabel(t.category), staff }, match: s.match, lineup, staff });

    return `<div class="tm-crumbs"><button class="btn-ghost sm" id="tm-sheet-back">◀ ${esc(t.name || T('tm.allTeams'))}</button></div>
      <div class="dash-head"><div><h1>${T('tm.sheetTitle')}</h1><p class="dash-sub">${esc(t.name)} · ${T('tm.season', { season: esc(result.season.label) })}</p></div></div>

      <div class="film-panel">
        <h3>${T('tm.match')}</h3>
        <div class="tm-form">
          <label>${T('tm.date')}<input type="date" id="tm-m-date" value="${esc(s.match.date)}"></label>
          <label>${T('tm.league')}<input type="text" id="tm-m-league" value="${esc(s.match.league)}" placeholder="${esc(t.leagueLabel || catLabel(t.category))}" maxlength="60"></label>
          <label>${T('tm.opponent')}<input type="text" id="tm-m-opp" value="${esc(s.match.opponent)}" maxlength="60"></label>
          <label>${T('tm.template')}<select id="tm-s-tpl">${tplOptions}</select></label>
          <label>${T('tm.referee')}<input type="text" id="tm-s-ref" value="${esc(staff.referee)}" maxlength="60"></label>
        </div>
        ${t.wpmatch ? `<button class="btn-ghost sm" id="tm-fixtures" ${ui.busy ? 'disabled' : ''}>${T('tm.pickFixture')}</button><div id="tm-fixture-list"></div>` : ''}
      </div>

      <div class="tm-builder">
        <div class="film-panel">
          <h3>${T('tm.lineup')} <span class="rightbar-hint">${T('tm.lineupHint', { n: filled.length, max: tpl.rows })}</span></h3>
          <div class="tm-actions"><button class="btn-ghost sm" id="tm-auto">${T('tm.autoFill')}</button><button class="btn-ghost sm" id="tm-clear">${T('tm.clear')}</button></div>
          <div class="dev-table-wrap"><table class="dev-table tm-lineup"><tbody>${rowHtml}</tbody></table></div>
          <p class="fa-note">${T('tm.capOrderNote')}</p>
        </div>
        <div class="film-panel tm-check">
          <h3>${T('tm.check')}</h3>
          ${result.findings.length ? `<ul class="tm-findings">${findings}</ul>` : `<p class="tm-f tm-f-ok">${T('tm.allClear')}</p>`}
          <p class="fa-note">${T('tm.checkNote')}</p>
        </div>
      </div>

      <div class="film-panel">
        <h3>${T('tm.preview')}</h3>
        ${model.official ? '' : `<p class="fa-note">${T('tm.unofficialLangs')}</p>`}
        <div class="tm-preview">${SHEETDOC.toHtml(model)}</div>
        <div class="tm-actions tm-downloads">
          <button class="btn-primary" id="tm-dl-docx">${T('tm.downloadWord')}</button>
          <button class="btn-primary" id="tm-dl-pdf">${T('tm.downloadPdf')}</button>
          <button class="btn-ghost" id="tm-print">${T('tm.print')}</button>
        </div>
        <p class="fa-note" id="tm-dl-note"></p>
      </div>`;
  }

  /* ---------- templates */
  function drawTemplates() {
    const list = allTemplates(db).map(x => `<div class="tm-sheet-item">
        <strong>${esc(x.builtin ? T('tm.tpl.' + x.id) : x.name)}</strong>
        <span class="muted">${T('tm.tplSummary', { rows: x.rows, cols: x.columns.length, langs: x.langs.filter(Boolean).join('/').toUpperCase() })}</span>
        <button class="btn-ghost xs" data-tplcopy="${esc(x.id)}">${T('tm.duplicate')}</button>
        ${x.builtin ? '' : `<button class="btn-ghost xs" data-tpledit="${esc(x.id)}">${T('tm.edit')}</button><button class="btn-ghost xs" data-tpldel="${esc(x.id)}" title="${T('tm.deleteTemplate')}">✕</button>`}
      </div>`).join('');
    return `<div class="dash-head"><div><h1>${T('tm.title')}</h1><p class="dash-sub">${T('tm.templatesSub')}</p></div></div>
      ${tabs()}<div class="film-panel">${list}<p class="fa-note">${T('tm.templatesNote')}</p></div>`;
  }

  function drawTemplateEditor() {
    const raw = db.templates.find(x => x.id === ui.tplId);
    if (!raw) { ui.tplId = null; return drawTemplates(); }
    const tpl = TEAMSHEET.normalizeTemplate(raw);
    const langOpt = (sel, allowNone) => (allowNone ? `<option value="" ${!sel ? 'selected' : ''}>—</option>` : '') +
      ['de', 'fr', 'it', 'en'].map(l => `<option value="${l}" ${l === sel ? 'selected' : ''}>${l.toUpperCase()}</option>`).join('');
    const inCols = tpl.columns.map(c => c.key);
    const colRows = TEAMSHEET.COLUMN_KEYS.map(k => {
      const on = inCols.includes(k), c = tpl.columns.find(x => x.key === k);
      return `<tr><td><label class="fa-check"><input type="checkbox" data-tcol="${k}" ${on ? 'checked' : ''} ${k === 'licence' ? 'disabled' : ''}> ${T('tm.col.' + k)}</label></td>
        <td>${on ? `<input type="number" min="3" max="80" data-tcolw="${k}" value="${Math.round(c.w * 100)}" aria-label="${T('tm.width')}"> %` : ''}</td>
        <td>${on ? `<button class="btn-ghost xs" data-tcolup="${k}" aria-label="${T('tm.moveUp')}">↑</button><button class="btn-ghost xs" data-tcoldown="${k}" aria-label="${T('tm.moveDown')}">↓</button>` : ''}</td></tr>`;
    }).join('');
    const sample = { club: T('tm.sampleClub'), team: { name: 'U14', staff: { coach: T('tm.sampleCoach') } }, match: { date: '2026-10-04', league: 'U14' },
      lineup: [{ licence: '50001', name: 'Keller', firstName: 'Nina', birthYear: '2013', gk: true }, { licence: '50002', name: 'Brunner', firstName: 'Jonas', birthYear: '2014', captain: true }] };
    return `<div class="tm-crumbs"><button class="btn-ghost sm" id="tm-tpl-back">◀ ${T('tm.tabTemplates')}</button></div>
      <div class="dash-head"><div><h1>${esc(tpl.name)}</h1></div></div>
      <div class="tm-builder">
        <div class="film-panel">
          <div class="tm-form">
            <label>${T('tm.templateName')}<input type="text" id="tt-name" value="${esc(tpl.name)}" maxlength="80"></label>
            <label>${T('tm.sheetHeading')}<input type="text" id="tt-title" value="${esc(tpl.title == null ? '' : tpl.title)}" maxlength="80" placeholder="${esc(TEAMSHEET.LABELS.title[tpl.langs[0]] || '')}"></label>
            <label>${T('tm.rows')}<input type="number" id="tt-rows" min="1" max="30" value="${tpl.rows}"></label>
            <label>${T('tm.lang1')}<select id="tt-l1">${langOpt(tpl.langs[0])}</select></label>
            <label>${T('tm.lang2')}<select id="tt-l2">${langOpt(tpl.langs[1], true)}</select></label>
          </div>
          <h4>${T('tm.headerFields')}</h4>
          <div class="tm-checks">${TEAMSHEET.HEADER_KEYS.map(k => `<label class="fa-check"><input type="checkbox" data-thead="${k}" ${tpl.header.includes(k) ? 'checked' : ''}> ${T('tm.hdr.' + k)}</label>`).join('')}</div>
          <h4>${T('tm.columns')}</h4>
          <table class="dev-table"><tbody>${colRows}</tbody></table>
          <h4>${T('tm.staffRows')}</h4>
          <div class="tm-checks">${TEAMSHEET.STAFF_KEYS.map(k => `<label class="fa-check"><input type="checkbox" data-tstaff="${k}" ${tpl.staff.includes(k) ? 'checked' : ''}> ${T('tm.staff.' + k)}</label>`).join('')}</div>
          <label class="fa-check"><input type="checkbox" id="tt-note" ${tpl.note ? 'checked' : ''}> ${T('tm.includeNote')}</label>
        </div>
        <div class="film-panel"><h3>${T('tm.preview')}</h3>
          ${TEAMSHEET.buildModel(tpl, sample).official ? '' : `<p class="fa-note">${T('tm.unofficialLangs')}</p>`}
          <div class="tm-preview">${SHEETDOC.toHtml(TEAMSHEET.buildModel(tpl, sample))}</div></div>
      </div>`;
  }

  /* ------------------------------------------------------------- behaviour */
  const $ = sel => root.querySelector(sel);
  const $$ = sel => Array.from(root.querySelectorAll(sel));
  const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };

  function wire() {
    $$('[data-tab]').forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; draw(); });
    on('#tm-new-team', 'click', () => {
      const t = { id: uid('t'), name: T('tm.newTeamName'), category: 'U14', club: '', leagueLabel: '', templateId: 'sa-2025', staff: {}, rules: {}, players: [], wpmatch: null };
      db.teams.push(t); persist(); ui.teamId = t.id; ui.notice = ''; draw();
    });
    $$('[data-team]').forEach(b => b.onclick = () => { ui.teamId = b.dataset.team; ui.notice = ''; ui.progress = ''; draw(); });
    const t = team(), s = sheet();
    if (s) return wireSheet(s);
    if (ui.tplId) return wireTemplateEditor();
    if (t) return wireTeam(t);
    $$('[data-tplcopy]').forEach(b => b.onclick = () => {
      const src = allTemplates(db).find(x => x.id === b.dataset.tplcopy);
      const copy = TEAMSHEET.cloneTemplate(src, uid('tpl'), T('tm.copyOf', { name: src.builtin ? T('tm.tpl.' + src.id) : src.name }));
      db.templates.push(copy); persist(); ui.tplId = copy.id; draw();
    });
    $$('[data-tpledit]').forEach(b => b.onclick = () => { ui.tplId = b.dataset.tpledit; draw(); });
    $$('[data-tpldel]').forEach(b => b.onclick = () => {
      if (!confirm(T('tm.confirmDeleteTemplate'))) return;
      db.templates = db.templates.filter(x => x.id !== b.dataset.tpldel);
      db.teams.forEach(x => { if (x.templateId === b.dataset.tpldel) x.templateId = 'sa-2025'; });
      persist(); draw();
    });
  }

  function readTeamForm(t) {
    const v = id => ($(id) ? $(id).value.trim() : '');
    t.name = v('#tm-name') || t.name; t.category = v('#tm-cat') || t.category; t.club = v('#tm-club'); t.leagueLabel = v('#tm-league');
    t.templateId = v('#tm-tpl') || 'sa-2025';
    t.staff = Object.assign({}, t.staff, { coach: v('#tm-coach'), assistant1: v('#tm-a1'), assistant2: v('#tm-a2') });
    t.rules = Object.assign({}, t.rules);
    if ($('#tm-onlyswiss') && $('#tm-onlyswiss').checked) t.rules.foreigners = { onlySwiss: true };
    else delete t.rules.foreigners;
  }

  function wireTeam(t) {
    on('#tm-back', 'click', () => { ui.teamId = null; ui.notice = ''; ui.progress = ''; draw(); });
    on('#tm-save-team', 'click', () => { readTeamForm(t); persist(); toast(T('tm.teamSaved')); draw(); });
    on('#tm-delete-team', 'click', () => {
      if (!confirm(T('tm.confirmDeleteTeam', { name: t.name }))) return;
      db.teams = db.teams.filter(x => x.id !== t.id); db.sheets = db.sheets.filter(x => x.teamId !== t.id);
      persist(); ui.teamId = null; draw();
    });
    on('#tm-unlink', 'click', () => { t.wpmatch = null; persist(); draw(); });
    on('#tm-wpm-search', 'click', async () => {
      const q = $('#tm-wpm-q').value.trim(), out = $('#tm-wpm-hits');
      if (q.length < 2) return;
      out.innerHTML = `<p class="muted">${T('tm.searching')}</p>`;
      try {
        const hits = await WPMATCH.searchTeams(q);
        out.innerHTML = hits.length ? hits.slice(0, 12).map(h => `<button class="btn-ghost sm" data-wpmteam="${h.id}" data-wpmname="${esc(h.name)}">${esc(h.name)}</button>`).join('')
          : `<p class="muted">${T('tm.noWpmatchTeam')}</p>`;
        out.querySelectorAll('[data-wpmteam]').forEach(b => b.onclick = () => { readTeamForm(t); t.wpmatch = { id: +b.dataset.wpmteam, name: b.dataset.wpmname }; persist(); draw(); });
      } catch (e) { out.innerHTML = `<p class="muted">${T('tm.wpmatchDown')}</p>`; }
    });

    on('#tm-lookup', 'click', async () => {
      const lics = ($('#tm-lic').value.match(/\d{3,6}/g) || []);
      if (!lics.length) { toast(T('tm.enterLicences')); return; }
      ui.busy = 'lookup'; ui.progress = T('tm.lookingUp', { n: lics.length }); ui.notice = ''; draw();
      try {
        const r = await WPMATCH.lookupLicences(lics);
        const found = WPMATCH.dedupePlayers(r.players);
        const ids = upsertPlayers(db, found, 'wpmatch');
        t.players = Array.from(new Set((t.players || []).concat(ids)));
        persist();
        const inactive = found.filter(p => ELIGIBILITY.statusOf(p.status) === 'inactive').length;
        ui.notice = [T('tm.addedN', { n: ids.length }),
          r.missing.length ? T('tm.notFound', { list: esc(r.missing.join(', ')) }) : '',
          inactive ? T('tm.inactiveFound', { n: inactive }) : ''].filter(Boolean).join(' ');
      } catch (e) { ui.notice = T('tm.wpmatchDown'); }
      ui.busy = ''; ui.progress = ''; draw();
    });
    on('#tm-crawl', 'click', async () => {
      ui.busy = 'crawl'; ui.notice = ''; ui.progress = T('tm.crawlStart'); draw();
      try {
        const found = await WPMATCH.fetchTeamPlayers(t.wpmatch.id, { onProgress: (p, n) => { ui.progress = T('tm.crawlProgress', { page: p, pages: n }); const el = $('.tm-progress'); if (el) el.textContent = ui.progress; } });
        const ids = upsertPlayers(db, found, 'wpmatch');
        t.players = Array.from(new Set((t.players || []).concat(ids)));
        persist(); ui.notice = T('tm.crawlDone', { n: found.length, team: esc(t.wpmatch.name) });
      } catch (e) { ui.notice = T('tm.wpmatchDown'); }
      ui.busy = ''; ui.progress = ''; draw();
    });
    on('#tm-manual', 'click', () => {
      const ids = upsertPlayers(db, [{ pid: uid('m'), name: T('tm.newPlayerName'), firstName: '' }], 'manual');
      t.players = (t.players || []).concat(ids); persist(); draw();
    });
    const edit = (attr, field) => $$(`[${attr}]`).forEach(inp => inp.onchange = () => {
      const p = db.players[inp.getAttribute(attr)]; if (!p) return;
      p[field] = field === 'gk' ? inp.checked : inp.value.trim();
      if (field === 'name' || field === 'firstName') { p.edited = true; p.nameGuessed = false; }
      persist();
    });
    edit('data-pname', 'name'); edit('data-pfirst', 'firstName'); edit('data-cap', 'cap'); edit('data-pgk', 'gk');
    $$('[data-premove]').forEach(b => b.onclick = () => { t.players = (t.players || []).filter(x => x !== b.dataset.premove); persist(); draw(); });

    on('#tm-new-sheet', 'click', () => {
      const tpl = templateById(db, t.templateId);
      const rows = autoOrder(roster(db, t).slice(0, tpl.rows), tpl.rows, t.category).map(p => (p ? { pid: p.pid, gk: !!p.gk, captain: false, younger: false } : null));
      const s = { id: uid('s'), teamId: t.id, templateId: tpl.id, match: { date: new Date().toISOString().slice(0, 10), league: '', opponent: '' }, staff: {}, rows, createdAt: Date.now(), updatedAt: Date.now() };
      db.sheets.push(s); persist(); ui.sheetId = s.id; draw();
    });
    $$('[data-sheet]').forEach(b => b.onclick = () => { ui.sheetId = b.dataset.sheet; draw(); });
    $$('[data-copysheet]').forEach(b => b.onclick = () => {
      const src = db.sheets.find(x => x.id === b.dataset.copysheet); if (!src) return;
      const s = JSON.parse(JSON.stringify(src));
      Object.assign(s, { id: uid('s'), match: { date: '', league: src.match.league, opponent: '' }, createdAt: Date.now(), updatedAt: Date.now() });
      db.sheets.push(s); persist(); ui.sheetId = s.id; draw();
    });
    $$('[data-delsheet]').forEach(b => b.onclick = () => { if (!confirm(T('tm.confirmDeleteSheet'))) return; db.sheets = db.sheets.filter(x => x.id !== b.dataset.delsheet); persist(); draw(); });
  }

  function wireSheet(s) {
    const t = db.teams.find(x => x.id === s.teamId) || {};
    const touch = () => { s.updatedAt = Date.now(); persist(); draw(); };
    on('#tm-sheet-back', 'click', () => { ui.sheetId = null; draw(); });
    const field = (id, set) => on(id, 'change', e => { set(e.target.value.trim()); touch(); });
    field('#tm-m-date', v => { s.match.date = v; });
    field('#tm-m-league', v => { s.match.league = v; });
    field('#tm-m-opp', v => { s.match.opponent = v; });
    field('#tm-s-ref', v => { s.staff = Object.assign({}, s.staff, { referee: v }); });
    on('#tm-s-tpl', 'change', e => { s.templateId = e.target.value; touch(); });

    $$('[data-row]').forEach(sel => sel.onchange = () => {
      const i = +sel.dataset.row, pid = sel.value;
      s.rows[i] = pid ? { pid, gk: !!(db.players[pid] && db.players[pid].gk), captain: false, younger: false } : null;
      touch();
    });
    const flag = (attr, key) => $$(`[${attr}]`).forEach(inp => inp.onchange = () => {
      const i = +inp.getAttribute(attr); if (!s.rows[i]) return;
      if (key === 'captain') s.rows.forEach(r => { if (r) r.captain = false; });
      s.rows[i][key] = inp.checked; touch();
    });
    flag('data-rowgk', 'gk'); flag('data-rowcap', 'captain'); flag('data-rowyoung', 'younger');
    const swap = (i, j) => { const tmp = s.rows[i]; s.rows[i] = s.rows[j]; s.rows[j] = tmp; touch(); };
    $$('[data-up]').forEach(b => b.onclick = () => { const i = +b.dataset.up; if (i > 0) swap(i, i - 1); });
    $$('[data-down]').forEach(b => b.onclick = () => { const i = +b.dataset.down; if (i < s.rows.length - 1) swap(i, i + 1); });
    on('#tm-auto', 'click', () => {
      const tpl = templateById(db, s.templateId);
      const chosen = s.rows.filter(r => r && r.pid).map(r => Object.assign({}, db.players[r.pid], { gk: r.gk, _row: r }));
      const pool = chosen.length ? chosen : roster(db, t).map(p => Object.assign({}, p, { _row: null }));
      s.rows = autoOrder(pool, tpl.rows, t.category).map(p => (p ? { pid: p.pid, gk: !!p.gk, captain: !!(p._row && p._row.captain), younger: !!(p._row && p._row.younger) } : null));
      touch();
    });
    on('#tm-clear', 'click', () => { s.rows = s.rows.map(() => null); touch(); });

    on('#tm-fixtures', 'click', async () => {
      const out = $('#tm-fixture-list'); out.innerHTML = `<p class="muted">${T('tm.searching')}</p>`;
      try {
        const fx = await WPMATCH.fetchFixtures({ id: t.wpmatch.id, name: t.wpmatch.name }, { maxPages: 2 });
        const soon = fx.filter(f => f.status !== 'ended' && f.localTime).sort((a, b) => a.localTime.localeCompare(b.localTime)).slice(0, 6);
        out.innerHTML = soon.length ? soon.map(f => {
          const opp = WPMATCH.opponentOf(f, t.wpmatch.id);
          const oppName = opp && opp.opponent ? opp.opponent.name : '';
          return `<button class="btn-ghost sm" data-fx-date="${esc(f.localTime.slice(0, 10))}" data-fx-opp="${esc(oppName)}">${esc(TEAMSHEET.swissDate(f.localTime))} · ${esc(oppName)}</button>`;
        }).join('') : `<p class="muted">${T('tm.noFixtures')}</p>`;
        out.querySelectorAll('[data-fx-date]').forEach(b => b.onclick = () => { s.match.date = b.dataset.fxDate; s.match.opponent = b.dataset.fxOpp; touch(); });
      } catch (e) { out.innerHTML = `<p class="muted">${T('tm.wpmatchDown')}</p>`; }
    });

    const build = () => {
      const tpl = templateById(db, s.templateId);
      const staff = Object.assign({}, t.staff || {}, s.staff || {});
      const data = { club: t.club, team: { name: t.leagueLabel || catLabel(t.category), staff }, match: Object.assign({}, s.match, { league: s.match.league || t.leagueLabel || catLabel(t.category) }), lineup: lineupOf(db, s).slice(0, tpl.rows), staff };
      return { tpl, data, model: TEAMSHEET.buildModel(tpl, data) };
    };
    const blocked = () => {
      const r = ELIGIBILITY.check(t, lineupOf(db, s).filter(Boolean), { date: s.match.date });
      return r.errors && !confirm(T('tm.confirmWithErrors', { n: r.errors }));
    };
    const download = (bytes, name, mime) => {
      try {
        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
        return true;
      } catch (e) { toast(T('tm.downloadFailed')); return false; }
    };
    on('#tm-dl-docx', 'click', () => {
      if (blocked()) return;
      const { data, model } = build();
      if (download(SHEETDOC.toDocx(model), TEAMSHEET.fileName(data, 'docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')) toast(T('tm.downloaded'));
    });
    on('#tm-dl-pdf', 'click', () => {
      if (blocked()) return;
      const { data, model } = build();
      const pdf = SHEETDOC.toPdf(model);
      const note = $('#tm-dl-note');
      // The PDF font cannot draw every letter. Say exactly which ones changed, and where to go instead.
      if (note) note.innerHTML = pdf.substituted.length
        ? T('tm.pdfSubstituted', { list: esc(pdf.substituted.map(x => `${x.from} → ${x.to}`).join(', ')) })
        : (pdf.truncated.length ? T('tm.pdfTruncated', { list: esc(pdf.truncated.map(x => x.text).join(', ')) }) : '');
      if (download(pdf.bytes, TEAMSHEET.fileName(data, 'pdf'), 'application/pdf')) toast(T('tm.downloaded'));
    });
    on('#tm-print', 'click', () => {
      const { model } = build();
      const w = window.open('', '_blank');
      if (!w) { toast(T('tm.popupBlocked')); return; }
      w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(model.docTitle)}</title><style>${PRINT_CSS}</style>${SHEETDOC.toHtml(model)}<script>setTimeout(function(){window.print()},300)<\/script>`);
      w.document.close();
    });
  }

  function wireTemplateEditor() {
    const raw = db.templates.find(x => x.id === ui.tplId); if (!raw) return;
    on('#tm-tpl-back', 'click', () => { ui.tplId = null; ui.tab = 'templates'; draw(); });
    const apply = mutate => { const tpl = TEAMSHEET.normalizeTemplate(raw); mutate(tpl); Object.assign(raw, tpl, { id: raw.id, builtin: false }); persist(); draw(); };
    on('#tt-name', 'change', e => apply(t => { t.name = e.target.value.trim() || t.name; }));
    on('#tt-title', 'change', e => apply(t => { t.title = e.target.value.trim() || null; }));
    on('#tt-rows', 'change', e => apply(t => { t.rows = +e.target.value; }));
    on('#tt-l1', 'change', e => apply(t => { t.langs = [e.target.value, t.langs[1] === e.target.value ? '' : t.langs[1]]; }));
    on('#tt-l2', 'change', e => apply(t => { t.langs = [t.langs[0], e.target.value === t.langs[0] ? '' : e.target.value]; }));
    on('#tt-note', 'change', e => apply(t => { t.note = e.target.checked; }));
    $$('[data-thead]').forEach(c => c.onchange = () => apply(t => { const k = c.dataset.thead; t.header = c.checked ? TEAMSHEET.HEADER_KEYS.filter(x => x === k || t.header.includes(x)) : t.header.filter(x => x !== k); }));
    $$('[data-tstaff]').forEach(c => c.onchange = () => apply(t => { const k = c.dataset.tstaff; t.staff = c.checked ? TEAMSHEET.STAFF_KEYS.filter(x => x === k || t.staff.includes(x)) : t.staff.filter(x => x !== k); }));
    $$('[data-tcol]').forEach(c => c.onchange = () => apply(t => {
      const k = c.dataset.tcol;
      t.columns = c.checked ? t.columns.concat({ key: k, w: 0.15 }) : t.columns.filter(x => x.key !== k);
    }));
    $$('[data-tcolw]').forEach(inp => inp.onchange = () => apply(t => { const c = t.columns.find(x => x.key === inp.dataset.tcolw); if (c) c.w = Math.max(3, +inp.value || 10) / 100; }));
    const move = (k, d) => apply(t => { const i = t.columns.findIndex(x => x.key === k), j = i + d; if (i < 0 || j < 0 || j >= t.columns.length) return; const c = t.columns.splice(i, 1)[0]; t.columns.splice(j, 0, c); });
    $$('[data-tcolup]').forEach(b => b.onclick = () => move(b.dataset.tcolup, -1));
    $$('[data-tcoldown]').forEach(b => b.onclick = () => move(b.dataset.tcoldown, 1));
  }

  /* ------------------------------------------------------------- the player's own card
     On the PLAYER's device: they enter their licence number once and the card is read live
     from wpmatch.ch, which already publishes it. Stored on that device only — the same
     no-backend rule as the rosters, and the reason this does not wait for real sign-in.

     NOT the official card. Swiss Aquatics issues official player cards to clubs through
     Fairgate, and referees check those before a match. This one says so, plainly, and does
     not borrow its look — a card that could be mistaken for the real thing at a pool is worse
     than no card. */
  const CARD_KEY = 'thplay.mycard.v1';
  const loadCard = () => { try { return JSON.parse(localStorage.getItem(CARD_KEY)) || null; } catch (e) { return null; } };
  const saveCard = c => { try { c ? localStorage.setItem(CARD_KEY, JSON.stringify(c)) : localStorage.removeItem(CARD_KEY); } catch (e) {} };

  function renderPlayerCard(el, context) {
    if (!el) return;
    const c = context || {};
    const say = m => (c.toast ? c.toast(m) : null);
    const card = loadCard();
    const draw = (busy, msg) => {
      const cur = loadCard();
      if (!cur || !cur.player) {
        el.innerHTML = `<div class="dev-card tm-mycard">
          <h3>${T('tm.card.title')}</h3>
          <p class="muted">${T('tm.card.intro')}</p>
          <div class="tm-add"><label class="tm-lic">${T('tm.card.licence')}<input type="text" id="tm-card-lic" inputmode="numeric" maxlength="6" value="${esc(cur && cur.licence)}"></label>
            <div class="tm-add-btns"><button class="btn-primary sm" id="tm-card-go" ${busy ? 'disabled' : ''}>${busy ? T('tm.searching') : T('tm.card.show')}</button></div></div>
          ${msg ? `<p class="fa-note">${msg}</p>` : ''}
        </div>`;
      } else {
        const p = cur.player;
        el.innerHTML = `<div class="dev-card tm-mycard">
          <h3>${T('tm.card.title')}</h3>
          <div class="tm-card-body">
            <div class="tm-card-name">${esc([p.firstName, p.name].filter(Boolean).join(' '))}</div>
            <div class="tm-card-lic"><span class="muted">${T('tm.licenceNo')}</span> <b>${esc(p.licence)}</b></div>
            <div class="tm-card-meta">${p.cap ? `<span class="tag">${T('tm.card.cap', { n: esc(p.cap) })}</span>` : ''}${p.birthYear ? `<span class="tag">${T('tm.born')} ${esc(p.birthYear)}</span>` : ''}${statusBadge(p.status)}</div>
            ${ELIGIBILITY.statusOf(p.status) === 'inactive' ? `<p class="tm-f tm-f-warn">${T('tm.card.inactive')}</p>` : ''}
          </div>
          <p class="fa-note">${T('tm.card.checked', { date: esc(new Date(cur.checkedAt).toLocaleDateString()) })} ${T('tm.card.notOfficial')}</p>
          <div class="tm-actions"><button class="btn-ghost sm" id="tm-card-refresh" ${busy ? 'disabled' : ''}>${busy ? T('tm.searching') : T('tm.card.refresh')}</button>
            <button class="btn-ghost sm" id="tm-card-change">${T('tm.card.change')}</button></div>
          ${msg ? `<p class="fa-note">${msg}</p>` : ''}
        </div>`;
      }
      wireCard();
    };
    const lookup = async lic => {
      if (!/^\d{3,6}$/.test(lic)) { draw(false, T('tm.card.badNumber')); return; }
      saveCard(Object.assign({}, loadCard(), { licence: lic }));
      draw(true);
      try {
        const r = await WPMATCH.lookupLicences([lic]);
        // the active record wins over an old inactive number for the same person
        const p = WPMATCH.dedupePlayers(r.players).find(x => x.licence === lic) || r.players[0];
        if (!p) { saveCard({ licence: lic, player: null }); draw(false, T('tm.card.notFound', { lic: esc(lic) })); return; }
        saveCard({ licence: lic, player: p, checkedAt: Date.now() });
        draw(false); say(T('tm.card.updated'));
      } catch (e) { draw(false, T('tm.wpmatchDown')); }
    };
    function wireCard() {
      const go = el.querySelector('#tm-card-go');
      if (go) go.onclick = () => lookup(el.querySelector('#tm-card-lic').value.trim());
      const inp = el.querySelector('#tm-card-lic');
      if (inp) inp.onkeydown = e => { if (e.key === 'Enter') lookup(inp.value.trim()); };
      const rf = el.querySelector('#tm-card-refresh');
      if (rf) rf.onclick = () => lookup(loadCard().licence);
      const ch = el.querySelector('#tm-card-change');
      if (ch) ch.onclick = () => { const cur = loadCard(); saveCard({ licence: cur && cur.licence, player: null }); draw(false); };
    }
    draw(false);
    return card;
  }

  // printing opens a bare window, so it carries its own copy of the sheet styles
  /* theme:fixed — the official team sheet is a paper form: black on white in every look */
  const PRINT_CSS = `body{font:10pt Verdana,Geneva,sans-serif;color:#000;margin:18mm 16mm}.ts-title{font:700 14pt Arial,Helvetica,sans-serif;margin:0 0 14pt}
    .ts-t{width:100%;border-collapse:collapse;margin:0 0 16pt}.ts-t td,.ts-t th{border:1px solid #000;padding:3pt 5pt;text-align:left;vertical-align:top;font-weight:400}
    .ts-roster td{height:14pt}.ts-sign td{height:30pt}.ts-2nd{color:#555}.ts-note p{margin:2pt 0;font-weight:700}.ts-lead{color:#e4002b}.ts-i{font-style:italic}`;

  return { KEY, CARD_KEY, CATEGORY_ORDER, render, renderPlayerCard, load, save, upsertPlayers, autoOrder, lineupOf, allTemplates };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = TEAMS;
