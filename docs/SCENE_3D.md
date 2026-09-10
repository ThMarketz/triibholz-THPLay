# 3D replay camera

## What it is, and what it honestly is not

This is a **stylized broadcast camera over the same 2D tactics data** the flat board already
uses. There is no motion capture, no recorded match footage, and no underwater biomechanics
behind it. A play built by dragging discs on the flat board becomes an orbiting 3D scene of
plain capped mannequins standing at those same positions. It is not a recreation of what a
real swim looks like, and the app never claims otherwise.

## Controls

- **3D 🎥** toggles the camera on any play. Remembered per device.
- **Drag** to orbit, **scroll or pinch** to zoom in on a matchup or pull back to see the whole
  pool, **double-click** to reset the camera.
- **Camera follows…** switches the orbit target: the whole pool, the ball as it travels, or a
  named player. The camera keeps orbiting around whichever you pick while they move.
- Play, pause, step and speed controls are the same ones the flat board uses — 3D is another
  window onto the exact same animation, not a separate player.

## The mannequin

One plain capped figure per player: a rounded head and simple limbs, no facial features, no
gender. Team identity is the same colour convention the flat board already uses: white cap,
dark cap, the keeper's red cap.

## The poses, and where each one comes from

| Situation | Pose |
|---|---|
| Defender inside the green shot-chance zone (`js/shot.js`) | One hand raised straight up to block |
| Defender outside it | A wider stance, shadowing the lane to their own goal |
| Attacker holding the ball | Ball raised and visible in hand |
| Attacker without the ball | Facing the goal, arms out, ready to receive |
| Anyone moving more than ~0.35 m between keyframes | A forward‑reaching swim stroke, oriented along the direction of travel |

Nothing here is invented separately from the tactics: the zone comes from the same `SHOT.zoneAt`
used by the Zones toggle, and who is holding the ball comes from the same `ball.carrier` every
other engine in this app reads. Turning on **Zones** also paints the same green/yellow territory
onto the 3D floor.

## Scope

3D is a **watch‑only** view. Building and adjusting a play, dragging players and the ball, stays
on the flat 2D board, where positions can be placed precisely. 3D is how you look at the result
from any angle afterwards.
