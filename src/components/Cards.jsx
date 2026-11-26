import React, { useState } from 'react';
import { IconOk, IconAlert, jumpTo } from '../lib/ui.jsx';
import { fmtDay, fmtDayLong, diffDays } from '../model/calendar.js';
import { fmtInt } from '../model/format.js';

// Reference columns: read once, then on demand. They are set quieter than the
// stories above them: no headline type, no boxes, smaller text.

const pct = (a, n) => (n ? `${Math.round((100 * a) / n)}%` : '—');
const nyTime = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'America/New_York', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const SERIES = [
  ['Dashboards without decisions', 'https://andrewmarritt.substack.com/p/dashboards-without-decisions'],
  ['The hidden costs of dashboards', 'https://andrewmarritt.substack.com/p/the-hidden-costs-of-dashboards'],
  ['What to do when you have to build a dashboard', 'https://andrewmarritt.substack.com/p/what-to-do-when-you-have-to-build'],
];

// Each of Marritt's requirements, what this board does about it, and where to see it.
const IDEAS = [
  ['A routine first', 'Four rules, each with a defined response, an owner and a deadline.', 'The routine', 'routine-h'],
  ['Control limits, not traffic lights', 'Every day is judged against the range the model expected the day before.', 'Daily calls', 'vol-h'],
  ['A forecast only as a band', 'The bars after the line are forecast ranges; no line is drawn to second-guess.', 'Daily calls', 'vol-h'],
  ['A sentence the chart visibly supports', 'Machine-written from numbers computed in code, checked by code, labelled and logged.', 'How the statements are written', 'audit-h'],
  ['Test whether it changes decisions', 'Hide the statements and use invented scenarios for a read–judge–decide test.', 'Test it before you trust it', 'test-h'],
  ['A model you can check', 'The Bayesian model is fitted again in your browser and compared with the published forecast.', 'Is the forecast any good?', 'model-h'],
];

/** The story behind the board, for visitors: why it exists and where each idea shows up. */
export function IdeaInBrief({ live }) {
  return (
    <section className="idea" aria-labelledby="idea-h">
      <div className="idea-story">
        <p className="kicker">The idea in brief · about a minute to read</p>
        <h2 id="idea-h">Most HR dashboards shouldn’t be built. This one tries to earn its place.</h2>
        <p>
          In a three-part series on dashboards in people analytics, Andrew Marritt argues that most HR dashboards fail a
          simple economic test: their data changes more slowly than the decisions they are meant to support, and every
          reader is left to interpret the numbers alone, noise included. When a dashboard is built anyway, he says, it needs
          a routine around it, control limits, forecasts shown only as a band, and a sentence on each chart saying what it
          shows. A language model may write that sentence, but only if the numbers come from code, the uncertainty is
          stated, the text is labelled, and someone tests whether it changes decisions.
        </p>
        <p>
          This board is a working example of all of it. It answers one question for a contact-centre planner: does
          tomorrow’s roster still fit the forecast? Shift staffing is one of the few people-related uses where Marritt thinks
          a live display can pay off, because demand changes faster than the roster decision, and a quiet board is a good
          outcome.
        </p>
        <p className="idea-note">
          {live
            ? 'It runs every day on live NYC 311 call data, but it is a demonstration: NYC 311 does not use it, and the routine, thresholds and staffing assumptions are illustrative.'
            : 'You are looking at invented data for a usability test. The live board runs every day on NYC 311 call data; NYC 311 does not use it, and the routine, thresholds and staffing assumptions are illustrative.'}
        </p>
        <p className="idea-note">
          Read the series:{' '}
          {SERIES.map(([title, href], i) => (
            <React.Fragment key={href}>{i > 0 && ' · '}<a href={href}>{title}</a></React.Fragment>
          ))}
        </p>
      </div>
      <div className="idea-map">
        <p className="kicker">Where each idea shows up</p>
        <ul>
          {IDEAS.map(([idea, how, where, id]) => (
            <li key={idea}>
              <span className="i-name">{idea}</span>
              <span className="i-how">{how}</span>
              <button className="btn link" type="button" onClick={() => jumpTo(id)}>{where} ↓</button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function RoutineCard({ routine }) {
  return (
    <section className="ref" aria-labelledby="routine-h">
      <h2 id="routine-h">The routine around this board</h2>
      <p className="lede">Illustrative. A real team agrees the meeting, the owner and the responses before any chart is drawn.</p>
      <dl className="kv">
        <dt>Meeting</dt><dd>{routine.meeting}</dd>
        <dt>Owner</dt><dd>{routine.owner}</dd>
        <dt>Quiet day</dt><dd>{routine.quiet}</dd>
      </dl>
      <ol className="routine">
        {routine.rules.map((r) => (
          <li key={r.id}>
            <div className="r-name">{r.name}</div>
            <div className="r-rule">Fires when: {r.rule.charAt(0).toLowerCase() + r.rule.slice(1)}</div>
            <div className="r-resp">Response: {r.response}</div>
            <div className="r-who">{r.responder} · {r.deadline}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}

const CHECKS = [
  'Every number in a sentence, in digits or in words, appears character for character in the inputs.',
  'The verdict phrase matches the rule outcome (within, above or below the expected range).',
  'The chart headlines name the day, the count and the range that the chart shows.',
  '“No action needed” must be followed by its evidence: the latest day’s calls and the highest shortfall risk, each with its day.',
  'Each result is stated once: no “none are outside; all are within”.',
  'No causes, no trend words, and no advice beyond a rule’s defined response.',
  'Word limits are respected; one retry, then a rule-based sentence is published instead.',
];

export function AuditCard({ narrative, facts, base, id }) {
  const llm = narrative.source === 'llm';
  return (
    <section className="ref" aria-labelledby="audit-h" id={id}>
      <h2 id="audit-h">How the statements are written</h2>
      <p className="lede">
        A language model writes the sentences; it does no analysis. The statistical model and the rules, in code, decide what is unusual.
      </p>
      <dl className="kv">
        <dt>Written by</dt>
        <dd>{llm ? `${narrative.model}, reasoning effort ${narrative.reasoningEffort}` : `Rule-based template${narrative.reason ? ` — ${narrative.reason}` : ''}`}</dd>
        <dt>Written at</dt>
        <dd>{nyTime(narrative.generatedAt)} New York time</dd>
        <dt>Attempts</dt>
        <dd>{narrative.attempts || 0}{narrative.checksFailedBeforePublish ? `; ${narrative.checksFailedBeforePublish} checks failed before the published version` : llm ? '; all checks passed first time' : ''}</dd>
        <dt>Prompt</dt><dd>version {narrative.promptVersion}</dd>
      </dl>
      <ul className="checks" aria-label="Checks run by code before a sentence is published">
        {CHECKS.map((c) => <li key={c}><IconOk size={16} /><span>{c}</span></li>)}
      </ul>
      <details>
        <summary>Inputs the language model received</summary>
        <pre>{JSON.stringify(facts, null, 2)}</pre>
      </details>
      <p className="small" style={{ marginTop: 10 }}>
        <a href={`${base}data/${narrative.auditFile}`}>Full audit record for these statements</a> (inputs, prompt, raw output, checks) ·{' '}
        <a href={`${base}data/audit/index.json`}>all records</a>
      </p>
    </section>
  );
}

export function ModelCard({ board, fit, fitCfg, setFitCfg, verification, defaultCfg }) {
  const [seed, setSeed] = useState(String(fitCfg.seed));
  const cov = board.coverage;
  const res = fit.result;
  const running = fit.status === 'running';
  const isDefault = fitCfg.seed === defaultCfg.seed && fitCfg.priors === 'default';
  const run = (next) => setFitCfg({ ...fitCfg, ...next, nonce: (fitCfg.nonce || 0) + 1 });
  return (
    <section className="ref" aria-labelledby="model-h">
      <h2 id="model-h">Is the forecast any good?</h2>
      {cov ? (
        <>
          <p className="lede">
            Track record of forecasts made with data up to {fmtDay(cov.firstOrigin)}–{fmtDay(cov.lastOrigin)} only, compared with what then happened.
          </p>
          <div style={{ overflowX: 'auto' }}>
          <table className="data">
            <thead>
              <tr><th>Days ahead</th><th>Days checked</th><th>Inside middle half<br />(should be 50%)</th><th>Inside 90% range</th><th>Inside expected range</th></tr>
            </thead>
            <tbody>
              {Object.entries(cov.byHorizon).map(([h, c]) => (
                <tr key={h}><td>{h}</td><td>{c.n}</td><td>{pct(c.in50, c.n)}</td><td>{pct(c.in90, c.n)}</td><td>{pct(c.inLimits, c.n)}</td></tr>
              ))}
              <tr><td>7-day total</td><td>{cov.week.n}</td><td>{pct(cov.week.in50, cov.week.n)}</td><td>{pct(cov.week.in90, cov.week.n)}</td><td>{pct(cov.week.inLimits, cov.week.n)}</td></tr>
            </tbody>
          </table>
          </div>
        </>
      ) : (
        <p className="lede">No track record is shown for invented data.</p>
      )}

      <h2 style={{ marginTop: 16 }}>Fitted again in your browser</h2>
      {running && (
        <>
          <p className="lede">Sampling the Bayesian model on {board.series.counts.length} days of data…</p>
          <div className="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round((fit.fraction || 0) * 100)}><i style={{ width: `${Math.round((fit.fraction || 0) * 100)}%` }} /></div>
        </>
      )}
      {fit.status === 'error' && <p className="lede">The model could not be fitted here: {fit.message} The board shows the published numbers.</p>}
      {fit.status === 'done' && res && (
        <ul className="checks">
          <li><IconOk size={16} /><span>{fmtInt(res.draws)} posterior draws in {(res.ms / 1000).toFixed(1)} s, with no server.</span></li>
          <li>
            {res.diag.ok ? <IconOk size={16} /> : <IconAlert size={16} />}
            <span>Convergence checks {res.diag.ok ? 'passed' : 'flagged'}: largest R-hat {res.diag.maxRhat.toFixed(3)} (limit {res.diag.rhatLimit}), smallest effective sample {Math.round(res.diag.minEss)} (limit {res.diag.essLimit}).</span>
          </li>
          {isDefault && verification && (
            <li>
              {verification.match ? <IconOk size={16} /> : <IconAlert size={16} />}
              <span>
                {verification.match
                  ? `Same forecast as the published one (largest difference ${(verification.maxDiff * 100).toFixed(1)}%), so the statements describe what you see.`
                  : `This browser’s forecast differs from the published one by up to ${(verification.maxDiff * 100).toFixed(1)}%. Statements that depend on it are replaced by rule-based sentences.`}
              </span>
            </li>
          )}
          {!isDefault && <li><IconAlert size={16} /><span>You are viewing your own fit (seed {fitCfg.seed}, {fitCfg.priors} priors). The forecast and the staffing risk come from it; statements they affect are rule-based.</span></li>}
        </ul>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 10 }}>
        <label htmlFor="seed">Random seed</label>
        <input id="seed" value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, '').slice(0, 9))} inputMode="numeric"
          style={{ width: 84, padding: '4px 8px', border: '1px solid var(--rule)', borderRadius: 3, background: 'var(--raised)' }} />
        <label htmlFor="priors" className="sr-only">Priors</label>
        <select id="priors" value={fitCfg.priors} onChange={(e) => run({ priors: e.target.value, seed: +seed || defaultCfg.seed })}>
          <option value="default">Published priors</option>
          <option value="wider">Wider priors</option>
        </select>
        <button className="btn" type="button" disabled={running} onClick={() => run({ seed: +seed || defaultCfg.seed })}>Sample again</button>
        {!isDefault && <button className="btn link" type="button" onClick={() => { setSeed(String(defaultCfg.seed)); run({ seed: defaultCfg.seed, priors: 'default' }); }}>Back to the published fit</button>}
      </div>
      <details>
        <summary>The model and what it estimated</summary>
        <p style={{ marginTop: 8 }}>
          Log daily calls = a slowly drifting level + weekday and holiday effects + a one-day carry-over + noise. Noise is
          estimated separately for Monday–Friday, weekends and holidays. About one day in twenty is allowed to be exceptional,
          so those days do not widen the range expected of ordinary days. Fitted by a Gibbs sampler
          ({board.model.sampler.chains} chains, {fmtInt(board.model.sampler.draws)} draws each after {board.model.sampler.warmup} warm-up).
        </p>
        <table className="data">
          <thead><tr><th>Quantity</th><th>Median</th><th>90% interval</th></tr></thead>
          <tbody>
            {(res ? res.params : board.posterior.params).map((p) => (
              <tr key={p.key}><td>{p.label}</td><td>{p.q50.toFixed(3)}</td><td>{p.q05.toFixed(3)} to {p.q95.toFixed(3)}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="small" style={{ marginTop: 8 }}>
          Effects are on the log scale: −0.10 is about 10% fewer calls than a Monday. Priors: effects Normal(0, 1); noise variances Inverse-Gamma(2, 0.005);
          daily drift Inverse-Gamma(50, 0.005), informative on purpose; share of exceptional days Beta(50, 950), informative on purpose.
        </p>
      </details>
    </section>
  );
}

export function Notes({ board, base, scenarios, setView, showStatements, setShowStatements }) {
  const s = board.source;
  const live = board.mode === 'live';
  return (
    <>
      <div className="two-col">
        <section className="ref" aria-labelledby="notes-h">
          <h2 id="notes-h">Data and definitions</h2>
          {live ? (
            <ul className="plain">
              <li><b>Source.</b> <a href={s.page}>{s.name}</a>, {s.publisher}. One row per agent-handled call to New York City’s 311 line. Read daily; this board holds data to {fmtDayLong(board.asOf)}.</li>
              <li><b>Known gap.</b> {s.caveat} Treat the level as an index of demand, not as a full count.</li>
              <li><b>Latest day.</b> The source’s newest date is usually partial, so the board stops at the last complete day{board.lastRecordAt ? ` (latest record: ${board.lastRecordAt.replace('T', ' ')})` : ''}. This edition was refreshed {diffDays(board.runDate, board.asOf)} days after that day; the days in between are shown as forecasts, bracketed as “data not yet published”.</li>
              <li><b>Days left out.</b> {board.excluded.length === 0 ? 'None in the two years used.' : `${board.excluded.length} in the two years used (${board.excluded.slice(-4).map((x) => fmtDay(x.date)).join(', ')}${board.excluded.length > 4 ? ', …' : ''}): no record, or under 25% of the usual level, which is treated as an incomplete record and never as zero demand.`}</li>
            </ul>
          ) : (
            <ul className="plain">
              <li><b>Invented data.</b> {board.scenario.description} Nothing here describes NYC 311.</li>
            </ul>
          )}
          <ul className="plain">
            <li><b>Expected range.</b> Where 99.7% of ordinary days should fall according to the model, given data up to the day before: the equivalent of three-sigma control limits. An ordinary day lands outside about once a year.</li>
            <li><b>Middle half.</b> The central 50% of that range. No forecast line is drawn: the forecast is a range.</li>
            <li><b>Topics.</b> The {board.topics.length} highest-volume call topics of the last 13 weeks that are answered every day of the week (at least 20 calls on a quiet day). Their 7-day totals are judged against the range expected a week earlier.</li>
            <li><b>Staffing.</b> One pooled queue, sized by Erlang C for the busiest hour of the day ({(board.staffing.peakShare.weekday * 100).toFixed(1)}% of a weekday’s calls). Rosters are fixed {board.staffing.assumptions.lockDays} days ahead at the 90th percentile of the forecast made then. Handle time, service level, shrinkage and the 25% action threshold are assumptions, not NYC 311’s figures.</li>
            <li><b>Not causes.</b> The board says when a number is outside its expected range. It does not say why.</li>
          </ul>
        </section>
        <section className="ref" aria-labelledby="test-h">
          <h2 id="test-h">Test it before you trust it</h2>
          <p className="lede">Show the board to three people who would use it and ask, in this order:</p>
          <ol>
            <li><b>Read.</b> How many calls were there on the latest day?</li>
            <li><b>Judge.</b> Is that unusual? What makes you say so?</li>
            <li><b>Decide.</b> What will you do differently because of this screen?</li>
          </ol>
          <p style={{ marginTop: 8 }}>
            Before: what were you doing when you reached for it? After: what do you do next? Silence at “decide” is the finding.
            Run it once with the written statements and once without{' '}
            (<button className="btn link" type="button" onClick={() => setShowStatements(!showStatements)}>{showStatements ? 'hide the statements' : 'show the statements'}</button>),
            and use invented data so nobody argues about the numbers:
          </p>
          <ul className="plain">
            {scenarios.map((sc) => (
              <li key={sc.id}><button className="btn link" type="button" onClick={() => setView(sc.id)}>{sc.title.charAt(0).toUpperCase() + sc.title.slice(1)}</button> — {sc.summary}</li>
            ))}
            {!live && <li><button className="btn link" type="button" onClick={() => setView('live')}>Back to live data</button></li>}
          </ul>
        </section>
      </div>
      <p className="colophon">
        Model {board.model.version} · built {nyTime(board.generatedAt)} New York time ·{' '}
        <a href={`${base}data/${live ? 'board.json' : `scenarios/${board.scenario.id}.json`}`}>every number on this page as JSON</a>
        {' '}· set in Newsreader and Public Sans
      </p>
    </>
  );
}
