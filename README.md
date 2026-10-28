# Maths Arcade — 10 Secondary Maths Games

Each game now has a 10-round run with automatic, unlabelled progression: rounds 1–3 use the easy preset, 4–6 the normal (medium) preset, and 7–10 the hard preset. Players see round progress, with no difficulty selector or mode announcements. Restart begins at round 1. Existing loss conditions still end a run early; Skyline Stack is untimed and allows revisions.

All ten games now have mathematics-led progression, optional recorded guidance, and maths practice results separate from arcade scores. Algebra, construction, factory and rescue problems are generated fresh. Data Detective generates ten cases (each retains its three chapters); Finance Tycoon runs for ten days, with expansions on days 4 and 7. Skyline Stack replaces racing with a no-typing playground: choose blocks, drag and drop the crane, and connect beams across ten untimed floors. See [MATHS-UPGRADE.md](MATHS-UPGRADE.md) for the current game rules and verification.

Run `node math-games/rounds.test.cjs` from the repository's parent directory to check round setup, preset boundaries, timers, HUD counts and restarts. These checks stub rendering; they do not replace browser playtesting.

A collection of ten complete, playable browser games for secondary-school mathematics (roughly ages 11–16). Each game teaches through **actions inside the game**: scaling recipes, setting variables that move platforms, designing prize wheels, wiring production lines, flying a drone with trigonometry. None of them is a quiz.

Everything is plain HTML, CSS and JavaScript. There are no frameworks, build steps, servers, accounts or downloads. Graphics are drawn with Canvas, SVG and CSS, and sounds are generated with the Web Audio API.

## The games

| # | Game | Genre | Mathematics | Folder |
|---|------|-------|-------------|--------|
| 1 | Recipe Rush | Cooking & resource management | Ratio, proportion, fractions, percentages, unit conversion | `game-01-ratio-recipe/` |
| 2 | Algebra Adventure | 2D platformer | Expressions, linear equations, substitution, inequalities, simultaneous conditions | `game-02-algebra-platformer/` |
| 3 | Geometry City | Building & construction simulator | Area, perimeter, volume, surface area, Pythagoras, angles | `game-03-geometry-builder/` |
| 4 | Skyline Stack | 2D tower construction | Coordinates, midpoints, ratio, gradient, distance, equations of lines | `game-04-coordinate-racer/` |
| 5 | Probability Carnival | Arcade & probability simulation | Probability, relative frequency, expected value, dependent events, binomial distribution | `game-05-probability-arcade/` |
| 6 | Function Factory | Production & automation puzzle | Functions, composite functions, linear rules, n-th term of sequences | `game-06-function-factory/` |
| 7 | Data Detective | Investigation & data analysis | Mean, median, mode, range, outliers, sorting/filtering, charts | `game-07-statistics-detective/` |
| 8 | Trigonometry Rescue | Physics & navigation puzzle | Right-angled trigonometry, angles of elevation, bearings, distance | `game-08-trigonometry-rescue/` |
| 9 | Integer Maze | Maze & escape room | Positive/negative integers, number line, integer operations, order of operations | `game-09-integer-maze/` |
| 10 | Finance Tycoon | Business & economic strategy | Percentages, profit & loss, discounts, mark-up/margin, simple interest, budgeting | `game-10-finance-tycoon/` |

## Folder structure

```
math-games/
├── index.html            Game-selection hub (10 cards, topic filter, saved stars)
├── hub.css               Hub styles (each card is drawn in its own game's style)
├── hub.js                Hub cards, filter and progress
├── fonts/                The hub's title font
├── README.md             This file
├── TESTING.md            Test checklist and record of what was tested
├── game-01-ratio-recipe/
│   ├── index.html
│   ├── style.css
│   ├── script.js
│   └── fonts/            This game's typefaces (woff2) and fonts.css
├── game-02-algebra-platformer/   (index.html, style.css, script.js, fonts/)
├── …
└── game-10-finance-tycoon/       (index.html, style.css, script.js, fonts/)
```

**Each game is fully self-contained.** At the client's request there is no `shared/` folder. Every game links only its own `style.css`, `script.js` and `fonts/`, so any game folder can be copied and used on its own.

The standard features every game needs live in a clearly marked block at the top of each game's files, between `/* ===== CORE GAME SHELL (start) ===== */` and `(end)`:

- start screen and instructions
- HUD, timer and pause/resume/restart
- sound
- end card with stars
- best scores

That block is the same in all ten games. The code below it is that game's own rules and mechanics.

## Look and feel

Inter is the primary body and UI font on the hub and all game pages. Its variable WOFF2 and license are bundled in each page's own `fonts/` directory for offline use. Game titles, decorative lettering and maths-specific monospace faces retain their themed typefaces.

The existing layouts include coordinated menu entrances, smooth topic-filter reflow, touch and keyboard press feedback, localized score bursts, round cues, and staggered result stars with a final-score count-up. Motion pauses with the game, cleans up on restart or tab hiding, and respects reduced-motion preferences.

Motion source lives in `tools/motion/`. After editing it, run `node math-games/tools/sync-motion.cjs` from the parent directory to embed the updates into each standalone game and the hub. Players need no build step or additional files.

Each game has its own visual identity and typefaces, chosen to match what the game is about:

| Game | Look | Fonts |
|------|------|-------|
| Recipe Rush | Retro diner: subway tiles, awning HUD, paper order tickets, lined recipe card, chrome ovens | Shrikhand, Caveat, Baloo 2 |
| Algebra Adventure | 16-bit arcade: pixel borders, stepped sky, pixel sprites, green CRT terminal | Press Start 2P, Pixelify Sans, VT323 |
| Geometry City | Architect's blueprint: blueprint plot, drafting sheets, hazard tape, red approval stamp | Big Shoulders Stencil, Architects Daughter, Barlow Semi Condensed |
| Skyline Stack | Sunny toy city, colourful blocks, Pip the builder, a draggable crane and snapping beams | Inter |
| Probability Carnival | Vintage circus poster: tent stripes, ticket-stub tabs, marquee bulbs | Rye, Alegreya Sans |
| Function Factory | 1950s factory floor: diamond plate, machine-green steel, rivets, work orders | Saira Stencil One, Saira Condensed, Share Tech Mono |
| Data Detective | Film-noir case file: desk lamp, folded map, manila folder, cork board | DM Serif Display, Special Elite, Courier Prime |
| Trigonometry Rescue | Alpine rescue cockpit: contour maps, rescue orange, rugged tablets | Michroma, B612, B612 Mono |
| Integer Maze | Synthwave vault: striped sun, perspective grid, neon glass | Monoton, Audiowide, Oxanium |
| Finance Tycoon | Financial broadsheet: pink newsprint, ledger paper, banknote button | Fraunces, IBM Plex Sans Condensed, IBM Plex Mono |

All fonts are from Google Fonts under the SIL Open Font License. They are stored locally in each game's `fonts/` folder (Latin subset), so nothing is downloaded at runtime.

## Running the collection

**Option 1: a local web server (recommended).** In the `math-games` folder run any one of these:

```
python -m http.server 8000
npx serve .
```

Then open <http://localhost:8000/>.

**Option 2: open `index.html` directly.** Double-click `index.html`. The games don't load any modules or remote files, so they also work from `file://`. Some browsers limit `localStorage` for local files, in which case best scores may not be saved; the games still play normally.

No internet connection is needed.

## Features shared by every game

* **Start screen:** artwork, title, a one-sentence story, **three picture steps** that explain how to play, Easy / Normal / Hard, a big Play button, How to play, a sound toggle and the best score. Players can start without reading anything else.
* **How to play:** the goal in one line, the same three steps, the keys, and how to get 3 stars. The full rules (controls, maths, points, failure, timer, star thresholds) are still there for teachers, folded away under *Full rules, scoring & maths*.
* **End card:** title, stars, score and four key stats. The remaining stats, the maths summary and the star thresholds are folded under *More stats & the maths*.
* **HUD:** stage/level, score, countdown timer, lives (or that game's failure resource), a progress bar, a sound button and a pause button.
* **Pause:** the ⏸ button, `P` or `Esc` pauses. The game also pauses automatically if the tab is hidden. Every game runs on a single `requestAnimationFrame` loop owned by the shell, so pausing freezes movement, timers, hazards and animations together. The pause menu has Resume, Restart, Instructions, Sound and Main Menu.
* **Sound:** generated with the Web Audio API. It is **muted until the player turns it on** (button or `M`).
* **Submit / confirm action:** each game has one, and it commits the player's real decisions:

| Game | Action |
|------|--------|
| Recipe Rush | Submit Order |
| Algebra Adventure | Activate Mechanism |
| Geometry City | Approve Construction |
| Skyline Stack | Pick a block, then drag and release or press Drop (untimed) |
| Probability Carnival | Run Attraction |
| Function Factory | Start Production |
| Data Detective | Submit Case Report |
| Trigonometry Rescue | Launch Rescue |
| Integer Maze | Activate Mechanism |
| Finance Tycoon | End Business Day |

* **End-card buttons:** Play Again, Change Difficulty and Main Menu. The game loop stops before the card appears.
* **Scoring:** points come from finite objectives such as orders, mechanisms, gates, contracts and days, so they can't be farmed. Deductions show as red floating labels with a reason (for example "−50 Rejected").
* **Saved progress:** best score and best star rating are saved to `localStorage`, with safe fallbacks if storage is blocked. The hub shows them.
* **Accessibility:** high-contrast text, visible focus rings, labelled buttons, keyboard controls, icons and text alongside colour, `prefers-reduced-motion` support, responsive layouts and on-screen touch controls for the action games.

## Controls and time model per game

| Game | Controls | Failure resource | Time model |
|------|----------|------------------|------------|
| Recipe Rush | Tap tickets, pantry jars and −/+ measures; **S** submits; **1–4** select tickets | Lives (ruined or burnt dishes, walk-outs) | Countdown per stage |
| Algebra Adventure | ←/→ or A/D to move; ↑, W or Space to jump; Q/E change x; Z/C change y; Enter/F activates; R reboots; touch buttons | Lives, plus mechanism charges | Countdown per world |
| Geometry City | Pick a tool (1–6) and drag on the grid; Select (V) to move; arrows / Shift+arrows / R / Delete; Enter approves | Planning permits | Countdown per district |
| Skyline Stack | Choose pieces; drag and release; arrow keys/buttons and Drop; connect A to B | Tower height | Untimed; pause freezes construction |
| Probability Carnival | Design with −/+ (or tap two bins to swap prizes); R runs a wave; T runs a test | Token bank and 3 strikes | Countdown per night; when it ends the night closes |
| Function Factory | Pick a machine, then a slot (or drag); −/+ sets k; ◀ ▶ reorders; Enter starts; C clears | Raw-material crates | Countdown per factory floor |
| Data Detective | Click map locations; sort/filter/select rows; pin findings; attach cards with the drop-downs | Credibility | One investigation clock; travel costs seconds |
| Trigonometry Rescue | Sliders, −/+ buttons, ←/→ angle, ↑/↓ distance (Shift = bigger steps), F facing, Enter launches, W lowers the cable | Fuel and drones | Countdown per mission |
| Integer Maze | Arrows/WASD (hold to repeat); Space/E activates; R reboots to the checkpoint, R again within 5 s restarts the sector; touch D-pad | Shields | Countdown per sector; a short escape countdown after the core overload |
| Finance Tycoon | −10/+10 quantities, Buy, ±10p prices, discount, marketing, bank and upgrade buttons; Enter ends the day | Cash (bankrupt below £0) | 12 business days, each with a planning countdown; when it ends, the day ends |

## Star thresholds

A failed run can still earn 0–2 stars for progress, but 3 stars always need a completed run.

| Game | ★ | ★★ | ★★★ |
|------|---|----|-----|
| Recipe Rush | Clear Stage 1 or finish | Finish with ≥85% average accuracy (failed run that reached Stage 3: 2) | Finish with ≥95% accuracy and ≤1 life lost |
| Algebra Adventure | Clear World 1 or finish | Finish with ≥60% activation accuracy and ≤2 lives lost (failed run with 2 worlds: 2) | Finish with ≥80% accuracy, ≤1 life lost and ≥70% of coins |
| Geometry City | District 1 approved or finish | Finish with ≤3 rejected plans (failed run with 2 districts: 2) | Finish with ≤1 rejected plan and average budget use ≤80% |
| Skyline Stack | Complete all 10 floors | Complete with ≥7 independently correct first decisions | Complete with ≥11 independently correct first decisions |
| Probability Carnival | Finish all nights (or meet 1 goal in a failed run) | Meet ≥2 night goals | Finish, meet all 3 goals, 0 strikes |
| Function Factory | Floor 1 complete or finish | Finish with ≥50% of contracts right first time (failed run with 2 floors: 2) | Finish with ≥80% first-run successes and ≤10% of crates scrapped |
| Data Detective | Chapter 1 solved or case closed | Close the case with ≤1 rejected report (failed run that reached Chapter 3: 2) | No rejected reports and ≥25% of the clock left |
| Trigonometry Rescue | Mission 1 or all missions | All missions with ≤1 crash/abort (failed run with 2 missions: 2) | No crashes/aborts and ≥30% fuel left on average |
| Integer Maze | Sector 1 cleared or escape | Escape with ≤2 shields lost (failed run with 2 sectors: 2) | No shields lost, ≤1 short circuit, ≥60% of data chips |
| Finance Tycoon | Survive 12 days (bankrupt after day 5: 1) | Survive and meet ≥3 of 5 objectives (bankrupt after day 9: 2) | Survive and meet all 5 objectives |

## How the maths drives each game

* **Recipe Rush:** scale factor = servings ordered ÷ servings in the recipe. Stage 2 uses fractional factors. Stage 3 lists amounts in kg, L and cups and adds percentage requests ("25% less sugar"). Accuracy is the percentage error of the worst ingredient.
* **Algebra Adventure:** a bridge length L = f(x) must equal the gap, a lift height must equal the ledge, and doors and lasers need inequalities to be true. A terminal's linked mechanisms activate only if *all* their conditions hold, so they form a system (World 3 uses x and y).
* **Geometry City:** live area, perimeter, volume and surface-area readouts. Costs depend on those measurements. The council checks the actual layout, including adjacency to roads, park coverage percentage and a right-triangle garden with hypotenuse = 5.
* **Skyline Stack:** choose illustrated blocks, drag and drop the crane, and connect beam pieces. Matching edges, equal spaces, fractions, balconies, percentages, a line guide and across/up geometry drive the building. There is no typing. Incorrect pieces can be retried; optional guidance and first attempts are tracked separately across ten floors and four beams.
* **Probability Carnival:** exact probabilities as fractions, E[payout] = Σ p·x, and profit per play = price − E. Runs use real randomness, and the charts compare relative frequency with theory and show convergence. Two draws without replacement, and a binomial ball drop.
* **Function Factory:** machines are functions, and a line of machines is a composite function. After each run, quality control shows the polynomial your line computes. Contracts are given as a rule, a table or a sequence.
* **Data Detective:** every run generates a new case. The final chapter contains an outlier: the mean points to the decoy suspect and the median points to the thief.
* **Trigonometry Rescue:** each leg moves Δx = d cos θ and Δy = d sin θ (bearings: east = d sin b, north = d cos b). Wind drift = speed × time. The angled winch cable lands at (L sin φ, −L cos φ).
* **Integer Maze:** orbs like +(−5) and −(−3), consoles such as (E − 3) × (−2), and gates, lifts and exit seals that test E. Mazes are generated, and the mechanisms are placed along the solution path while the intended E values are simulated, so every maze is solvable.
* **Finance Tycoon:** all money is stored in whole pence (integers). Bulk and promotion discounts are percentages, the demand model uses price elasticity, the daily profit-and-loss statement shows margin, and loans and savings use simple interest I = P·r·t.

## Known limitations

* Testing was automated in headless Chrome (see `TESTING.md`). The games were **not** tested on real phones or tablets, or in Safari or Firefox. Touch controls use standard Pointer Events but haven't been tried on physical touch devices.
* The tests checked that sound toggles on and off and that no errors occur. Nobody listened to the audio itself.
* Integer Maze and Data Detective generate new content every run. Their solvability was checked with bots over many generated levels and several full playthroughs, not every possible seed.
* Game balance (time limits, par times, demand model) was tuned using automated runs plus estimates. Real players may find some levels easier or harder.
* The platformer and racer are best on keyboard; the on-screen controls are functional but basic.
* Best scores are per device and per browser (`localStorage`). There are no accounts or online leaderboards.
