# Triibholz (THPLAY) — Black & Silver theme, phased (2026‑09‑15)

The approved look is the sample "Triibholz Black & Silver" (artifact, 2026‑09‑15). It covers the
Playbook screen in today's navy look and in Black & Silver, with glass controls over the pool.

**The look in one paragraph.**
- **Ground:** obsidian `#050506`. The pool alone sits on true black.
- **Surfaces:** graphite `#111214` and gunmetal `#1A1B1E`.
- **Ink:** platinum `#ECEEF1`, silver `#A7ADB6` and pewter `#6E747D`.
- **Metal gradient:** spent only on the active tab and the play control.
- **Colour:** the water is the only colour on screen (steel-teal `#136373 → #0A2E36`), and brand orange
  `#FF7A18` stays for the dot and live states.
- **Glass:** only on what floats over the pool or video (18 px blur, light top edge). Content panels
  stay solid for sunlight on the pool deck.

## Measured starting point

- **`css/styles.css`:** 1,200 lines. 563 places already use tokens (`var(--…)`), but **360 colours
  are hard-coded** (107 distinct hex values).
- **Colours in JavaScript (~150):**
  - `js/pool.js`: 48, the board SVG
  - `js/app.js`: 31
  - `js/videogen.js`: 21, the exported video canvas
  - `js/fx.js`: 15, celebrations
  - `js/animate.js`: 12
  - `js/film.js`: 10
  - `js/manikin.js`: 8, 3D players
  - `js/qr.js`: 2
- **No theme mechanism.** The phone status bar is fixed teal (`theme-color #0e7c86`).
- **Must never follow the theme:** the QR code (must scan: dark on light) and the team-sheet
  preview (paper, already pinned black-on-white).
- **Tests:** the browser gate takes screenshots but compares nothing, so there's no visual regression
  check yet.

## Status

| Phase | What | Size | Status |
|-------|------|------|--------|
| 0 | Foundation: every colour becomes a token, a theme switch exists, today's look unchanged | L | ☑ done |
| 1 | Black & Silver chrome: palette, bars, panels, buttons, forms, menus, toasts | M | ☑ done |
| 2 | The pool and everything drawn: board, animation, Film Room board, 3D, celebrations | M | ☐ |
| 3 | Glass on floating controls, with a solid fallback | S | ☐ |
| 4 | Every screen, both looks, phone widths; sign-off and release | M | ☐ |

## Decisions (owner, 2026‑09‑15)

1. **Default for new users:** Black & Silver. Existing users keep what they last picked. Applied in
   Phase 4, when the look is complete.
2. **Keep "Today":** yes, both looks stay, behind a switch.
3. **Exports follow the viewer's theme:** video reels, PNG/SVG downloads and the PDF booklet are drawn
   in the look the coach is using, so export code reads the same tokens as the screen (Phase 2).
   Open detail: a *printed* PDF booklet in Black & Silver uses a lot of ink. If that matters on paper,
   print could keep a light page while downloads follow the theme; raise it in Phase 2.
4. **Glass:** on by default, with a switch.

---

## Phase 0 — Foundation (no visible change)

**Goal.** Replace the 360 hard-coded CSS colours and the ~150 JS colours with named tokens. With the
current values, today's look must stay pixel-identical. Add the switch plumbing:
- `data-look` on `<html>`;
- saved per device, like the sound and language settings;
- applied before first paint, so there's no flash of the wrong theme;
- the phone status-bar colour (`theme-color`) follows the look.

**Why first.** Without it, every Black & Silver change is a hunt through 500 literals, and a missed one
shows up as a navy patch on a black screen.

**Tests.**
- **New visual regression check in `tests/browser.mjs`.** Screenshot key screens before and after,
  and compare pixels inside the browser (canvas, no new downloads). Today's look must not change.
- **Smoke ratchet.** Hard-coded colours outside the token file may only go down (the same ratchet
  idea as the i18n scanner), with QR and paper preview as the named exceptions.

**Done 2026‑09‑15.** Today's look is pixel-identical on every captured screen.

- **CSS.** 331 colour literals in `css/styles.css` became tokens. Literals that equal an existing token
  use it (`--panel`, `--teal` …). The rest became a **palette by family and lightness**
  (`--navy-19`, `--cyan-48`, `--yellow-70b`, 93 tokens). Colours used with transparency get an
  `-rgb` twin and are written `rgba(var(--x-rgb),α)`, which gives identical pixels in every browser
  the app supports (`color-mix` would need iOS 16.2+).
  - Only declarations were rewritten, never selectors (`#add-btn` looks like a hex colour).
  - Phase 1 can remap each navy or cyan step to a graphite or silver of the same lightness, close
    to a formula.
- **Code that draws.** ~110 colours in `pool.js`, `animate.js`, `film.js`, `app.js` (3D scene,
  keeper view, PNG export), `videogen.js` (reels), `fx.js` (confetti, mascot) and `manikin.js`
  became **role tokens** (`--pool-2m`, `--cap-dark`, `--reel-caption` …). They are read as
  values through the new `js/theme.js` (`THEME.c()`), not `var()`: an inline style would beat
  the CSS rule that highlights a focused player, and a downloaded SVG has no stylesheet.
  - Constant colour tables became getters, so a look change needs no reload.
  - The 3D cap-number colour no longer compares a colour value (`cap.stroke === '#000'`), which a
    look would break; it checks the team.
- **`js/theme.js`** (loaded first in `<head>`).
  - Sets `data-look` on `<html>` before the first paint, saved per device (`thplay.look.v1`).
  - Keeps `theme-color` in step.
  - `setLook()` / `onChange()` are ready for Phase 1.
  - A fallback copy of the role tokens serves the jsdom smoke suite.
- **Never follows the theme** (marked `theme:fixed`):
  - the paper team-sheet preview and printed team sheet;
  - the Apple and Google sign-in buttons;
  - the print booklet, until Phase 2 settles printing and ink;
  - `js/qr.js`;
  - the static `manifest.webmanifest`.

  Help text that coloured the words "green" and "yellow" now uses the zone tokens.
- **`tests/visual.mjs`** (new). Captures 18 screens and compares pixels inside Firefox:
  - auth, dashboards, playbook, basics, Film Room, solutions, season, trivia, My Development, teams,
    help, admin;
  - phone dashboard and playbook, German;
  - playbook with zones and keeper's view, and the 3D replay.

  Everything that could vary is pinned: frozen clock, seeded random, no animations, no outside
  network. It also checks, in real Firefox, that every drawn-by-code token computes to exactly its CSS
  text. Rules learned:
  - capture a build against itself first (0 px, or the harness is lying);
  - capture both builds at the **same address**, because the invite QR code encodes it;
  - never edit files under a running test stack (see below).
- **Smoke `[6i2]`.**
  - The `js/theme.js` fallback equals the CSS, one for one.
  - Every token name code asks for exists (111 names).
  - `THEME.c` returns values, and `data-look` is set.
  - **Zero hard-coded colours** outside tokens and fixed regions, in CSS, `index.html` and JS.
- **Verified** on HEAD (06a6c48) plus exactly these files:
  - baseline against itself 18/18 identical, then the candidate 18/18 identical;
  - smoke 671/671, host server 84 + 17 skipped, image server 101/101;
  - identity 79, auth 153, clubs 127, i18n scan 0;
  - browser 194/194 with zero console errors.
- **Fault-injected** 7 ways, each caught:
  1. a token written with spaces (the capture refuses to continue);
  2. a one-step change, invisible to the eye, to a page colour (`--panel`; every screen flagged);
  3. a one-step change to a board colour (`--pool-2m`, injected in the same capture run as 2);
  4. a hard-coded colour in CSS;
  5. a hard-coded colour in JS;
  6. the fallback drifting;
  7. code asking for a missing token.
- **A test-environment trap, not a code bug.** The browser gate stalled on a reload (twice, same
  spot) after I had edited CSS and JS **in place** under the running nginx stack during the fault
  injections. Unchanged HEAD passed on the same port, and so did the *fresh* candidate stack
  (4/4 and 194/194). Fault-inject on a copy, never on files a running stack serves.

## Phase 1 — Black & Silver chrome

**What changes.** The Black & Silver token set, applied to:
- the top bar, nav, panels, cards, lists;
- buttons (primary becomes the metal gradient), forms, menus, modals, toasts, badges;
- the language switch, the bell panel and the auth screen.

The switch goes in the top bar next to the sound toggle, labelled in EN/DE/FR/IT.

**Tests.** Browser gate runs in **both looks**. The i18n scan stays at 0. A smoke contrast check computes
WCAG contrast for every text token on every surface token, and must meet AA (4.5:1 body, 3:1 large) in
both looks. This is the sunlight guard.

**Done 2026‑09‑15.** Black & Silver is opt-in from the top-bar switch. Today stays the default until Phase 4.

- **Tokens.** `:root[data-look="silver"]` redefines 68 tokens and adds none (a smoke check enforces that).
  - The base set follows the approved sample: `--bg #050506`, `--panel #111214`, `--line #2a2c30`,
    `--ink #eceef1`. `--ink-faint` is raised to `#8b9199`, because the sample's `#6e747d` fails AA.
  - The palette is remapped by formula: navy → graphite 4 points darker, mist → neutral silver at the
    same lightness, sky → muted steel-blue (still tells offense from defense), brand cyan → silver
    lifted 24 points so it still reads as the highlight.
  - Red, green, yellow, orange and violet keep their meaning. Every `-rgb` twin matches its colour in
    each look (smoke).
- **Components.** Only where a token swap would put white text on light silver: `.btn-primary`,
  `.audible-btn` and the avatars take the **metal** gradient with dark ink. The active 3D toggle is metal
  too. There's also an inset highlight on the active tab, and `.icon-btn` gets an ink colour.
- **The switch.** `◐` next to the sound toggle.
  - Its title and aria-label say what the next press does, in EN/DE/FR/IT, and follow a language change.
  - Pressing it shows a toast ("Black & Silver look on").
  - `aria-pressed` reflects the look; the choice is saved per device and survives a reload.
- **Contrast audit (new, `tests/visual.mjs audit <url> <look> [maxFail]`).** On all 18 screens it checks
  every visible text element against the background actually behind it: semi-transparent layers
  composited, a gradient judged by its worst stop, colour emoji skipped.
  - **Black & Silver: 0 below AA** (`maxFail 0`). Getting there took 4 fixes in this look:
    - a deeper `--danger-strong` for the keeper badge and active keeper view;
    - full opacity for `<small>` in table headers;
    - a colour for unstyled links (they were browser-default blue);
    - metal for the active 3D toggle.
- **Today's look.** Unchanged except the switch. The pixel comparison against Phase 0 shows changes only
  inside the top bar (desktop y ≤ 62, phone y ≤ 190) on 17 screens; auth, which has no top bar, is
  identical.
- **Tests.**
  - Smoke +3: the look exists and `theme.js` offers it; a look invents no tokens; `-rgb` twins match
    per look.
  - The colour ratchet now accepts look blocks.
  - `tests/browser.mjs`: `LOOK=silver` runs the whole walkthrough in Black & Silver, setting only the
    *starting* look, so a choice made during the run survives a reload. Browser +3: the switch flips the
    app and relabels, survives a reload, and switches back.
- **Verified** on 7eeda96 plus exactly these files:
  - browser 197/197 in **today** and 197/197 in **silver**, zero console errors;
  - smoke 674/674, i18n scan 0, host server 84 + 17 skipped, image server 101/101;
  - identity 79, auth 153, clubs 127;
  - contrast audit silver 0.
- **Fault-injected** 5 ways, each caught:
  1. the silver look inventing a token;
  2. an `-rgb` twin disagreeing with its colour;
  3. `theme.js` not offering silver;
  4. faint text too dim (the audit fails, 142 below AA);
  5. the switch not saving (reload check fails).

  Two injections first failed to inject: a multi-line `perl -pi` pattern, and a Docker mount on a
  deleted and recreated folder. Both were redone properly.
- **Design check** (captures reviewed): dashboard, playbook, auth and phone dashboard read as Black &
  Silver. The board still shows today's bright cyan water and navy deck, which is Phase 2 by plan.

## Phase 2 — The pool and everything drawn

**What changes.**
- **The board and editor** (`pool.js`, `animate.js`) read water, deck, rope and cap colours from tokens:
  steel-teal water, dark caps with a silver ring, and the 2 m red and 6 m yellow lines unchanged
  (they are rules, not decoration).
- **Film Room board, heat map and charts.**
- **3D replay** (`manikin.js`): the water surface and neutral mannequins.
- **Celebrations** (`fx.js`).
- **Exports** (`videogen.js`, downloads) per decision 3.
- **QR:** stays dark-on-light.

**Tests.** Visual check of the board, 3D and a reel frame in both looks. Existing smoke/browser
checks for the board, cue overlay and 3D stay green.

## Phase 3 — Glass

**What changes.**
- **Where:** glass only on floating controls: the top bar, the full-screen playback bar, the per-player
  cue overlay, the step card, menus and modals.
- **Switch and fallback:** a Glass switch with a solid fallback, which is also used automatically
  where the browser reports "reduce transparency" (Chromium today; Safari doesn't expose it yet as
  far as known, which is why the switch exists).
- **No refraction filter:** it only works in Chromium, so everyone gets the same frosted glass.

**Tests.**
- **Frame rate:** measure frames per second while a play animates, in the browser gate. Glass must
  not drop it below today's.
- **Contrast:** text contrast over the glass stays AA against the brightest water colour.

## Phase 4 — Every screen, sign-off, release

**What changes.** Walk every view in both looks at desktop and phone width:
- dashboard, playbook and editor, basics, Film Room, season, matches, teams and team sheets (paper
  preview stays paper);
- trivia, My Development, announcements, admin, help, auth.

**Found in today's look by the Phase 1 contrast audit (not fixed; today had to stay unchanged):**
- **261** text elements below AA across the 18 screens. The main causes:
  - `--ink-faint` `#647d93` at 3.6–4.0:1;
  - white on the bright teal primary buttons and avatars at 2.54:1;
  - the top bar's **"？" help button rendering black on dark** (1.15:1, `.icon-btn` has no text colour);
  - unstyled links in browser-default blue (1.99:1).

  Black & Silver fixes all of these for its own look. Decide in Phase 4 whether today's look gets the
  same fixes, which would change its pixels.
- Other small leftovers seen while wiring the switch:
  - `.cmd-info` uses `var(--muted)`, which is never defined;
  - the sound toggle's toast says "Sound on" / "Sound off" in English in every language (the i18n scanner
    can't see a toast built from a ternary).

**Already seen at phone width (375 px, today's look, found by the Phase 0 captures):** on the Playbook, the
situation tabs and the Share button run off the right edge, and the "Paused — drag players…" hint is cut
off under the Audible button. It's the existing layout; fix it here.

Fix what's left. Then update the help guide, apply decision 1's default, bump the service worker cache,
and tag a release.

**Gates.** Smoke, server (image), browser (both looks, zero console errors), visual check, contrast
check, and frame-rate check all green. Push and redeploy only on the owner's go.

---

**Working rules** (same as the video pipeline plan):
- Verify on an export of HEAD plus only the phase's files, and fault-inject every new check.
- Another session commits into the same tree: stage only your own files, and re-check HEAD
  before committing.
- No downloads.
