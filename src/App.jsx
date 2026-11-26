import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULTS, WIDER_PRIORS } from './model/config.js';
import { addDays, diffDays, fmtDay } from './model/calendar.js';
import { staffingOutlook, evaluateSignals, buildFacts } from './model/board.js';
import { templateStatements } from './model/statements.js';
import VolumeChart from './components/VolumeChart.jsx';
import StaffingPanel, { SERVICE_LEVELS } from './components/StaffingPanel.jsx';
import TopicsGrid from './components/TopicsGrid.jsx';
import StatusBand, { Byline } from './components/StatusBand.jsx';
import { RoutineCard, AuditCard, ModelCard, Notes, IdeaInBrief } from './components/Cards.jsx';
import { jumpTo } from './lib/ui.jsx';

// The "What is this?" line under the masthead is for first-time visitors; once
// hidden it stays hidden for that browser (a convenience, so failures are ignored).
const ABOUT_KEY = 'staffing-board:about-hidden';
const readAboutHidden = () => { try { return window.localStorage.getItem(ABOUT_KEY) === '1'; } catch { return false; } };
const storeAboutHidden = () => { try { window.localStorage.setItem(ABOUT_KEY, '1'); } catch { /* private mode: hide for this visit only */ } };

const BASE = import.meta.env.BASE_URL;
const nyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const withYear = (iso) => `${fmtDay(iso)} ${iso.slice(0, 4)}`;

const readHash = () => {
  const q = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return { view: q.get('view') || 'live', statements: q.get('statements') !== 'off' };
};

// What each chart is, in plain words. Shown as the title when statements are off.
const NEUTRAL = {
  volume_title: 'Daily calls and the range expected the day before',
  staffing_title: 'Agents required and agents rostered over the next days',
  topics_title: '7-day call totals: all calls and the highest-volume topics',
};

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

const idOf = (b) => `${b.mode}|${b.scenario ? b.scenario.id : 'live'}|${b.generatedAt}`;
const defaultsOf = (b) => {
  const a = b.staffing.assumptions;
  const sl = SERVICE_LEVELS.find((s) => s.slTarget === a.slTarget && s.answerSec === a.answerSec) || SERVICE_LEVELS[1];
  return { ahtSec: a.ahtSec, shrinkage: a.shrinkage, sl: sl.key, rosterAdjust: 0 };
};

export default function App() {
  const initial = useMemo(readHash, []);
  const [view, setView] = useState(initial.view);
  const [showStatements, setShowStatements] = useState(initial.statements);
  // Light by default, whatever the system setting; Dark and Auto (follow the system) on request.
  const [theme, setTheme] = useState('light');
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [params, setParams] = useState(null);
  const [fitCfg, setFitCfg] = useState(null);
  const [fit, setFit] = useState({ status: 'idle', result: null, boardId: null });
  const workerRef = useRef(null);
  const [aboutHidden, setAboutHidden] = useState(readAboutHidden);

  // ---- view state in the URL, so a test scenario can be shared as a link
  useEffect(() => {
    const q = new URLSearchParams();
    if (view !== 'live') q.set('view', view);
    if (!showStatements) q.set('statements', 'off');
    const hash = q.toString();
    window.history.replaceState(null, '', hash ? `#${hash}` : window.location.pathname + window.location.search);
  }, [view, showStatements]);

  useEffect(() => {
    const onHash = () => { const h = readHash(); setView(h.view); setShowStatements(h.statements); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    getJson(`${BASE}data/scenarios/index.json`).then(setScenarios).catch(() => setScenarios([]));
  }, []);

  // ---- load the board (live or an invented-data scenario)
  useEffect(() => {
    let cancelled = false;
    setError(null);
    const url = view === 'live' ? `${BASE}data/board.json` : `${BASE}data/scenarios/${view}.json`;
    getJson(url).then((b) => {
      if (cancelled) return;
      setBoard(b);
      setParams(defaultsOf(b));
      setFitCfg({ seed: b.model.sampler.seed, priors: 'default', nonce: 0 });
    }).catch((e) => { if (!cancelled) { setBoard(null); setError(e.message); } });
    return () => { cancelled = true; };
  }, [view]);

  // ---- fit the model in a worker: same code, same seed as the pipeline
  useEffect(() => {
    if (!board || !fitCfg) return undefined;
    if (workerRef.current) workerRef.current.terminate();
    const worker = new Worker(new URL('./worker/fit.worker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    const boardId = idOf(board);
    const id = `${boardId}|${fitCfg.seed}|${fitCfg.priors}|${fitCfg.nonce}`;
    // While a new fit runs, keep the previous one for this board on screen (dimmed),
    // so the numbers never fall back to a different state halfway through.
    setFit((f) => ({ status: 'running', fraction: 0, result: f.boardId === boardId ? f.result : null, boardId }));
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.id !== id) return;
      if (m.type === 'progress') setFit((f) => (f.status === 'running' ? { ...f, fraction: m.fraction } : f));
      else if (m.type === 'done') setFit({ status: 'done', result: m, boardId });
      else if (m.type === 'error') setFit({ status: 'error', message: m.message, result: null, boardId });
    };
    worker.onerror = (e) => setFit({ status: 'error', message: e.message || 'the worker failed to start.', result: null, boardId });
    worker.postMessage({
      id,
      series: board.series,
      settings: {
        ...board.model.sampler, seed: fitCfg.seed, kappa: board.model.kappa,
        priors: fitCfg.priors === 'wider' ? WIDER_PRIORS : board.model.priors,
      },
      planningDay: board.planningDay,
      horizon: DEFAULTS.horizon,
      outlookDays: board.staffing.outlook.length,
      rules: board.staffing.rules,
    });
    return () => worker.terminate();
  }, [board, fitCfg]);

  const defaultCfg = useMemo(() => (board ? { seed: board.model.sampler.seed } : null), [board]);
  const fitted = board && fit.boardId === idOf(board) ? fit.result : null;

  // ---- everything that depends on the reader's settings, recomputed by the same rule code
  const live = useMemo(() => {
    if (!board || !params) return null;
    const sl = SERVICE_LEVELS.find((s) => s.key === params.sl) || SERVICE_LEVELS[1];
    const st = { ...board.staffing.assumptions, ahtSec: params.ahtSec, shrinkage: params.shrinkage, slTarget: sl.slTarget, answerSec: sl.answerSec };
    const forecast = fitted ? fitted.forecast : board.forecast;
    const outlook = fitted
      ? staffingOutlook({ basis: fitted.basis, locked: board.staffing.locked, peakShare: board.staffing.peakShare, st, rules: board.staffing.rules, rosterAdjust: params.rosterAdjust })
      : board.staffing.outlook;
    const day = board.pastDays[board.pastDays.length - 1];
    const week = board.weeks.blocks[board.weeks.blocks.length - 1];
    const signals = evaluateSignals({ day, week, outlook, topics: board.topics });
    const outside = board.pastDays.filter((d) => d.status === 'above' || d.status === 'below');
    const nextDay = forecast.find((f) => f.date === board.planningDay) || null;
    const facts = buildFacts({
      asOf: board.asOf, planningDay: board.planningDay, day, week,
      pastWindow: { days: board.pastDays.length, outside }, nextDay, outlook, topics: board.topics, signals, rules: board.staffing.rules,
    });
    // A published sentence stays only while the facts it was written from are still the facts on screen.
    const same = JSON.stringify(facts.staffing) === JSON.stringify(board.facts.staffing)
      && facts.overall === board.facts.overall
      && JSON.stringify(facts.triggered_rules) === JSON.stringify(board.facts.triggered_rules);
    const published = board.narrative.statements;
    const tpl = templateStatements(facts);
    const statements = same ? published : { ...published, headline: tpl.headline, staffing_title: tpl.staffing_title };
    return { forecast, outlook, signals, facts, statements, changed: !same };
  }, [board, params, fitted]);

  const verification = useMemo(() => {
    if (!board || !fitted || fit.status !== 'done') return null;
    let maxDiff = 0;
    board.forecast.forEach((f, i) => {
      const g = fitted.forecast[i];
      if (!g) return;
      f.q.forEach((v, k) => { maxDiff = Math.max(maxDiff, Math.abs(g.q[k] - v) / Math.max(1, v)); });
    });
    return { maxDiff, match: maxDiff <= 0.01 };
  }, [board, fitted, fit.status]);

  if (error) {
    return (
      <div className="wrap"><div className="loading" role="alert">
        The board could not be loaded ({error}).{' '}
        {view !== 'live' && <button className="btn link" type="button" onClick={() => setView('live')}>Back to live data</button>}
      </div></div>
    );
  }
  if (!board || !live || !params || !fitCfg) return <div className="wrap"><div className="loading" role="status">Loading the board…</div></div>;

  const isLive = board.mode === 'live';
  // "Today" is the reader's real date on the live board, and the scenario's own date on invented data.
  const today = isLive ? nyToday() : board.runDate;
  const stale = isLive && diffDays(today, board.planningDay) > 0;
  const lagDays = Math.max(0, Math.min(diffDays(today, board.asOf), board.forecast.length));
  const lastForecastDay = addDays(board.planningDay, board.staffing.outlook.length - 1);
  const defaults = defaultsOf(board);
  const busy = fit.status === 'running' && !!fitted;

  // ---- which of the reader's settings differ from the published board
  const changes = [];
  if (params.ahtSec !== defaults.ahtSec) changes.push(`handle time ${(params.ahtSec / 60).toFixed(1)} min`);
  if (params.shrinkage !== defaults.shrinkage) changes.push(`shrinkage ${Math.round(params.shrinkage * 100)}%`);
  if (params.sl !== defaults.sl) changes.push(`service level ${params.sl.replace('/', '% in ')} s`);
  if (params.rosterAdjust !== 0) changes.push(`roster ${params.rosterAdjust > 0 ? '+' : '−'}${Math.abs(params.rosterAdjust)} agents`);
  if (fitCfg.seed !== defaultCfg.seed) changes.push(`model seed ${fitCfg.seed}`);
  if (fitCfg.priors !== 'default') changes.push('wider priors');
  const resetAll = () => {
    setParams(defaults);
    if (fitCfg.seed !== defaultCfg.seed || fitCfg.priors !== 'default') setFitCfg({ seed: defaultCfg.seed, priors: 'default', nonce: (fitCfg.nonce || 0) + 1 });
  };

  const title = (key) => (showStatements ? live.statements[key] : NEUTRAL[key]);
  const byline = (key) => (showStatements
    ? <Byline narrative={board.narrative} provenance={live.changed && key === 'staffing_title' ? 'custom' : board.narrative.source} />
    : null);
  const goAudit = () => { const el = document.getElementById('audit'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  return (
    <div className="wrap">
      <header>
        <div className="masthead">
          <p className="ear">Data to<b>{withYear(board.asOf)}</b></p>
          <h1>311 Staffing Board</h1>
          <p className="ear right">Planning<b>{withYear(board.planningDay)}</b></p>
        </div>
        <div className="edition">
          <span>
            {isLive ? 'Daily edition · NYC 311 agent-handled calls' : 'Test edition · invented contact centre'} · refreshed{' '}
            {new Date(board.generatedAt).toLocaleString('en-GB', { timeZone: 'America/New_York', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} New York time
          </span>
          <div className="tools" role="group" aria-label="Demo tools">
            <span>Demo tools</span>
            <label>View
              <select value={view} onChange={(e) => setView(e.target.value)}>
                <option value="live">Live data</option>
                {scenarios.map((s) => <option key={s.id} value={s.id}>Invented: {s.title}</option>)}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={showStatements} onChange={(e) => setShowStatements(e.target.checked)} />
              Written statements
            </label>
            <label>Theme
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                <option value="light">Light</option><option value="dark">Dark</option><option value="auto">Auto (system)</option>
              </select>
            </label>
          </div>
        </div>
      </header>

      {!aboutHidden && (
        <div className="about-strip">
          <span>
            <b>What is this?</b> A working example of a people-analytics dashboard built to Andrew Marritt’s criteria for the few dashboards worth having, on live NYC 311 data.
          </span>
          <button className="btn link" type="button" onClick={() => jumpTo('idea-h')}>Read the idea in brief ↓</button>
          <button className="btn link hide" type="button" onClick={() => { setAboutHidden(true); storeAboutHidden(); }} aria-label="Hide this introduction">Hide</button>
        </div>
      )}

      {!isLive && (
        <div className="notice" role="note">
          <span><b>Invented data.</b> Scenario “{board.scenario.title}”: {board.scenario.summary} A fixed test case for usability sessions; the dates and numbers are fictional.</span>
          <button className="btn" type="button" onClick={() => setView('live')}>Back to live data</button>
        </div>
      )}
      {stale && (
        <div className="notice" role="alert">
          <span><b>Out of date.</b> This board was last refreshed on {fmtDay(board.runDate)} with data to {fmtDay(board.asOf)}; its planning day has passed. Do not use it for today’s roster.</span>
        </div>
      )}
      {changes.length > 0 && (
        <div className="notice" role="status">
          <span><b>Your settings, not the published board:</b> {changes.join('; ')}. {live.changed ? 'Sentences that depend on them are now rule-based.' : 'The published sentences still match these numbers.'}</span>
          <button className="btn" type="button" onClick={resetAll}>Reset</button>
        </div>
      )}

      <main className="fade" key={idOf(board)}>
        <StatusBand board={board} live={live} statement={live.statements.headline} provenance={live.changed ? 'custom' : board.narrative.source} showStatements={showStatements} onHow={goAudit} />

        <div className="columns">
          <section className="story" aria-labelledby="vol-h">
            {showStatements && <p className="kicker">Daily calls · six weeks and the forecast</p>}
            <h2 className="headline" id="vol-h">{title('volume_title')}</h2>
            {byline('volume_title')}
            <p className="chart-sub">
              Each bar is the range expected for that day from the data up to the day before. Bars after the line are forecasts to {fmtDay(lastForecastDay)}, made from data to {fmtDay(board.asOf)}
              {lagDays > 0 ? `; the bracket marks the ${lagDays === 1 ? 'day' : `${lagDays} days`} already here whose data is not yet published.` : '.'}
            </p>
            <div className={busy ? 'busy' : undefined}>
              <VolumeChart pastDays={board.pastDays} forecast={live.forecast} asOf={board.asOf} planningDay={board.planningDay} outlookDays={board.staffing.outlook.length} today={today} />
            </div>
          </section>

          <section className="story" aria-labelledby="staff-h">
            {showStatements && <p className="kicker">Staffing · next {board.staffing.outlook.length} days</p>}
            <h2 className="headline" id="staff-h">{title('staffing_title')}</h2>
            {byline('staffing_title')}
            <p className="chart-sub">Agents needed at the busiest hour against a roster fixed two weeks ahead, and the chance that the roster falls short.</p>
            <StaffingPanel
              outlook={live.outlook} planningDay={board.planningDay} lockedFrom={board.staffing.lockedFrom}
              params={params} setParams={setParams} defaults={defaults}
              ready={!!fitted} busy={busy} threshold={board.staffing.rules.shortfallProb}
            />
          </section>
        </div>

        <section className="story" aria-labelledby="topics-h">
          {showStatements && <p className="kicker">7-day totals · all calls and {board.topics.length} topics</p>}
          <h2 className="headline" id="topics-h">{title('topics_title')}</h2>
          {byline('topics_title')}
          <p className="chart-sub">
            Calls in each of the last {board.weeks.blocks.length} seven-day periods, each judged against the range expected a week before. Every panel has its own scale, which does not start at zero. Select a panel to open its chart and numbers right below it.
          </p>
          <TopicsGrid weeks={board.weeks} topics={board.topics} />
        </section>

        <div className="reference">
          <IdeaInBrief live={isLive} />
          <p className="kicker ref-kicker">Reference · how this board works</p>
          <div className="ref-cols">
            <RoutineCard routine={board.routine} />
            <AuditCard narrative={board.narrative} facts={board.facts} base={BASE} id="audit" />
            <ModelCard board={board} fit={{ ...fit, result: fitted }} fitCfg={fitCfg} setFitCfg={setFitCfg} verification={verification} defaultCfg={defaultCfg} />
          </div>
          <Notes board={board} base={BASE} scenarios={scenarios} setView={setView} showStatements={showStatements} setShowStatements={setShowStatements} />
        </div>
      </main>
    </div>
  );
}
