import React from 'react';
import { IconOk, IconAlert, IconPen } from '../lib/ui.jsx';
import { fmtDay } from '../model/calendar.js';
import { fmtInt, fmtRange, fmtProb, plural } from '../model/format.js';

/**
 * Who wrote a sentence — printed under every statement, like a byline.
 * The lead story carries the full version; chart headlines a short one.
 */
export function Byline({ narrative, provenance, full = false, onHow }) {
  let text;
  if (provenance === 'custom') text = 'Rule-based sentence for your settings (no language model)';
  else if (narrative.source !== 'llm') text = 'Rule-based sentence (no language model)';
  else if (full) text = `Machine-written by ${narrative.model} from the numbers on this page; every number checked by code`;
  else text = 'Machine-written, checked by code';
  return (
    <p className="byline" title={narrative.reason || undefined}>
      <IconPen />{text}
      {onHow && <> · <button className="btn link" type="button" onClick={onHow}>how it was written</button></>}
    </p>
  );
}

/** One line of evidence per rule: brief when clear, complete when fired. */
function evidence(id, fired, { day, week, outlook, topics, rules }) {
  if (id === 'staffing') {
    const rated = outlook.filter((r) => r.shortfallProb != null);
    if (!rated.length) return 'No roster on file for the next days.';
    const short = outlook.filter((r) => r.status === 'shortfall');
    const surplus = outlook.filter((r) => r.status === 'surplus');
    if (short.length > 2) {
      const top = short.reduce((a, b) => (b.shortfallProb > a.shortfallProb ? b : a));
      return `${short.length} of the next ${outlook.length} days at or above ${fmtProb(rules.shortfallProb)}; highest ${fmtProb(top.shortfallProb)} on ${fmtDay(top.date)} (add ${top.addAgents} ${plural(top.addAgents, 'agent', 'agents')}).`;
    }
    if (short.length) return `${short.map((r) => `${fmtDay(r.date)}: ${fmtProb(r.shortfallProb)} shortfall risk, add ${r.addAgents} ${plural(r.addAgents, 'agent', 'agents')}`).join('; ')}.`;
    if (surplus.length) return `Very likely over-rostered on ${surplus.map((r) => fmtDay(r.date)).join(', ')}.`;
    const worst = rated.reduce((a, b) => (b.shortfallProb > a.shortfallProb ? b : a));
    return `Highest shortfall risk ${fmtProb(worst.shortfallProb)}, on ${fmtDay(worst.date)}; act at ${fmtProb(rules.shortfallProb)}.`;
  }
  if (id === 'day') {
    if (day.calls == null) return `${fmtDay(day.date)} has no usable record.`;
    return fired
      ? `${fmtDay(day.date)}: ${fmtInt(day.calls)} calls, ${day.status} the expected ${fmtRange(day.lo, day.hi)}.`
      : `${fmtDay(day.date)}: ${fmtInt(day.calls)} calls.`;
  }
  if (id === 'week') {
    if (week.total == null) return 'The last 7 days include a day with no usable record.';
    return fired
      ? `7 days to ${fmtDay(week.end)}: ${fmtInt(week.total)} calls, ${week.status} the expected ${fmtRange(week.lo, week.hi)}.`
      : `7 days to ${fmtDay(week.end)}: ${fmtInt(week.total)} calls.`;
  }
  const flagged = topics.filter((t) => t.status === 'above' || t.status === 'below');
  if (!flagged.length) return `${topics.length} topics checked.`;
  return `${flagged.length} of ${topics.length}: ${flagged.map((t) => `${t.name} (${t.status})`).join('; ')}.`;
}

export default function StatusBand({ board, live, statement, provenance, showStatements, onHow }) {
  const fired = live.signals.filter((s) => s.triggered);
  const ok = fired.length === 0;
  const ctx = {
    day: board.pastDays[board.pastDays.length - 1], week: board.weeks.blocks[board.weeks.blocks.length - 1],
    outlook: live.outlook, topics: board.topics, rules: board.staffing.rules,
  };
  const sig = Object.fromEntries(live.signals.map((s) => [s.id, s]));
  // The verdict is fixed by the rules; the sentence after it is the written statement.
  let rest = statement || '';
  const m = rest.match(/^(No action needed\.|Action needed:)\s*(.*)$/s);
  if (m) rest = m[2].charAt(0).toUpperCase() + m[2].slice(1);

  return (
    <section className="lead-story" aria-labelledby="status-h">
      <div>
        <p className="kicker">For the huddle on {fmtDay(board.runDate)} · planning {fmtDay(board.planningDay)}</p>
        {showStatements ? (
          <>
            <h2 className={`verdict ${ok ? 'is-ok' : 'is-alert'}`} id="status-h">{ok ? 'No action needed' : 'Action needed'}</h2>
            <p className="standfirst">{rest}</p>
            <Byline narrative={board.narrative} provenance={provenance} full onHow={onHow} />
          </>
        ) : (
          // Statements switched off for a usability test: no verdict, only the rule outcomes.
          <h2 className="verdict" id="status-h">{fired.length} of {live.signals.length} rules fired</h2>
        )}
      </div>
      <div>
        <p className="kicker">Rules checked · {ok ? 'none fired' : `${fired.length} fired`}</p>
        <ul className="rules">
          {board.routine.rules.map((r) => {
            const s = sig[r.id];
            return (
              <li key={r.id}>
                {s.triggered ? <IconAlert /> : <IconOk />}
                <span className="name">{r.check}</span>
                <span className={`state ${s.triggered ? 'fired' : 'clear'}`}>{s.triggered ? 'Fired' : 'Clear'}</span>
                <div className="evidence">{evidence(r.id, s.triggered, ctx)}</div>
                {s.triggered && (
                  <div className="response"><b>{r.responder}</b>, {r.deadline.charAt(0).toLowerCase() + r.deadline.slice(1)}: {r.response}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
