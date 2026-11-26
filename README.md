# 311 Staffing Board

**Live board: https://lstehlik2809.github.io/staffing-board-311/**

A working example of a people-analytics dashboard built to the criteria in Andrew Marritt's
[series on dashboards](https://andrewmarritt.substack.com/p/what-to-do-when-you-have-to-build):
a routine first, control limits always, a forecast only as a range, a written statement the
chart visibly supports, and a test that looks for a decision.

It answers one question for one person: **does tomorrow's contact-centre roster still fit the
forecast?** The data are the agent-handled calls to New York City's 311 line, published daily
on NYC Open Data. Shift staffing is one of the few people-related uses Marritt judges worth a
live display, because demand changes faster than the decision recurs and a quiet board is a
good outcome.

## What is on the board

| Marritt's criterion | Where it is |
|---|---|
| Name the decision, how often, and who acts | Status band: "For the huddle on …"; the routine card names the meeting, the owner and each response |
| A rule for what counts as a signal | Four rules, each with a defined response, a responder and a deadline (`src/model/board.js`) |
| Control limits, not traffic lights | Every day is judged against the range expected the day before; every 7-day total against the range expected a week before |
| Forecast only as a band from a tested model | The forecast is drawn as range bars with no line; the model's out-of-sample track record is on the page |
| Mostly empty | A quiet day reads "No action needed" and four green checks; flagged points are the only loud marks |
| A written statement the chart supports | Chart titles and the headline are sentences; each names the numbers its chart shows |
| LLM writes, code analyses | The language model receives only numbers and verdicts computed by code (`pipeline/narrate.mjs`) |
| State the uncertainty | Verdicts are "within / above / below the expected range", never "up" or "down" |
| Label it and keep a record | Every statement is tagged machine-written; inputs, prompt, raw output and checks are in `public/data/audit/` |
| Test whether it changes decisions | A switch hides the statements; three invented-data scenarios and the read–judge–decide script are on the page |
| Parameters instead of "show me the numbers" | Handle time, shrinkage, service level and roster can be changed; the risk is recomputed in the browser |

## How it works

```
GitHub Actions, daily
  1. fetch      daily calls, top topics and the intraday profile from NYC Open Data (SoQL)
  2. ledger     one model fit per past day, using data up to that day only → honest control limits
  3. fit        the headline Bayesian model (8,000 posterior draws, about 1.5 s)
  4. rules      four signal rules → facts (numbers and verdicts, pre-formatted)
  5. write      OpenAI gpt-6.1-terra (reasoning effort medium) turns the facts into four sentences
  6. check      code verifies every number, verdict phrase and word limit; one retry, else templates
  7. audit      inputs, prompt, raw output, checks → public/data/audit/<run>.json
  8. publish    commit the data, build the site, deploy to GitHub Pages
Browser
  - draws the board from board.json
  - fits the same model again in a Web Worker (same code, same seed) and compares it with the
    published forecast; the staffing risk responds to the reader's assumptions without a server
```

The page has no backend. The API key lives only in the GitHub Actions secret; the language
model is never called from the browser.

### Which language model, and why a mid-size one

The language model only turns pre-computed facts into four sentences, and code checks every
number and verdict before anything is published. On the board's own inputs (the live board
and three scenarios, three runs each) `gpt-6.2-sol`, `gpt-6.1-terra` and `gpt-6-luna` all
passed every check first time; Terra's sentences were as clear as Sol's, while Luna's
"no action" headlines tended to say nothing beyond the verdict. The pipeline uses Terra. To
change it, edit `LLM.model` in `pipeline/narrate.mjs`; the next run rewrites the statements.

### The model

Log daily calls = a slowly drifting level + weekday and holiday effects + a one-day carry-over
+ noise, with separate noise for Monday–Friday, weekends and holidays. A second, wider noise
component absorbs exceptional days (about one in twenty), so they do not widen the range
expected of ordinary days: Shewhart's common and special causes as a mixture.

It is fitted by a blocked Gibbs sampler written in plain JavaScript (`src/model/gibbs.js`):
forward-filter/backward-sample for the level, conjugate draws for everything else, nothing to
tune. The same file runs in Node for the pipeline and in a Web Worker for the page.

"Expected range" means where 99.7% of ordinary days should fall given the data up to the day
before, the equivalent of three-sigma control limits. The limits shown for a past day come
from a fit that saw no data from that day or later (`data/ledger.json`).

### Staffing

Erlang C for one pooled queue, sized for the busiest hour of the day. The roster for a day is
fixed 14 days ahead at the 90th percentile of the forecast made then. The board compares that
roster with today's forecast and reports the chance that the requirement exceeds it. Handle
time, service level and shrinkage are illustrative assumptions, not NYC 311's figures.

### Look

The page is styled as a daily bulletin: a masthead with the two dates that scope everything,
a lead story whose verdict is the largest type on the page, headlines with bylines, and
column rules instead of boxes. Written statements are set in Newsreader and everything
computed in Public Sans, so the typeface itself says which is which. The palette is
[this Color Hunt set](https://colorhunt.co/palette/f0e5cff7f6f2c8c6c64b6587) with data tints
derived from its ink blue; status colours are separate. Details and the reasoning are in
`docs/design-contract.md`.

## Run it locally

```
npm install
npm run pipeline:no-llm     # fetch, fit, write template statements (no API key needed)
npm run dev                 # open http://localhost:5173
npm test
```

With machine-written statements (Node 20.6 or later for `--env-file`):

```
node --env-file=.env pipeline/run.mjs            # .env holds OPENAI_API_KEY=...
node --env-file=.env pipeline/scenarios.mjs      # rebuild the invented-data scenarios
```

`node pipeline/run.mjs --offline` reuses the last fetch. The first run fits about 1,900 models
for the forecast ledger (roughly 80 seconds on a laptop); later runs fit 25.

## Publish on GitHub Pages

1. Push this folder to a GitHub repository (default branch `main`).
2. Repository → Settings → Secrets and variables → Actions → add `OPENAI_API_KEY`.
   Optional: `SOCRATA_APP_TOKEN` for a higher NYC Open Data rate limit.
3. Repository → Settings → Pages → Source: **GitHub Actions**.
4. Actions → "Daily refresh and deploy" → Run workflow. After that it runs every day at 11:30 UTC.

A push to `main` only tests and deploys the board as committed; the scheduled and manual runs
fetch new data, write new statements and commit them. Without the secret the board still
refreshes, with rule-based sentences labelled as such.

## What it does not do

- **It is a demonstration.** Nobody at NYC 311 uses it; the routine, thresholds and staffing
  assumptions are illustrative. Marritt's first requirement, a real meeting with a real owner,
  cannot be met by a public demo. The board shows what that routine would need to contain.
- **The count is incomplete.** NYC notes that since March 2020 the dataset does not fully
  represent agent-handled calls. Read the level as an index of demand.
- **It does not explain.** It says when a number is outside its expected range, not why.
- **Staffing is simplified.** One queue, one peak hour, no abandonment, no skills, no intraday
  roster shape.
- **Holidays on weekends are not modelled**, nor are observed-holiday Fridays and Mondays.
- **The statements have not been tested on users.** The page contains the test; running it
  with three planners is the step that would show whether the sentences change decisions.

## Layout

```
src/model/        the model, the rules, the facts and the template sentences (shared by pipeline and page)
src/components/   the page
src/worker/       the in-browser fit
pipeline/         fetch, forecast ledger, analysis, statement writing and checks, scenarios
public/data/      board.json, scenarios, audit records (what the page reads)
data/ledger.json  as-of forecasts behind the control limits and the track record
tests/            model recovery, calibration, Erlang C, rules, statement checks
docs/             design contract and metric definitions
```

## Credits

Design criteria: Andrew Marritt, *Working Ideas* (November 2026). Data: NYC Open Data,
[311 Call Center Inquiry](https://data.cityofnewyork.us/City-Government/311-Call-Center-Inquiry/wewp-mm3p).
