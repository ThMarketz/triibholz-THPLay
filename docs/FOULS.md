# Fouls in the playbook — what the commands teach, and the rules behind them

Rules cited from the World Aquatics Competition Regulations, Part Six (Water Polo), the edition in
force from 25 June 2025, plus the World Aquatics TWPC referee interpretations for the 2025 rules.

## Ordinary foul → free throw

- An ordinary foul is punished by a **free throw to the opposing team** (Art. 8.1).
- The free throw is taken **at the location of the ball** (Art. 11.1). It is moved to the 2 m line
  only when the ball is inside the **goal area** — the 2 m zone marked in red — not, as is often
  taught, anywhere inside 6 m.
- The thrower must put the ball into play **without undue delay**, and may pass, carry, dribble,
  fake or shoot. The fouling defender must move **at least 1 metre away** before raising an arm to
  block; failing to is "interference" (Art. 11.2).

## The clock — say it precisely

- **Both clocks stop at the whistle** and restart when the ball leaves the thrower's hand
  (Art. 4.1); possession is measured in "actual play" (Art. 8.12).
- **An ordinary foul never resets the shot clock.** The possession clock resumes at exactly the
  value it froze at — ordinary fouls are not in the exhaustive reset list of Art. 8.12.

So "draw a foul to stop the clock" is half true. It buys a pause, uncontested possession and a
metre of space. It does not buy extra possession time. The app says it that way.

## Where a defensive foul is legal — and where it is not

| Situation | Ruling |
|---|---|
| Impede the ball-carrier in a settled attack (body on, no hold) | Ordinary foul. No personal foul, no limit. This is the **Ordinary foul on the ball-carrier** command. |
| **Hold, sink or pull back** an opponent who is not holding the ball | **Exclusion** (Art. 9.8/9.9) — 18 s, not a free throw |
| Foul **to stop the flow of the attack**, especially a counter | **Exclusion** — this is the "tactical foul" of Art. 9.11, anywhere in the pool |
| Any foul inside 6 m where a goal would probably have resulted | **Penalty** (Art. 10.2) |
| Impeding an attacker **from behind** inside 6 m while they are facing goal in a shooting action | **Penalty** (Art. 10.11) |
| Deliberately pushing the ball inside 6 m to deny a direct shot | **Penalty** (Art. 10.10 b) |

## Drawing a foul in attack

Art. 8.9 and Art. 9.8/9.9 all concern an opponent **not holding the ball**, and "holding" excludes
dribbling — which is why the **Draw the ordinary foul** command insists you dribble in rather than
pick the ball up. The two sanctions are not the same, and the difference is worth a man-up:

| What the defender does to a player not holding the ball | Sanction |
|---|---|
| **Impedes** or prevents free movement (Art. 8.9) | Ordinary foul — free throw |
| **Holds, sinks or pulls back** (Art. 9.8/9.9) | **Major foul — 18 s exclusion** |

## Direct shot from the free throw

- A goal may be scored from **an immediate shot from a free throw taken by a player outside 6 m**
  (Art. 7.2 d). Per the World Aquatics TWPC 2025 interpretation, it is the **location of the ball**
  outside 6 m that decides.
- There is **no "continuous motion" clause**. Either shoot immediately, or visibly put the ball
  into play and then fake, dribble and shoot — no second player has to touch it.
- Since 2025, a free throw awarded **inside** 6 m no longer needs a pass either: the player may put
  the ball into play, swim it outside 6 m and shoot (Art. 7.2 f).
- Known documentation conflict: Appendix 3's "Direct shot" definition still requires player, ball
  **and** foul outside 6 m. Article 7.2 plus the TWPC interpretation are the operative text; the
  appendix was not updated.

## Current timings (25 June 2025)

Possession 28 s · second possession 18 s · exclusion 18 s · quarters 8 min · 6 m line ·
field 25 m (men and women alike).

## Going under the water yourself

The board can show a player **under the surface** — the "cheeky hiding" move: an attacker sinks
behind their marker's shoulder to break the line of sight and then bursts, or ducks so a cross-pass
travels over them to the far post. A defender does it less often, to disguise a double-team on the
centre or to steal from underneath.

**That is legal, and it is the opposite of the foul above.** Sinking *yourself* is a swimming
decision. Holding, sinking or pulling back *an opponent* is a major foul and an 18-second exclusion
(Art. 9.8/9.9). The two look similar on a whiteboard and are a whistle apart in the water, so the
editor's own hint says which one it is drawing.

How it is drawn, in `js/pool.js`: the disc fades and its edge goes dashed as the player goes down,
and a ripple ring stays at the surface where they went under. Depth is a number from 0 to 1 that
rides on the player's position (`u`), so it interpolates between steps — a player *sinks* rather
than popping under — and it survives a share link, a `.thplay.json` export and a colleague's import.

**What it deliberately does not do is animate a swimming stroke.** `js/manikin.js` states that no
motion capture and no underwater biomechanics exist for this game anywhere in this project; the 3D
mannequins have no legs and float at the surface. A plausible-looking underwater stroke would be the
app asserting something nobody has measured. Depth and a ripple are what the data supports.

The 3D scene does not show it yet. The mannequin model is already built for it — its origin is the
water surface with +Y up — but the scene fills the water and *then* paints every mannequin over it,
so a submerged body would float on top. Doing it properly means splitting the mannequins at the
surface and adding a semi-transparent glaze pass between them.
