# Design contract

Working specification for the 311 Staffing Board. Assumptions are marked; the routine,
thresholds and staffing figures are illustrative because no real team owns this demo.

## Audience and purpose

- **Primary user:** the duty workforce planner of a contact centre (assumed), at a ten-minute
  daily staffing huddle, on a desktop screen.
- **Purpose:** operational. Refreshed once a day, early morning New York time.
- **Primary decision:** does tomorrow's roster (and the six days after) still fit the forecast,
  or do we call in the flex pool / offer time off? Recurs daily.
- **Supporting questions:** Was the latest day unusual? Has the last week shifted? Is any call
  topic behaving differently?
- **Next action and owner:** defined per rule in `ROUTINE` (`src/model/board.js`): response,
  responder, deadline.
- **Cost of a wrong reading:** acting on noise (overtime paid for nothing) or missing a real
  shift (queues). The board is built to stay quiet unless a rule fires.
- **Viewport:** desktop first (1280 px and wider); reflows to one column below 1080 px.
- **Non-goals:** explaining causes; intraday management; a full workforce-management system;
  exploration of the raw data.

## Reading journey

1. **Orient** — header: what is counted, data to which day, which day is being planned.
2. **Assess** — status band: one sentence, and four rules each marked Clear or Fired with its evidence.
3. **Compare** — daily calls against the range expected the day before; required agents against rostered agents.
4. **Investigate** — 7-day totals for all calls and each topic; select a panel for its numbers; tables behind every chart.
5. **Act, or decide no action is needed** — a fired rule shows who responds, by when, and how.

A second audience, public visitors, needs to know what the board is before any of that makes
sense. They get one dismissible "What is this?" line under the masthead (hidden for good once
dismissed, so the planner's view stays clean) pointing to "The idea in brief" at the start of
the Reference section: the argument from Marritt's series, why staffing, a demo disclaimer,
and a map from each requirement to the part of the board that shows it, with jump links.

## Metric dictionary

| Metric | Definition | Grain / time | Comparison | Quality notes |
|---|---|---|---|---|
| Calls per day | Count of rows in NYC Open Data `wewp-mm3p` (agent-handled calls to 311) by `date` | One row per call; New York local date; the newest date is dropped unless its records run past 23:00 | Range expected the day before (0.135%–99.865% predictive quantiles for an ordinary day) | NYC states the data under-count handled calls since March 2020. A day with no rows, or under 25% of its usual weekday level, is treated as missing (never zero) and listed on the page |
| Expected range | Posterior predictive interval of the model fitted with data up to the origin day only | One day ahead for daily charts; seven days ahead for 7-day totals | — | Three-sigma equivalent: an ordinary day falls outside about once a year. Out-of-sample coverage is reported on the page |
| Middle half | 25%–75% predictive quantiles | as above | — | Replaces a forecast line |
| 7-day total | Sum of calls over seven consecutive days ending on the last complete day | Rolling window, recomputed daily | Range expected from the day before the window | A window containing a missing day is marked incomplete and not judged |
| Topic calls | Calls by `inquiry_name` | The 24 highest-volume topics of the last 91 days whose 5th-percentile daily volume over a year is at least 20 | as 7-day total | A topic with no rows on a day that has data counts as zero for that day |
| Agents required | Erlang C agents on the phones for the busiest hour ÷ (1 − shrinkage) | Per day; busiest-hour share from the last 8 weeks by day type | Agents rostered | Assumptions: 5-minute handle time, 80% answered in 30 s, 30% shrinkage. Not NYC 311's figures |
| Agents rostered | Agents required at the 90th percentile of the forecast made 14 days before the day | Per day | — | Illustrative roster rule; moves with the assumptions |
| Shortfall risk | P(agents required > agents rostered), including the small chance of an exceptional day | Per day, next 7 days | Action threshold 25% (illustrative) | Printed as a whole percent; "under 1%" / "over 99%" at the ends |

Disclosure: the data describe calls, not people. No individual employee or caller is shown.

## Panel plan

| Priority | User question | Measure + comparator | Visual | Why here | Detail |
|---|---|---|---|---|---|
| Primary | Do I need to act? | Four rules: fired or clear | Sentence + rule list | First thing read at the huddle | Each fired rule shows response, responder, deadline |
| Primary | Was the latest day unusual, and what is expected next? | Calls vs expected range | Range bars with dots; forecast as bars only | Largest panel: 51 days need the width | Tooltip, keyboard, table |
| Primary | Does the roster fit? | Required agents (range) vs rostered | Interval bars with a roster marker, risk as text | Beside the volume chart: same days continue | Assumption controls, table |
| Supporting | Has anything shifted over a week, and where? | 7-day totals vs expected range | Small multiples, flagged panels emphasised | Full width below | Selecting a panel opens its chart and table in place, directly under that panel's row and joined to it like a tab; Escape or Close returns focus to the panel |
| Reference | What happens when a rule fires? Can I trust the sentences and the model? | Routine, audit, track record | Three cards | Below the fold: read once, then on demand | Audit JSON, model details |

Controls: demo tools (view, statements on/off, theme) sit in the small edition line, not in
the planner's reading path. Four staffing assumptions and the model seed and priors change
the lead story as well as the staffing chart, so whenever any of them differs from the
published board a notice at the top lists what changed and offers one reset. When a setting
changes a fact a published sentence was written from, that sentence is replaced by a
rule-based one and labelled. While the model re-samples, the previous result stays on
screen, dimmed, so numbers never mix two states.

The chance of a shortfall is the number the decision turns on, so it has its own encoding:
a meter on a shared 0–100% scale with the action threshold as a reference line, beside the
required-versus-rostered comparison on a shared agents scale.

## Design direction

- **Metaphor: a daily bulletin** (medium intensity). One sheet of paper with a masthead, the two dates that scope everything in its corners, a lead story whose verdict is the largest type on the page, headlines that state the point, bylines that say who wrote each sentence, and column rules instead of boxes. It fits the argument the board is built on: an authored statement first, the chart as its evidence. Plain labels stay everywhere; nothing in a chart is decorated.
- **Palette:** [Color Hunt f0e5cf·f7f6f2·c8c6c6·4b6587](https://colorhunt.co/palette/f0e5cff7f6f2c8c6c64b6587). Paper `#F7F6F2` (the sheet), cream `#F0E5CF` (lead story, weekend shading, hovers), ink blue `#4B6587` (data). Text and data tints are steps of the ink blue (`#151C26` text, `#222E3E` recorded calls, `#7387A1` middle half, `#B3BFCD` expected range). Status colours are separate and reserved: alert `#B3372F`, ok `#2F6B3A`, watch `#7A5200`.
- **Type:** [Newsreader](https://fonts.google.com/specimen/Newsreader) for written statements (masthead, verdict, headlines), [Public Sans](https://fonts.google.com/specimen/Public+Sans) for everything computed (labels, numbers, axes, tables). The split carries meaning: serif is a sentence someone wrote, sans is data.
- **Motion (minimal):** hover and focus feedback; bars slide when an assumption changes; a short fade when the view changes; charts dim while the model re-samples. No count-ups, nothing loops, all of it off under reduced-motion.

## Visual roles

- Surfaces: sheet, cream band, raised (tooltips, inputs). Ink: primary, secondary, muted. Rules: strong (section), hairline (column, grid).
- Data: recorded calls (dark dot), expected range (light bar with capped ends), middle half (darker bar), roster (ink marker), meter fill and track for the chance of a shortfall.
- Status: alert (outside range / act), watch (over-rostered, incomplete, stale, reader's own settings), ok. Always with a word and a shape; never used for data identity.
- Type: six sizes in rem (label, small, body, standfirst, headline, verdict), so the reader's text-size setting applies; chart margins scale with it. Tabular figures in tables and axes.
- Shape: one 3px radius for controls and notices; sections have none.

## Acceptance tasks (for the read–judge–decide test)

1. State what the board monitors and which day is being planned.
2. Read the calls on the latest day.
3. Say whether that day was unusual, and point to the evidence.
4. Say what, if anything, to do before tomorrow, and who does it.
5. Find the exact 7-day total for one topic and return to the overview.
6. Say what limits trust in the numbers.

Not yet run with representative users.
