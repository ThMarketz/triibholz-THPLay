/* ============================================================
   calendar.js — events + iCalendar (.ics) so the schedule works on
   every platform.

   iCalendar (RFC 5545) is the one format Apple Calendar (iOS/Mac),
   Google Calendar (Android) and Outlook (Windows) all import and can
   SUBSCRIBE to. So one .ics export / one feed URL reaches everyone,
   and a subscribed feed auto-updates when matches change.

   Pure and unit-tested: the model, the strict .ics serialiser (line
   folding, escaping, CRLF, all-day vs timed, reminders, attendees)
   and the month/agenda views. Storage + UI live in app.js.
   ============================================================ */
const CALENDAR = (() => {
  const STORE = 'thplay.calendar.v1';
  const TYPES = { match: '🤽 Match', training: '🏊 Training', meeting: '📋 Meeting', other: '📌 Event' };

  /* ---------- storage ---------- */
  function load() { try { return JSON.parse(localStorage.getItem(STORE) || '[]') || []; } catch (e) { return []; } }
  function save(events) { try { localStorage.setItem(STORE, JSON.stringify(events)); } catch (e) {} }

  /* ---------- date helpers (UTC-safe) ---------- */
  const pad = n => String(n).padStart(2, '0');
  const asDate = d => d instanceof Date ? d : new Date(d);
  function fmtUTC(d) { d = asDate(d); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; }
  function fmtDATE(d) { d = asDate(d); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`; }
  const addDays = (d, n) => { const x = asDate(d); const y = new Date(x); y.setUTCDate(x.getUTCDate() + n); return y; };
  const dayKey = d => { d = asDate(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  /* ---------- .ics serialisation (RFC 5545) ---------- */
  const esc = s => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  function fold(line) {                       // ≤75 octets per line; continuation starts with a space
    if (line.length <= 74) return line;
    const out = []; let s = line;
    out.push(s.slice(0, 74)); s = s.slice(74);
    while (s.length) { out.push(' ' + s.slice(0, 73)); s = s.slice(73); }
    return out.join('\r\n');
  }
  function vevent(ev, now) {
    const L = [];
    const start = asDate(ev.start), allDay = !!ev.allDay;
    const end = ev.end ? asDate(ev.end) : (allDay ? addDays(start, 1) : new Date(start.getTime() + 90 * 60000));
    L.push('BEGIN:VEVENT');
    L.push('UID:' + (ev.id || ('e' + start.getTime())) + '@triibholz');
    L.push('DTSTAMP:' + fmtUTC(now || new Date()));
    if (allDay) { L.push('DTSTART;VALUE=DATE:' + fmtDATE(start)); L.push('DTEND;VALUE=DATE:' + fmtDATE(end)); }
    else { L.push('DTSTART:' + fmtUTC(start)); L.push('DTEND:' + fmtUTC(end)); }
    L.push('SUMMARY:' + esc((TYPES[ev.type] ? TYPES[ev.type].replace(/^\S+\s/, '') + ': ' : '') + (ev.title || 'Event')));
    if (ev.location) L.push('LOCATION:' + esc(ev.location));
    const desc = [ev.notes, ev.opponent ? 'Opponent: ' + ev.opponent : '', ev.focus ? 'Focus: ' + ev.focus : ''].filter(Boolean).join('\\n');
    if (desc) L.push('DESCRIPTION:' + esc(desc));
    (ev.attendees || []).forEach(a => a && L.push('ATTENDEE;CN=' + esc(a.name || a.email) + ':mailto:' + (a.email || 'noreply@triibholz.app')));
    if (!allDay && ev.reminderMin) { L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(ev.title || 'Reminder'), 'TRIGGER:-PT' + ev.reminderMin + 'M', 'END:VALARM'); }
    L.push('END:VEVENT');
    return L;
  }
  function toICS(events, opts) {
    opts = opts || {};
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Triibholz//THPLAY//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    if (opts.name) L.push('X-WR-CALNAME:' + esc(opts.name));
    (events || []).forEach(ev => vevent(ev, opts.now).forEach(l => L.push(l)));
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }

  /* ---------- views ---------- */
  function agenda(events, from, days) {
    const f = asDate(from || new Date()); f.setHours(0, 0, 0, 0);
    const to = addDays(f, days || 60);
    return (events || []).map(e => ({ ...e, _t: asDate(e.start).getTime() }))
      .filter(e => e._t >= f.getTime() && asDate(e.start) < to)
      .sort((a, b) => a._t - b._t);
  }
  function monthGrid(year, month, events) {          // month: 0-11
    const first = new Date(year, month, 1);
    const startDow = first.getDay();                 // 0=Sun
    const gridStart = new Date(year, month, 1 - startDow);
    const byDay = {};
    (events || []).forEach(e => { const k = dayKey(e.start); (byDay[k] || (byDay[k] = [])).push(e); });
    const weeks = [];
    for (let w = 0; w < 6; w++) {
      const row = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(gridStart); day.setDate(gridStart.getDate() + w * 7 + d);
        row.push({ date: day, inMonth: day.getMonth() === month, key: dayKey(day), events: (byDay[dayKey(day)] || []).sort((a, b) => asDate(a.start) - asDate(b.start)) });
      }
      weeks.push(row);
    }
    return weeks;
  }

  const uid = () => 'ev_' + Math.abs(Date.now() % 1e9).toString(36) + Math.floor((typeof performance !== 'undefined' ? performance.now() : 0) % 1e6).toString(36);

  return { STORE, TYPES, load, save, toICS, agenda, monthGrid, uid, fmtUTC, fmtDATE, addDays, dayKey };
})();

// Node/CommonJS interop (no-op in the browser)
if (typeof module !== "undefined" && module.exports) module.exports = CALENDAR;
