/* ============================================================
   teamsync.js — what the device and the club server must agree on about a team.

   A coach's teams live on their device (js/teams.js). Slice 5 of docs/ACCOUNTS.md lets them put a
   team on the club's own server so it follows them to a second device and so the club still has
   the roster when that device is lost. This module is the contract for that, shared by both sides
   the way js/announce.js already is — the server `require`s this exact file, so a rule can never
   be enforced in one place and forgotten in the other.

   What it decides:

     · WHAT MAY TRAVEL. A whitelist, and anything else is refused rather than dropped — so a later
       client cannot start sending a field nobody agreed to. `availability`, `sheets` and `status`
       are named refusals, not oversights: availability is an opinion about a child's body, a sheet
       is the coach's own working document, and `status` is wpmatch's nationality text about a
       named minor, which anyone holding the public licence can re-derive in one request.
     · A DATE OF BIRTH NEVER TRAVELS. Only a birth YEAR, and only for a player who has no licence
       yet, because for anyone else wpmatch supplies it on the coach's own device. `date`, `dob`
       and `birthDate` are refused by name (js/wpmatch.js never fetches them either).
     · WHAT A LICENCE IS. One normalisation, used for the payload, the uniqueness check and the
       two-teams check alike — otherwise '50101', '050101' and the fullwidth '５０１０１' are three
       different children as far as the database is concerned.
     · WHETHER THE UPLOAD ARRIVED. The server answers with a manifest listing what it stored;
       `manifestOk` is what the device checks before it believes a word of it.

   The device's own team id is NOT in the payload contract as an identifier the server keeps: it is
   sent so the answer can be matched back to the right local team, and the server keys on a hash of
   it that carries nothing (server/teams.js). The ids in js/teams.js are `Math.random` and travel
   between devices inside exported .thplay.json files.
   ============================================================ */
const TEAMSYNC = (() => {
  /* the categories a team may have: the ELIGIBILITY presets, which are also TEAMS.CATEGORY_ORDER.
     A smoke test pins all three together so they cannot drift apart. */
  const CATEGORIES = ['U10', 'U12', 'U14', 'U14D', 'U16', 'U16D', 'U18', 'U18D', 'NLA', 'NLB', 'RL', 'NLD', 'PLD', 'ST', 'CUP', 'CUPD', 'CUSTOM'];

  /* Numbers a real club never reaches. They are here, not only on the server, so the app can say
     "this team is too big to sync" before it sends 60 children's names for nothing. */
  const LIMITS = { teamsPerClub: 40, playersPerClub: 800, playersPerTeam: 60, syncsPerHour: 60, newLicencesPerDay: 200 };

  const MAX_NAME = 80, MAX_TEAM_NAME = 60, MAX_LABEL = 60;
  const LICENCE = /^\d{3,6}$/;
  const LOCAL_ID = /^[A-Za-z0-9_-]{1,40}$/;
  /* never stored, never echoed: a field whose presence means the client and this file disagree */
  const REFUSED = ['availability', 'sheets', 'sheet', 'status', 'date', 'dob', 'birthDate', 'birthdate', 'meta', 'notes', 'wpId', 'checkedAt', 'email', 'phone', 'address', 'scouted', 'squad'];

  const TEAM_KEYS = ['localId', 'teamId', 'name', 'category', 'season', 'leagueLabel', 'rev', 'players'];
  const TEAM_ID = /^ct_[A-Za-z0-9_-]{22}$/;
  const PLAYER_KEYS = ['localId', 'licence', 'name', 'firstName', 'nameEdited', 'nameGuessed', 'birthYear', 'gender', 'cap', 'gk', 'rev'];

  /* no control or bidi-override characters: these names are printed on an official form and shown
     to other people. The same rule as a display name (server/identity.js cleanName). */
  const clean = (v, n) => String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, n);
  /* A licence is a NUMBER a coach types or pastes, so '50101', ' 50101 ', '050101' and the fullwidth
     '５０１０１' are one child and must become one string before anything compares them — otherwise
     UNIQUE(club_id, licence) is a formality and the same player sits on two lists with no warning. */
  const normLicence = v => String(v == null ? '' : v).normalize('NFKC').trim().replace(/^0+(?=\d)/, '');
  const isLicence = v => LICENCE.test(normLicence(v));

  const bad = error => ({ ok: false, error });
  const extraKey = (obj, allowed) => Object.keys(obj || {}).find(k => REFUSED.includes(k) || !allowed.includes(k)) || null;

  /* one player as the server will store them, or the reason it will not */
  function sanitizePlayer(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('bad-player');
    const extra = extraKey(input, PLAYER_KEYS);
    if (extra) return bad('bad-field');
    const licence = normLicence(input.licence);
    if (licence && !LICENCE.test(licence)) return bad('bad-licence');
    // a player with no licence yet is known by the device id that made them, and by nothing else
    if (!licence && !LOCAL_ID.test(String(input.localId || ''))) return bad('bad-player');
    const name = clean(input.name, MAX_NAME);
    if (!name && !clean(input.firstName, MAX_NAME)) return bad('bad-player');
    const year = input.birthYear === undefined || input.birthYear === null || input.birthYear === '' ? null : Number(input.birthYear);
    if (year !== null && !(Number.isInteger(year) && year >= 1900 && year <= 2100)) return bad('bad-birth-year');
    const gender = input.gender === undefined || input.gender === null ? '' : String(input.gender);
    if (!['', 'M', 'F'].includes(gender)) return bad('bad-player');
    // wpmatch knows the year and the gender of a licensed player; the server has no business with them
    if (licence && (year !== null || gender)) return bad('licensed-player-needs-no-year');
    const cap = String(input.cap == null ? '' : input.cap).trim();
    if (cap && !/^\d{1,2}$/.test(cap)) return bad('bad-cap');
    return {
      ok: true,
      value: {
        localId: LOCAL_ID.test(String(input.localId || '')) ? String(input.localId) : null,
        licence: licence || null,
        name, firstName: clean(input.firstName, MAX_NAME),
        nameEdited: !!input.nameEdited, nameGuessed: !!input.nameGuessed,
        birthYear: year, gender, cap, gk: !!input.gk,
        rev: Number.isInteger(input.rev) && input.rev > 0 ? input.rev : null,
      },
    };
  }

  /* one team and its roster: what POST /api/clubs/:club/teams accepts */
  function sanitizeTeam(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('bad-team');
    const extra = extraKey(input, TEAM_KEYS);
    if (extra) return bad('bad-field');
    if (!LOCAL_ID.test(String(input.localId || ''))) return bad('bad-team');
    // a device that took this roster down from the club already knows which team it is: it says so,
    // rather than minting a second team at the club under its own local id
    if (input.teamId !== undefined && input.teamId !== null && !TEAM_ID.test(String(input.teamId))) return bad('bad-team');
    const name = clean(input.name, MAX_TEAM_NAME);
    if (!name) return bad('bad-team');
    if (!CATEGORIES.includes(input.category)) return bad('bad-category');
    const season = Number(input.season);
    if (!(Number.isInteger(season) && season >= 2000 && season <= 2100)) return bad('bad-season');
    const list = Array.isArray(input.players) ? input.players : [];
    if (list.length > LIMITS.playersPerTeam) return bad('too-many-players');
    const players = [];
    for (const p of list) {
      const r = sanitizePlayer(p);
      if (!r.ok) return r;
      players.push(r.value);
    }
    // the same child twice on one list is the device's bug, not the server's to guess at
    const keys = players.map(p => p.licence ? 'L' + p.licence : 'm' + p.localId);   // a licence is the identity when there is one
    if (new Set(keys).size !== keys.length) return bad('duplicate-player');
    return {
      ok: true,
      value: {
        localId: String(input.localId), teamId: input.teamId ? String(input.teamId) : null,
        name, category: input.category, season,
        leagueLabel: clean(input.leagueLabel, MAX_LABEL),
        rev: Number.isInteger(input.rev) && input.rev > 0 ? input.rev : null,
        players,
      },
    };
  }

  /* Did the answer account for everything we sent? The device believes nothing until this passes:
     a proxy that truncated the list, a server that stored half of it, or an answer meant for a
     different team all fail here, and the device keeps its copy exactly as it was. */
  function manifestOk(sent, manifest) {
    if (!sent || !manifest || !manifest.team || !Array.isArray(manifest.players)) return false;
    if (manifest.team.localId !== sent.localId || !manifest.team.id) return false;
    const answered = new Set(manifest.players.map(p => p.licence ? 'L' + p.licence : 'm' + p.localId));
    return sent.players.every(p => answered.has(p.licence ? 'L' + p.licence : 'm' + p.localId));
  }

  return { CATEGORIES, LIMITS, LICENCE, TEAM_ID, MAX_NAME, MAX_TEAM_NAME, REFUSED, PLAYER_KEYS, TEAM_KEYS,
           clean, normLicence, isLicence, sanitizePlayer, sanitizeTeam, manifestOk };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = TEAMSYNC;
