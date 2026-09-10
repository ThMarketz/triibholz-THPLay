# Shot zones, the shot step, and the keeper's view

## What the colours mean

| Zone | Where | Shown as |
|---|---|---|
| **Green** | Inside 4 m of the goal **and** no more than 1 m outside either post | ~70 % |
| **Yellow** | Out to 7 m **and** up to 2 m outside either post | ~30 % |
| **Red** | Everything else | under 10 % |

Toggle them with **Zones 🟩** in the playbook controls. They are painted into the board's own
SVG layer (under the arrows and the players), so they line up with the goal at any window size,
and the choice is remembered per device.

## These percentages are a coaching guide, not a measurement

This matters enough to say plainly. There is **no published water polo dataset that gives a
probability for a spot on the pool.** What the literature does support:

| Claim | Value | Source |
|---|---|---|
| Penalty conversion | ~80–87 % of penalties taken | Graham & Mayberry 2014 (0.87, 95 % CI 0.75–0.94), 45 elite men's matches |
| Man-up (exclusion) conversion | ~48 % (winners ~58 %, losers ~40 %) | Graham & Mayberry 2014, 45 elite men's matches |
| Even-play conversion | ~24 % | Graham & Mayberry 2014 |
| By tactic | counter 38 %, centre 26 %, direct shot 25 %, perimeter 20 % | Graham & Mayberry 2014 |
| **A defender in the shooting lane** | **0.432 → 0.335**, a 22 % relative drop (p = 0.006) | Lupo et al. 2020, 886 World-Championship shots |
| Elite keeper save rate | ~45–60 % of shots faced | Escalante et al. 2012 |
| Lob shots | 1–7 % of all shots, and less successful overall than a drive shot | Lupo et al. 2020 |

Two things are **not** established, and the app labels them as coaching shapes wherever it shows
them rather than presenting them as measurements:

- **Distance and angle coefficients.** The widely circulated "15 % per metre, 2 % per degree"
  comes from *association football* (Pollard, Ensum & Taylor 2004), not water polo. The app
  therefore uses distance only as a decay on the lob figure, and never as a conversion curve.
- **The lob against an advanced keeper.** The coaching case is coherent and universal, but it has
  never been measured against a control in any published water polo study. The lob percentage in
  the keeper's view is built from a keeper-distance term and a range decay; the panel says so in
  its own caveat line, and it is deliberately coarse (5 % steps).

Overall elite conversion itself ranges from 22 % to 46 % across studies, purely because of how a
"shot" is counted. So the 70/30/10 bands express **relative territory quality** the way a coach
teaches it. They are labelled as such on the board and in the keeper's view.

## The shot step

A play now says where it finishes. Mark a keyframe as the shot in the editor (tick
*"Step N: 4 shoots"* beside the ball carrier) or with the **Take the shot** / **Lob over the
keeper** audibles. The marker is `frame.shot = { by, kind:'shot'|'lob' }`; it survives download,
share links and import. The board draws a dashed shot line and a target ring, and the focused
player's cue says "shoot".

## The keeper's view

**Keeper view 🧤** projects the keeper and every defender in the lane onto the 3 m goal mouth as
seen from the shooter, and reports:

- how much of the cage is open, and where the biggest gap is;
- how many defenders are in the lane;
- how far the keeper is off the line;
- distance and angle to goal;
- a shot and a lob estimate, rounded to 5 % so it never implies precision it does not have.

The estimate is: zone band, minus 10 points for a blocked lane (15 with a crowd — Lupo measured
the blocked-lane effect as ~10 points absolute, 0.43 → 0.34, not 10 points per defender), scaled
by the keeper's coverage of the sight line and weighted down because that plan-view projection
overstates a real block: the cage is only 0.9 m tall and shooters beat a set keeper high, low and
into the corners. Man-up is applied when the play's own situation is 6v5 or 5v4 — never inferred from disc counts,
so a 3v2 fast break is not mistaken for a power play. A penalty override exists in the model
(`SHOT.chance(frame, {situation:'penalty'})` returns the ~80 % rate) and is used by tests; the
board does not apply it automatically, because a play does not record that it is a penalty. A lob only becomes attractive once the keeper is off the
line, and decays with range.

## Board geometry note

The board is drawn anisotropically: 10.88 units per metre across (25 m pool over 272 units) but
8 units per metre down. The goal mouth is drawn on the *across* scale, so zones, distances and
angles here all use `POOL.pxPerM` on both axes — that keeps the zones in proportion with the goal
they are drawn against.
