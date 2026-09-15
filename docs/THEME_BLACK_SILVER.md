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
| 2 | The pool and everything drawn: board, animation, Film Room board, 3D, celebrations | M | ☑ done |
| 3 | Glass on floating controls, with a solid fallback | S | ☑ done |
| 4 | Every screen, both looks, phone widths; sign-off and release | M | ☑ done |

## Decisions (owner, 2026‑09‑15)

1. **Default for new users:** Black & Silver. Existing users keep what they last picked. Applied in
   Phase 4, when the look is complete.
2. **Keep "Today":** yes, both looks stay, behind a switch.
3. **Exports follow the viewer's theme:** video reels, PNG/SVG downloads and the PDF booklet are drawn
   in the look the coach is using, so export code reads the same tokens as the screen (Phase 2).
   Open detail: a *printed* PDF booklet in Black & Silver uses a lot of ink. If that matters on paper,
   print could keep a light page while downloads follow the theme; raise it in Phase 2.
   **Decided 2026‑09‑15: white page, diagrams in the look.** The printed booklet keeps its white paper page
   (dark text, normal ink); the play diagrams on it are drawn in whichever look the coach uses.
4. **Glass:** on by default, with a switch.
5. **Navy's contrast (Phase 4):** fix all of it, even though navy's pixels change.
6. **Existing users with no saved look (Phase 4):** they keep navy. A device that already holds Triibholz
   data starts in navy; a new device starts in Black & Silver.

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

**Done 2026‑09‑15.** Every drawn surface follows the look. Today's look is pixel-identical to Phase 1.

- **Silver drawn tokens.** Added to `:root[data-look="silver"]`, from the approved sample:
  - **Board:** obsidian deck `#0b0c0e`, steel-teal water `#136373 → #0a2e36`, silver ripples, goal lines
    and nets, a platinum official table, silver dashed substitution zone.
  - **Caps:** dark caps `#15171b` with a silver ring `#aeb4bc` so they read on dark water; white caps
    `#f2f4f6`.
  - **3D replay:** the same steel-teal water on black, dark caps with silver edges.
  - **Keeper's view:** black goal, silver frame and blockers.
  - **Film Room:** silver corners, heat map and neutral shot marks.
  - **PNG sheet and video reels:** graphite and steel-teal; silver title cards.
  - **Confetti and mascot:** silver and platinum confetti; mascot ink.
  - **Never changes in any look:** the 2 m red, 5 m yellow and 6 m green lines, the ball, the keeper's red
    cap, the green/yellow shot zones and the shot-for/against marks. They carry rules and meaning.
- **Redraw on switch.** SVG and canvas colours are applied when drawn, so `redrawForLook()` (`js/app.js`)
  rebuilds the current view, re-opens the open play, and repaints zones, the keeper's view and the 3D
  replay. Reels, the PNG sheet, SVG downloads and the print booklet's diagrams read the tokens when
  they're made, so they follow the look automatically. The booklet page itself stays paper
  (`theme:fixed`), per the decision above.
- **Consistency fix.** In this look the active **Zones** and **Keeper view** toggles are metal like **3D**,
  instead of green and red; their icons still say which is which.
- **Tests.**
  - `tests/visual.mjs`'s computed-token check is now look-aware: the expected text is read from the
    stylesheet (bare `:root`, overridden by the active look's block), so silver values are verified in
    real Firefox too.
  - Browser +2: the switch redraws the open board in that look (water `#1aa3b0 → #136373`) and back; a
    video-reel frame is painted in whichever look is active (a water pixel within 12 of the gradient).
- **Verified** on c5d0d86 plus exactly these files:
  - today 18/18 pixel-identical to Phase 1;
  - silver differs only on drawn screens (board, zones and keeper's view, 3D, Film Room, phone playbook)
    plus ~100 px of mascot ink on dashboards;
  - contrast audit silver 0;
  - browser 199/199 in **today** and 199/199 in **silver**, zero console errors;
  - smoke 674/674, i18n scan 0, host server 84 + 17 skipped, image server 101/101;
  - identity 79, auth 153, clubs 127.
- **Fault-injected** 3 ways, each caught:
  1. `THEME.c` serving today's values in silver (the capture refuses to continue);
  2. the switch not redrawing (the board water stays `#1aa3b0`);
  3. reel water without silver values (today and silver pixels identical).
- **Design check** (captures reviewed): the playbook board, zones and keeper's view, and the 3D replay read
  as Black & Silver, and the rule lines stay legible on the darker water.

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

**Done 2026‑09‑15.** Glass is part of Black & Silver and on by default (owner decision). Today's look is pixel-identical to Phase 2.

- **Where.** Only what floats over the pool or video, only in Black & Silver:
  - the full-screen playback bar, the "what do I do now?" cue, the keeper's-view panel;
  - the 3D hint, the "Paused — drag players" pill, the Audible sheet;
  - drop-down menus (including the new Look menu) and toasts;
  - plus a tinted top bar.

  Borders keep their meaning (the cue's accent, the keeper view's red). Content panels stay solid.
- **How.** A **dark tint does the legibility work**; the sheen and an 18 px blur make it read as glass. The tint
  is `rgba(12,13,15,.74)`, the lowest opacity that passes (see tests). No refraction filter: it only works in
  Chromium. The tokens (`--glass-tint/-sheen/-blur/-edge/-hi/-bar`) hold the **solid** values in the bare
  `:root`, and `:root[data-look="silver"][data-glass="on"]` holds the glass values. So "glass off" and
  "reduce transparency" both simply fall back to solid.
- **The switch.** ◐ now opens a small **Look menu**: Navy / Black & Silver, Glass on/off, and a note in the
  current language.
  - The glass switch is unavailable in Navy, because it belongs to Black & Silver.
  - When the device asks for less transparency, glass stays solid and the note says why.
  - Both choices are saved per device (`thplay.look.v1`, `thplay.glass.v1`) and applied before the first
    paint (`data-glass` on `<html>`).
  - Escape or a click outside closes the menu.
  - The two Phase 1 button labels were replaced by `ui.lookMenu`, with 12 new strings in EN/DE/FR/IT.
- **Tests.**
  - **Smoke +3.**
    - Text on glass (`--ink`, `--white`, `--ink-dim`, the hint yellow, the cue and hint silvers) must
      stay AA over the silver water, deep water, **a white cap spread into the water by the blur**
      (25 % cap), the deck and a raised panel. Checked with glass on and with the solid fallback. It
      failed at tint .66 (4.08:1 for `--ink-dim` over a blurred cap), so the tint went to .74.
    - `theme.js` offers the glass switch and sets `data-glass`.
    - In a sandbox whose media query reports reduced transparency, glass stays solid even when switched on.
  - **Browser +6.**
    - ◐ opens the menu, shows the current look, switches, and Escape closes it.
    - The look survives a reload, and switches back.
    - Glass is on by default in Black & Silver; switching it off really drops the floating menu's blur.
    - Glass off survives a reload.
    - The glass switch is unavailable in Navy.
    - **Frame rate** while a play animates in full screen: glass on 60 fps vs solid 60 fps. Glass must stay
      ≥ 30 fps and ≥ 80 % of solid.
  - The Phase 1 and 2 checks now switch through the menu. `tests/visual.mjs` gained screen 19: full screen
    with the playback bar.
- **Verified** on a23884d plus exactly these files:
  - today 19/19 identical to Phase 2 (HEAD captured twice first, 19/19);
  - silver changed on every screen as intended: the glass top bar on all, glass surfaces on board screens;
  - contrast audit silver 0 across 19 screens;
  - browser 203/203 in **today** and 203/203 in **silver**, zero console errors;
  - smoke 677/677, i18n scan 0, host server 84 + 17 skipped, image server 101/101;
  - identity 79, auth 153, clubs 127.
- **Fault-injected** 4 ways, each caught:
  1. a tint too thin (2.70:1 over a blurred cap);
  2. `theme.js` ignoring reduced transparency;
  3. glass off keeping the blur;
  4. a stutter while glass is on (22 vs 60 fps).
- **Design check** (captures reviewed): the full-screen bar reads as smoked glass over the moving board; the
  keeper's-view panel shows the pool faintly through it with crisp text.

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

**Found while testing Phase 3 (both looks, not caused by the theme):**
- In full screen at 1360×900, the playbook stage leaves a **white band ~130 px tall** under the control row;
  today's look shows it too.
- `.dl-menu button` uses `var(--text)` and `var(--muted)`, which are never defined (the same kind of
  leftover as `.cmd-info`).

**Already seen at phone width (375 px, today's look, found by the Phase 0 captures):** on the Playbook, the
situation tabs and the Share button run off the right edge, and the "Paused — drag players…" hint is cut
off under the Audible button. It's the existing layout; fix it here.

Fix what's left. Then update the help guide, apply decision 1's default, bump the service worker cache,
and tag a release.

**Gates.** Smoke, server (image), browser (both looks, zero console errors), visual check, contrast
check, and frame-rate check all green. Push and redeploy only on the owner's go.

**Done 2026‑09‑15.**
- **The default look** (decisions 1 and 6). `theme.js startLook()`:
  - a saved look always wins;
  - otherwise, a device holding any other `thplay.*` key is an existing user and gets navy;
  - a device with nothing gets Black & Silver;
  - the answer is saved on the first run, so data the app writes a moment later can't flip a new device
    back to navy;
  - no storage at all stays navy.
- **Navy passes AA** (decision 5): 232 failures on the 19 screens → 0.
  - `--ink-faint` `#647d93` → `#8fa6ba`.
  - White text on teal now sits on `--teal-strong` `#0c7e88` → `--teal-deep` `#0a5f67`: primary buttons,
    avatars, Audible.
  - `--danger-strong` `#c42f2f` for the keeper badge and the active Keeper view; new `--violet-59` for the
    active 3D toggle.
  - Moved from silver-only into the base rules: `.icon-btn` text colour (the black "？"), link colour,
    the team table's `th small` opacity.
  - `--text`, `--muted` and `--border` are defined (aliases of ink, dim ink and line). They had been used by
    about 20 rules but never defined, so some borders never drew.
- **Layout bugs found by the wider sweep** (both looks, not caused by the theme):
  - The top bar was one row. On a 1360 px laptop the language flags, avatar and sign-out sat past the
    right edge, unreachable because the body clips sideways; for a Super Admin that was true even at
    1600 px. From 768 to 1000 px the nav itself ran off the edge.
    - Fix: the bar wraps (controls on a second row), the nav wraps, and the situation tabs share that
      row and scroll below 1240 px.
    - Below 1440 px the account pill is avatar plus sign-out, as on a phone.
    - Why no test caught it: Playwright's click scrolls a clipped element into view, so every click-based
      check passed.
  - The situation tabs were a centred scroller (`justify-content:center`). When the tabs don't fit, that
    clips the start where no scrolling reaches: on a 1100 px laptop "6 on 6" couldn't be reached. They
    are now centred with auto margins.
  - On a phone, the Look menu and announcements opened off the left edge of the screen. `fitMenu()`
    nudges any open drop-down back on screen.
  - On a small laptop, the play's title was squeezed to one word per line beside its buttons. Between 721
    and 1240 px the title now sits above the buttons.
  - On a phone playbook, Share and Edit ran past the edge (the actions wrap), and the "Paused — drag…"
    hint slid under ⚡ Audible (it now wraps short of it).
  - The Season search button stuck out of its card (the input could not shrink). The player card's
    licence-number box was an unstyled white field.
- **Translations.**
  - The i18n guard now reads every literal inside a `toast(…)`, not only a bare first string. That turned
    up 14 English toasts, not just "Sound on/off": test results, confirm/reject, movement saved, template
    on/off, lanes, approval. All are translated (EN/DE/FR/IT), and the ratchet is back to 0.
  - The Help guide's dashboard tips explain ◐.
- **The full-screen "white band"** from Phase 3 is a test artefact, not an app bug. After the Fullscreen API,
  headless Firefox reports `innerHeight` as the screen height (768) while the screenshot stays 900 px.
- **Tests.**
  - **Smoke +3:** the default look (new, existing, glass-only, chosen, unknown, no storage) and the guard
    seeing toast text chosen in code (and not `T()`/`TX()` keys or compared values).
  - **Browser +5:** every top-bar control is on screen at 1360 (Super Admin), 1280 and 768 px, and at
    375 px; the Look menu and announcements open inside a phone screen; the situation tabs scroll from
    their first tab at 1100 px. `dragBy` scrolls its target into
    view first, as a person would (the taller header put the Film Room ball just below the fold).
  - **Visual sweep:** 19 → 38 screens. It adds every other view at phone width, the editor, announcements,
    the Look menu, downloads, the Audible sheet, the new-play chooser, the test-log modal, a 1100 px laptop
    and a 768 px tablet.
- **Service worker cache** v74 → v75.
- **Verified** on an export of 9caf3eb plus exactly these files:
  - smoke 680/680, i18n scan 0;
  - host server 84 + 17 skipped, image server 101/101, identity 79, auth 153, clubs 127;
  - contrast audit **0 in navy and 0 in Black & Silver** across 38 screens;
  - browser **209/209 in navy and in Black & Silver**, and **4 × 209/209 with no look set** (a new device), zero console errors;
  - frame rate 60 fps with glass vs 60 solid.

  The last CSS fix (the tab scroller) touched only CSS and the browser suite, so smoke, the audits, the
  captures and the browser runs were repeated on it. The server suites were not.
- **Fault-injected**, each caught:
  1. the default logic inverted;
  2. the glass key counted as existing data;
  3. the first-run save removed;
  4. the guard's toast pass, comparison stripping and `TX()` stripping each removed;
  5. the top bar and nav not wrapping, plus `fitMenu` disabled (4 browser failures, naming every
     off-screen control);
  6. the centred tab scroller (the first tab 68 px out of reach).
- **Intermittent, not explained:** 2 of 10 browser runs with no look set stalled on a page reload (Playwright's
  30 s timeout), at two different steps: after switching glass off, and after a CSV download. There were no
  such stalls in 8 navy / Black & Silver runs.
  - Four more runs were instrumented to log requests in flight, the load event and any dialog at a stall.
    They all passed, with every reload loading in 0.0–5.5 s.
  - The app has no `beforeunload` handler. A reload stall had been seen once before this phase, too.
  - Treated as a harness flake for now. If it comes back, run `browser.mjs` with the same instrumentation.

---

**Working rules** (same as the video pipeline plan):
- Verify on an export of HEAD plus only the phase's files, and fault-inject every new check.
- Another session commits into the same tree: stage only your own files, and re-check HEAD
  before committing.
- No downloads.
