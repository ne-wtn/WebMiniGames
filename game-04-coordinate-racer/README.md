# Skyline Stack

A self-contained, hands-on 2D tower-building game starring Pip. Open `index.html` directly or through a local server. The legacy folder name preserves existing links; the game and saved progress use `skyline-stack`.

One run constructs ten floors in a single tower:

- Floors 1–3: choose blocks and match left/right edges or centre them.
- Floors 4–6: choose 3/4 widths, make balconies and use 80% widths.
- Floors 7–10: follow a line guide and connect beams using across/up steps, left/right slope direction, diagonal lengths and roof sockets.

There are no typing controls. Pick a block from the tray, drag the hanging block sideways and let go to drop. All positions snap to whole metres; vertical landing is automatic. Arrow buttons/keys and Drop offer alternatives. Choosing a block changes its actual width. The translucent landing shadow shows where the current block will go, not whether it is correct.

For the last four floors, choose a beam from illustrated pieces, then drag from A to B/a roof socket or use the socket and Connect buttons. Beam length and across/up geometry determine its drawn endpoint and whether it fits. A floor cannot advance until its required beam is connected. Incorrect drops/connections leave completed construction safe and allow a retry.

Construction is untimed. Pause freezes the crane, camera and landing animation. Optional guidance marks only the current floor/beam decision as assisted. There are 14 decisions: ten blocks and four beams. Each awards 100 points for an independently correct first attempt, 75 after retries or 50 with a hint. Completion earns one star, seven independent first decisions earn two and eleven earn three. End cards show the separate maths practice record.

Block colours affect appearance only. The camera follows the tower and whole-tower view fits it. On mobile the play area stays visible while the piece tray scrolls. Reduced motion shortens transitions and removes landing compression.

Checks from the workspace root:

```
node math-games/rounds.test.cjs
node math-games/tools/maths-content.test.cjs
node math-games/tools/check-skyline.cjs
```

The browser check requires isolated Chrome on debugging port 9331. It writes screenshots and results to `math-games/tools/skyline-checks/`.
