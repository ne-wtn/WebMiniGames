# Mathematics-led progression

All ten games now require mathematical decisions at their key actions. Skyline Stack replaces Coordinate Grand Prix with a continuous tower-building game. The ten-round structure remains: three introductory rounds, three intermediate rounds and four advanced rounds, without displaying difficulty labels.

| Game | Changes |
|---|---|
| Recipe Rush | Exact scaling attempts are recorded separately from cooking, patience and lives. Scaling guidance is optional and marks that order as assisted. Randomised orders and percentage/unit-conversion progression remain. |
| Algebra Adventure | Each run creates ten different equation sets while preserving the physically solvable mechanisms. Every terminal must be solved before the portal clears. Live substitution checks require an explicit assistance request for that terminal. |
| Geometry City | Ten parameterised, solvable briefs progress from area/perimeter to volume and surface area/Pythagoras. Live derived measurements are removed. Players calculate their chosen dimensions in a signed blueprint before inspection; edits invalidate the old inspection. Mathematical calculations and spatial constraint checks are recorded separately. |
| Skyline Stack | A hands-on, no-typing playground with Pip the builder. Players select blocks from a tray, drag the crane horizontally and release to drop; arrow buttons/keys and Drop provide alternatives. Vertical landing is automatic, with whole-metre placement. Ten floors progress through matching edges, centring, 3/4 widths, balconies, 80% widths and a line guide. The last four add beam choices with rise/run diagrams, positive/negative lean, diagonal lengths and roof sockets. Drag A to B or use socket/Connect buttons. Wrong pieces and placements are rejected without damaging the tower. There are 14 recorded decisions (ten floors and four beams); guidance and retries are separate from movement and animation. |
| Probability Carnival | Required rounds cover the wheel, single and dependent bag draws, and binomial ball drops. Changing designs requires a committed probability, expected-payout and profit forecast. Each night has a fresh starting design and varying ticket prices. Night goals use expected profit; observed cash remains stochastic and is reported separately. Test runs mark the corresponding forecast as assisted. |
| Function Factory | Ten fresh contracts have generated coefficients and known valid machine compositions, progressing through linear rules, composition, division, negative coefficients and shifted squares. Optional crate inspection is assisted. Exact production results and first attempts are recorded independently of throughput. |
| Data Detective | Players calculate a chosen statistic before pinning a finding. Automatic summary statistics and mean/median answer lines are removed. Evidence still needs to support the correct lead. Later cases increase sample sizes; the last four also use half-centimetre observations. Matching a suspect requires the full sample and a matching statistic. |
| Trigonometry Rescue | Ten generated missions require ordered flight plans, then winch calculations or bearings with wind compensation. Numeric controls support tenths. There is no live endpoint or aiming ray. Submitted endpoints must be within 1.5 m; rejected plans give post-commit feedback without spending flight fuel. Every generated route fits the controls and fuel reserve. A calculator is allowed. |
| Integer Maze | Every console needs a calculated result before it changes energy. All exits require the console to have been verified. Exit values and their number-line markers remain hidden until then, preventing the final answer from being copied into the console. |
| Finance Tycoon | Stock purchases need a verified invoice. A separate daily business quote must be approved before trading; quote topics progress through prices, discounts, profit, break-even, interest, loan comparisons and successive discounts. Empty trading days and timer expiry cannot bypass the calculation. Planning windows allow more time for calculations. |

## Practice records

End cards show independent first-attempt decisions, completed maths decisions, guided decisions and total attempts before the arcade statistics. Topic summaries are stored locally under `mathgames:<game-id>:maths-last` using the existing safe storage wrapper.

"Independent" means without the game's guidance or preview for that decision. It is not a claim about external assistance, mental arithmetic, age, school grade or a validated overall maths level. Wrong attempts remain in the record when a player retries or changes a plan. Empty or malformed input is not counted as an answer. Fractions are accepted, and money is rounded to pence.

The maths prompt is part of the relevant game panel. Its inputs do not trigger movement shortcuts. Reopening or restarting clears prompts, and editing the source plan invalidates stale figures.

## Maintenance and verification

Each game remains self-contained. Edit the common practice UI in `tools/maths-session.js` and `tools/maths-session.css`, then run `node math-games/tools/sync-maths.cjs` from the workspace root. This helper updates all ten games. Skyline Stack keeps the existing `game-04-coordinate-racer/` URL so bookmarks still work, but uses the new `skyline-stack` storage identity; old racing scores do not count toward construction progress.

- `node math-games/rounds.test.cjs` checks round setup and the 3/3/4 presets, including Skyline Stack's untimed construction.
- `node math-games/tools/maths-content.test.cjs` checks 400 generated algebra rounds and their displayed expressions, 400 tower blueprints, 400 factory contracts against additional inputs, 400 feasible geometry layouts and 400 fuel-safe rescue missions. Tower checks independently verify support, alignment, ratios, line equations, anchors, gradients and distances, and reject incorrect or invalid values in every control.
- `node math-games/tools/check-skyline.cjs` runs `check-skyline-play.cjs`. It completes all ten floors and four beams using piece/control buttons, real mouse dragging, arrow keys and mobile touch events. It verifies wrong blocks, wrong beams/sockets, pause, duplicate drops, guidance, saved results, restart, mobile layout, the absence of typing controls and the hub. Screenshots and results are in `tools/skyline-checks/`.
- `node math-games/tools/check-maths.cjs` checks real browser actions, rejection and retry, and ten-round progression for the seven games with new calculation gates or generated production contracts. Recipe and algebra have targeted answer checks. The bot uses game APIs and simulated correct navigation; these are not manual player playthroughs or educational validation.

Browser automation requires an isolated Chrome session with `--remote-debugging-port=9331`. Results are in `tools/maths-checks/results.json`. Physical touch interaction and human balancing still need review.
