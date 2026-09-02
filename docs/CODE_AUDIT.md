# Triibholz (THPLAY) — Code Audit & Grade (2026‑09‑02, v1.22.0)

An honest, inspection‑based assessment of where the codebase stands, graded A+ → D−.
Metrics were measured, not estimated.

## Measured facts

| Metric | Value |
|--------|-------|
| App JS | 6,347 lines across 22 modules (largest: `app.js` 1,840 · `film.js` 779 · `data.js` 680) |
| Backend | 524 lines (dependency‑free Node: `index.js`, `engine.js`, `detector.js`, `videoadapter.js`) |
| CSS / HTML | 775 / 460 lines |
| Tests | 1,069 lines · **3 gates: smoke 217 · backend 35 · Firefox E2E 81 — all green, zero console errors** |
| Runtime dependencies | **0** (no framework, no bundler; tests use jsdom + Playwright only) |
| `eval` / `new Function` / TODO / FIXME | 0 / 0 / 0 / 0 |
| XSS discipline | 65 `escapeHtml()` call sites; every user‑supplied string audited as escaped; unescaped `innerHTML` interpolations are constants/enums/blob URLs only |
| History | 48 commits · 23 tagged releases, each gated |

## Grades

| Area | Grade | Why |
|------|-------|-----|
| **Engineering discipline & testing** | **A−** | Three real gates incl. a real‑browser E2E with actual mouse drags, uploads, calibration clicks and a genuine MediaRecorder render; deterministic pure engines; every release gated; zero deps. Missing: CI running the suites on every push (only the rules updater runs in Actions), Chrome/Safari passes, coverage measurement. |
| **Domain engines (pure modules)** | **A−** | vision / track / bytetrack / events / planner / calendar / solver / draft / commands / privacy are small, pure, unit‑tested and reused verbatim on the server. Genuinely good separation. |
| **Code craft & readability** | **B+** | Clear module headers, consistent style, honest comments. Debit: `app.js` is a 1,840‑line monolith (136 functions) that mixes rendering, state and handlers; `film.js` likewise. Fine at this size, a liability at 2×. |
| **Architecture** | **B−** | Classic global scripts with no module system, no build, no types, no linter. That was a deliberate, valid choice for an offline PWA — but it caps maintainability and makes refactors risky as the team grows. |
| **Security** | **C** | Good: no eval, consistent escaping, input limits, path sanitisation, keys env‑only, honest error paths. Gaps that block a public deploy: **simulated sign‑in (no real auth)**, **no authorization on any backend endpoint**, `CORS *`, **no security headers** (CSP, X‑Frame‑Options, X‑Content‑Type‑Options, HSTS, `server_tokens`), per‑request provider `base` (SSRF), no rate limiting. |
| **Data & multi‑user readiness** | **C−** | All user data is **localStorage on one device** — no server persistence, no sync across a coach's devices, no per‑club (tenant) isolation, no backups. The subscribe feed and insights are the only server‑side data. |
| **Privacy & compliance** | **B** | New: visibility levels, owner‑only confidential plays, identifier‑stripping anonymiser with k‑anonymity (k=5), refusal of identifying payloads. Missing for Swiss rollout: consent records, data export/delete (FADP/GDPR), retention policy, a privacy notice. |
| **Documentation** | **A−** | README, DEPLOYMENT, per‑module READMEs, test plan, dataset/training guide, video, demo, this audit. |
| **Accessibility & i18n** | **B−** | EN/DE/FR/IT with leak guards, keyboard shortcuts, Esc handling. No a11y audit, contrast not verified, screen‑reader labels sparse. |

### Overall: **B−**
**Read as:** *excellent prototype engineering, not yet production infrastructure.* The craft, honesty and test discipline are well above typical pilot code (that's the B+/A− side). What holds the grade down is not quality of what exists but what's absent for a multi‑user, multi‑club product: real auth, server‑side persistence with tenant isolation, and hardening. Those are exactly the items in `ROLLOUT_ROADMAP.md`.

- **Pilot in one club (Schorgen), one coach's device, players viewing:** ready today.
- **Several coaches sharing one club's playbook across devices:** needs Phase A of the roadmap.
- **Switzerland‑wide, many clubs:** needs Phases A + B.

## Top fixes, in order of leverage
1. **Security headers in nginx** (CSP, X‑Frame‑Options DENY, X‑Content‑Type‑Options nosniff, Referrer‑Policy, HSTS at the edge, `server_tokens off`) — an afternoon, big risk reduction.
2. **Real auth + authorization** (Apple/Google OAuth → session → role checks on every backend endpoint; CORS scoped to the app origin).
3. **Server‑side persistence + per‑club tenancy** (plays, users, calendar, insights keyed by club; migrations; backups) — this unlocks multi‑device and multi‑coach.
4. **CI**: run the three gates on every push/PR; add Chrome + Safari to the browser gate.
5. **Split `app.js`** into view modules (dashboard / playbook / editor / season / solutions) behind the same globals — zero behaviour change, big maintainability gain.
6. **Rate limiting + request‑provider lockdown** on the backend before it's public.
7. **FADP/GDPR pack**: consent capture, export, delete, retention, privacy notice (DE/FR/IT).
