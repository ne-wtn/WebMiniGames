# Testing record and checklist

## Skyline Stack replacement

Coordinate Grand Prix has been replaced by Skyline Stack, now a hands-on game without typing. `tools/check-skyline.cjs` completes ten floors and four beams through piece buttons, actual mouse dragging, keyboard arrows, mobile touch dragging and a touch-selected roof socket. It rejects wrong blocks, beams and sockets; checks pause, duplicate drops, guidance, saved results, restart and the updated hub; and asserts that no text/number/select controls remain. Desktop, upper-floor, completion and 390 px mobile screenshots are in `tools/skyline-checks/`.

The content tests independently verify 400 generated tower blueprints for support, alignment, scaling, guide-line equations, anchors, rise/run and beam lengths. They require whole-metre positions, three distinct block choices, and exactly one fitting beam/socket combination. Wrong coordinates and widths, non-finite values and every incorrect piece/socket combination must be rejected. The round tests verify the 3/3/4 progression and untimed play. Historical racing results below describe the retired game, not Skyline Stack.

## Mathematics-led progression

Passed `tools/maths-content.test.cjs`: 400 solvable algebra rounds with independently evaluated display labels, 400 tower blueprints, 400 generated factory contracts tested on seven inputs each, 400 feasible construction layouts and 400 fuel-safe rescue missions.

Passed `tools/check-maths.cjs` in Chrome with no uncaught errors: incorrect calculations do not advance their actions; correct blueprints, forecasts, production lines, evidence, flight plans, console outputs and business quotes complete all ten rounds. Recipe and algebra have targeted wrong/correct checks. The mobile invoice form fits 390 px and rejects blank input without recording an attempted answer. Additional checks cover invalid fractions, one-penny errors, stale invoices, guidance attribution, saved maths records and restarting with an old form. These tests use game APIs and supplied or simulated navigation; they do not replace human playtesting. Full details: `MATHS-UPGRADE.md`.

## Startup sequencing and Inter

The initial document is guarded before its first paint. Entrances begin after the used fonts settle, delayed elements keep their initial keyframe, and a failsafe reveals the document if the application script is unavailable or unusually late. Menu entrances use one animated surface; card reflows batch their layout reads before animation writes. Final-score counters reserve their width and begin at zero before painting.

`tools/check-motion-startup.cjs` tests all 11 pages at 1280 px and 390 px with a 4× CPU slowdown and delayed scripts/fonts. It checks first-frame opacity, font readiness, zero layout shifts after revealing, stagger fill, and late/missing-script fallback. Inter is bundled locally and preloaded on each page; `tools/check-motion.cjs` also verifies it loads as the primary UI face.

## Organic motion update

Verified the hub and all ten real game pages in headless Chrome using `tools/check-motion.cjs`:

- Hub filtering and rapid filter changes preserve the right visible games and animate their new positions.
- Real pointer input triggers press ripples; score updates trigger a bounded local particle burst and HUD reaction.
- Every game opens its animated menu, starts through Play, pauses with a frozen clock, resumes, shows result stars and an exact final score, and restarts at zero.
- Hub and game pages fit a 390 px viewport without horizontal page overflow.
- Changing reduced-motion preferences while effects are active cancels them; further actions show immediate final values and visible content.
- No uncaught browser errors. Existing ten-round checks and JavaScript syntax checks also pass.

Score reactions and result states were triggered through the games' real shell methods; these checks do not constitute full ten-round gameplay or manual animation review on physical devices.

## Ten-round progression

- Passed JavaScript syntax checks for all ten game scripts.
- Passed `node math-games/rounds.test.cjs`: all ten round setups per game, easy/medium/hard boundaries, HUD totals, positive timers, and restart to round 1.
- Checked actual completion transitions through round 10 for Recipe Rush, Algebra Adventure, Coordinate Grand Prix, Function Factory, Trigonometry Rescue and Integer Maze.
- Difficulty selectors and the end-screen difficulty action are absent.
- Rendering is stubbed in these tests. Browser visuals, full player-driven playthroughs and ten-round balance have not been re-tested. The records below describe earlier versions.

## Round 2: redesign, shorter instructions and bug fixes

### Bugs fixed in this round

| Game | Bug | Fix | Verified by |
|------|-----|-----|-------------|
| Recipe Rush | There was one shared mixing bowl. If you tapped another ticket, or the selected customer walked out and a new one arrived, Submit compared your bowl with a *different* recipe, so the amounts you had measured did not match the "needed/used" report. Selecting a ticket also didn't redraw the bowl. | Every order now has its own bowl. Switching tickets switches bowls, the bowl is labelled "Bowl for: Pancakes × 8", and a customer who walks out returns their ingredients to the pantry. | Automated: measure order 1 → switch to order 2 (empty bowl) → switch back (bowl intact) → submit = Perfect; walk-out restores the pantry exactly. |
| Algebra Adventure | A too-short bridge left its planks in place, so a wrong answer (e.g. L = 4 on a 5-tile gap) could be jumped across. | Short bridges roll out, flash "TOO SHORT — RETRACTING", then retract. | Automated: 4 planks appear then disappear; x = 3 builds a full bridge that stays. |
| Trigonometry Rescue | Launching level or downward from a landing pad touched down at once but charged the whole leg's fuel. Landing part-way through a leg also kept the fuel for the unflown part. | Take-off from the ground needs a positive angle, and landing early refunds the unflown fuel. | Automated: level launch refused at 100% fuel; a 60 m descent that lands after 40 m costs 40 m of fuel. |
| Trigonometry Rescue | The winch checked "hit the ground" before "reached the person", so a hook within reach of a climber standing on the ground could count as a miss. | The rescue check now comes first. | Code review. |
| Integer Maze | Soft-lock: picking up a decoy orb and then walking over a checkpoint saved an impossible energy value, and Reboot always returned you to it. | Pressing Reboot a second time within 5 s restarts the whole sector. | Automated: first reboot returns to the checkpoint; second restarts the sector with the starting E. |
| Coordinate Grand Prix | During the start lights the target panel said "All target coins for this lap collected". | It now says "Lights out and away we go…" | Visual check. |

The logic of Geometry City, Probability Carnival, Function Factory, Data Detective and Finance Tycoon was re-read in full; no further bugs were found.

### Checks run on all 10 games after the redesign

Start screen with three steps → How to play opens with the full rules folded → Esc closes → Play → timer runs → `P` pauses and freezes the timer → Resume → Restart from the pause menu → timer forced to 0 → end card with stars → Play Again. Each game's display font is confirmed loaded from its own `fonts/` folder. Screenshots were reviewed at 1280×800 and 390×844, with no horizontal scrolling in any game or the hub. **No JavaScript errors were reported.**

The full bot playthroughs listed under round 1 below were **not** re-run in this round.

## Round 1

### What was tested automatically

Every game was driven in **headless Google Chrome** through the Chrome DevTools Protocol. The test scripts clicked the real buttons and sent key events. Where a full playthrough was needed, they also called the game's own action functions (`submitOrder`, `activate`, `approve` and so on). Page errors and `console.error` output were collected; **no uncaught JavaScript errors were reported** in the final runs.

### Checks run on all 10 games

| Check | Result |
|-------|--------|
| Start screen visible on load | ✅ all 10 |
| Instructions open, and close back to the start screen | ✅ all 10 |
| Sound toggles on and off (muted by default) | ✅ all 10 |
| Start Game begins play | ✅ all 10 |
| Countdown runs while playing | ✅ 9/10 run straight away; in Coordinate Grand Prix the clock waits for **Confirm Setup**, by design |
| `P` pauses; the timer is frozen while paused; Resume continues | ✅ all 10 |
| Restart from the pause menu resets the score and state | ✅ all 10 |
| Timer reaching 0 | ✅ 7 games show the end card. Probability Carnival closes the night, Finance Tycoon ends the business day, and the Grand Prix clock hasn't started before setup (all by design and documented) |
| End card shows stars, statistics, the maths summary, Play Again and Main Menu | ✅ |
| Play Again restarts cleanly | ✅ |
| The Main Menu target is the hub (`../index.html`) | ✅ (checked by fetching the target; the pause menu always offers Main Menu) |
| No horizontal page scroll at 1280×800 and 390×844 | ✅ |
| Each game page links only its own `style.css` and `script.js` (no shared files) | ✅ |
| All 10 hub Play links resolve; the topic filter works | ✅ |

### Game-specific playthroughs

| Game | What was verified |
|------|-------------------|
| Recipe Rush | Submitting an empty bowl costs nothing. Exact measures → "perfect" → oven → serve adds score. Wrong measures cost a life. Time-out end card. |
| Algebra Adventure | Running, jumping and landing. Wrong x rejected (−20, charge used); x = 3 builds the bridge, which can be crossed. A door opens on its inequality; a lift docks and carries the player to the ledge. Spikes hurt. The goal advances the world. A brute-force search showed every terminal in all 3 worlds has a valid solution, and each mechanism was crossed with the solved values. |
| Geometry City | A real pointer click places a structure. Delete removes it. Out-of-bounds, protected-tree, lake and overlap placements are rejected. An empty approval costs nothing; a wrong area costs a permit. Resizing to 24 m² passes. All 3 districts were approved, ending with 3 stars. |
| Coordinate Grand Prix | Line equations print correctly (y = 7/4x − 28, x = −3 …). The race clock waits for setup. An autopilot bot completed all 3 races (6 laps). |
| Probability Carnival | E[payout] for the default wheel = 23/12. The wheel animation stops on the sector that was randomly drawn. Test runs are logged. A full 3-night season ran; probabilities for the bag pair (without replacement) and the plinko board were checked. |
| Function Factory | Composite rules print correctly (3n + 2, n² + 2n + 1, 5/2n − 4). An empty line won't run. A wrong rule scraps the batch and consumes materials. All 10 contracts were completed. |
| Data Detective | Locked locations refused; travel costs time; header sort works. A wrong lead costs credibility. Metro filters by station and time window. The **mean-of-outlier trap is rejected** and the **median plus the culprit's gym data is accepted**. Run on several random cases. |
| Trigonometry Rescue | Vertical cable rescue. A vertical cable under the overhang snags; an angled cable rescues. Supply delivery on landing. Flying straight through a peak crashes. Bearing legs rescue both hikers. The mission chain completes. |
| Integer Maze | 180 generated levels in about 0.3 s, with no generation failures. A solver bot escaped the full vault on several different random seeds with 0 short circuits; pulse barriers, lifts, the core meltdown and the exit seal were all exercised. |
| Finance Tycoon | Bulk discount: 100 × 40p − 20% = £32.00. 50 units = £18.00. A loan adds cash. A 12-day bot run was checked by hand against the daily P&L (e.g. day 1: £75.00 revenue − £40.00 costs = £35.00 profit). The final report appeared. |

Bugs found and fixed during testing include:

* **Data Detective:** an unbounded loop in the case generator; the alibi receipt ID was taken after the café rows had been sorted.
* **Integer Maze:** the console was unusable while standing on it; the core-console reference was stale.
* **Coordinate Grand Prix and Function Factory:** mixed-number coefficients were confusing, so they are now shown as improper fractions.
* **Several games:** stacked panels overlapped on phone-sized screens.

## Not tested (please check manually)

- [ ] Real touch devices (phone and tablet): on-screen D-pads and pedals, dragging in Geometry City, sliders in Trigonometry Rescue.
- [ ] Safari (macOS/iOS) and Firefox.
- [ ] Listening to the sound effects (the tests only checked the on/off state).
- [ ] Screen-reader experience beyond labelled buttons and live regions.
- [ ] Playing from `file://` in browsers that restrict `localStorage` for local files (games should play; best scores may not save).

## Manual checklist (per game)

1. The start screen shows the title, a one-line story, three picture steps, the difficulty choice, Play, How to play and Sound.
2. How to play opens and closes (✕, *Got it!* or `Esc`); the full rules open under *Full rules, scoring & maths*.
3. Start; check that the HUD shows the stage, score, timer, lives/resource and progress.
4. Use the core controls (keyboard and touch where relevant).
5. Do something correct and check that points appear with a floating label.
6. Do something wrong and check for a clear message and a deduction or life loss.
7. Use the game's submit/confirm action with an empty or invalid state; nothing should break and there should be no unfair penalty.
8. Pause (`P`, `Esc` or ⏸): everything freezes. Resume, then Restart from the pause menu.
9. Let the timer reach 0, or lose all lives, and check that the end card appears and gameplay has stopped.
10. Complete the game and check the stars against the thresholds in the README.
11. Play Again resets everything; Main Menu returns to the hub.
12. Resize to phone width: no sideways scrolling, and the controls stay reachable.
