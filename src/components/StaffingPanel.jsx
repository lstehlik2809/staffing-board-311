import React, { useState } from 'react';
import { useWidth, useTextScale, niceTicks, Tooltip, SwatchRange, SwatchMid, SwatchRoster } from '../lib/ui.jsx';
import { fmtDay } from '../model/calendar.js';
import { fmtInt, fmtRange, fmtProb, fmtShare } from '../model/format.js';


export const SERVICE_LEVELS = [
  { key: '80/20', label: '80% answered within 20 seconds', slTarget: 0.8, answerSec: 20 },
  { key: '80/30', label: '80% answered within 30 seconds', slTarget: 0.8, answerSec: 30 },
  { key: '90/30', label: '90% answered within 30 seconds', slTarget: 0.9, answerSec: 30 },
];

function StaffStatus({ row }) {
  if (row.status === 'shortfall') return <span className="status-word alert">▲ Act: add {row.addAgents}</span>;
  if (row.status === 'surplus') return <span className="status-word watch">▼ Over-rostered</span>;
  if (row.status === 'no_roster') return <span className="status-word ok">No roster on file</span>;
  return <span className="status-word ok">Holds</span>;
}

/**
 * Two aligned comparisons per day:
 *  - agents required (predictive range) against agents rostered, on a shared agents scale;
 *  - the chance of a shortfall against the action threshold, on a shared 0–100% scale.
 * The second is the number the decision turns on, so it gets its own encoding, not just a label.
 */
export default function StaffingPanel({ outlook, planningDay, lockedFrom, params, setParams, defaults, ready, busy, threshold }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState(null);
  const [showTable, setShowTable] = useState(false);

  // Narrow panels keep the status word by moving it under the day label.
  const k = useTextScale();            // text-bearing sizes follow the reader's text size
  const TOP = 26 * k;                  // room for the column headings
  const AXIS = 34 * k;
  const narrow = width < 430 * k;
  const ROW = (narrow ? 46 : 36) * k;
  const left = (narrow ? 112 : 92) * k;
  const riskW = narrow ? 54 : 64;      // the 0–100% meter
  const pctW = 42 * k;                 // the printed percentage
  const statusW = narrow ? 0 : 96 * k;
  const gap = 16;
  const right = gap + riskW + pctW + statusW;
  const maxVal = Math.max(...outlook.map((r) => Math.max(r.required.q95, r.rostered || 0)));
  const xMax = maxVal * 1.06;
  const ticks = niceTicks(maxVal, narrow ? 2 : 3).filter((t) => t <= xMax);
  const innerW = Math.max(0, width - left - right);
  const x = (v) => left + (innerW * v) / xMax;
  const rx0 = left + innerW + gap;              // start of the risk meter
  const rx = (p) => rx0 + riskW * Math.min(1, Math.max(0, p));
  const bottom = TOP + outlook.length * ROW;
  const height = bottom + AXIS;
  const isDefault = params.ahtSec === defaults.ahtSec && params.shrinkage === defaults.shrinkage
    && params.sl === defaults.sl && params.rosterAdjust === 0;
  const a = active != null ? outlook[active] : null;

  const onKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const cur = active == null ? -1 : active;
      setActive(Math.max(0, Math.min(outlook.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Escape') setActive(null);
  };

  return (
    <div>
      <div className="legend" aria-hidden="true">
        <span><SwatchRange /> Agents required, 90% range</span>
        <span><SwatchMid /> Middle half</span>
        <span><SwatchRoster /> Agents rostered</span>
      </div>
      <div
        className={`chart chart-focus${busy ? ' busy' : ''}`} ref={ref} tabIndex={0} role="group" onKeyDown={onKey} onBlur={() => setActive(null)}
        aria-label="Agents required against agents rostered, and the chance of a shortfall, for the next days. Use the up and down arrow keys to read each day; a table view follows the chart."
      >
        {width > 0 && (
          <svg height={height} role="img" aria-label="For each of the next days: the range of agents required at the busiest hour, the agents rostered, and the chance that the requirement exceeds the roster, with the action threshold marked.">
            <text x={0} y={12 * k} textAnchor="start">Day</text>
            <text x={rx0} y={12 * k} textAnchor="start">{narrow ? 'Shortfall risk' : 'Chance of shortfall'}</text>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={TOP} y2={bottom} stroke={t === 0 ? 'var(--axis)' : 'var(--hairline)'} />
                <text x={x(t)} y={bottom + 3 + 12 * k} textAnchor="middle">{t}</text>
              </g>
            ))}
            <text x={left} y={bottom + 4 + 26 * k} textAnchor="start">Agents at the busiest hour</text>
            {/* risk scale: 0 to 100%, with the action threshold as the reference line */}
            <line x1={rx(threshold)} x2={rx(threshold)} y1={TOP} y2={bottom + 4} stroke="var(--roster)" strokeWidth="1" />
            <text x={rx(threshold) - 3} y={bottom + 3 + 12 * k} textAnchor="start">act at {fmtProb(threshold)}</text>

            {outlook.map((r, i) => {
              const cy = TOP + i * ROW + ROW / 2;
              const flagged = r.status === 'shortfall';
              const p = r.shortfallProb;
              return (
                <g key={r.date}>
                  {active === i && <rect x={0} y={cy - ROW / 2} width={width} height={ROW} fill="var(--ink)" fillOpacity="0.06" />}
                  <text className={r.date === planningDay || flagged ? 'lbl' : 'lbl-2'} x={0} y={narrow ? cy - 3 : cy + 4} textAnchor="start">{fmtDay(r.date)}</text>
                  {narrow && (
                    <foreignObject x={0} y={cy + 1} width={left - 6} height={18 * k}>
                      <div style={{ fontSize: '0.72rem', lineHeight: 1.5, whiteSpace: 'nowrap' }}><StaffStatus row={r} /></div>
                    </foreignObject>
                  )}
                  {/* agents required vs rostered */}
                  <rect className="slide" x={x(r.required.q05)} y={cy - 7} width={Math.max(2, x(r.required.q95) - x(r.required.q05))} height={14} rx="2" fill="var(--range)" />
                  <rect className="slide" x={x(r.required.q25)} y={cy - 7} width={Math.max(2, x(r.required.q75) - x(r.required.q25))} height={14} fill="var(--range-mid)" />
                  <rect className="slide" x={x(r.required.q05) - 0.75} y={cy - 7} width={1.5} height={14} fill="var(--range-cap)" />
                  <rect className="slide" x={x(r.required.q95) - 0.75} y={cy - 7} width={1.5} height={14} fill="var(--range-cap)" />
                  {r.rostered != null && <rect className="slide" x={x(r.rostered) - 1.25} y={cy - 12} width={2.5} height={24} rx="1" fill="var(--roster)" />}
                  {/* chance of shortfall vs threshold */}
                  <rect x={rx0} y={cy - 4} width={riskW} height={8} rx="2" fill="var(--track)" />
                  {p != null && (
                    <rect className="slide" x={rx0} y={cy - 4} width={Math.max(p > 0.004 ? 2 : 0, rx(p) - rx0)} height={8} rx="2" fill={flagged ? 'var(--alert)' : 'var(--range-cap)'} />
                  )}
                  <text className="lbl" x={rx0 + riskW + pctW - 4} y={cy + 4} textAnchor="end">{p == null ? '—' : fmtProb(p)}</text>
                  {!narrow && (
                    <foreignObject x={rx0 + riskW + pctW + 8} y={cy - 10 * k} width={statusW - 8} height={20 * k}>
                      <div style={{ fontSize: '0.8125rem', lineHeight: 1.5, whiteSpace: 'nowrap' }}><StaffStatus row={r} /></div>
                    </foreignObject>
                  )}
                  <rect
                    className="hit" x={0} y={cy - ROW / 2} width={width} height={ROW}
                    onPointerEnter={() => setActive(i)} onPointerMove={() => setActive(i)} onPointerLeave={() => setActive(null)}
                  />
                </g>
              );
            })}
          </svg>
        )}
        {a && (
          <Tooltip x={Math.min(x(a.required.q50), width * 0.45)} y={TOP + (active + 1) * ROW} width={width}>
            <div className="t-head">{fmtDay(a.date)}{a.date === planningDay ? ' · planning day' : ''}</div>
            <div><span className="t-val num">{a.shortfallProb == null ? '—' : fmtProb(a.shortfallProb)}</span> chance the roster falls short</div>
            <dl>
              <dt>Agents required (90%)</dt><dd>{fmtRange(a.required.q05, a.required.q95)}</dd>
              <dt>Middle half</dt><dd>{fmtRange(a.required.q25, a.required.q75)}</dd>
              <dt>Agents rostered</dt><dd>{a.rostered == null ? '—' : fmtInt(a.rostered)}</dd>
              <dt>Calls forecast (90%)</dt><dd>{fmtRange(a.calls[0], a.calls[4])}</dd>
              <dt>Busiest hour</dt><dd>{fmtShare(a.peakShare)} of the day</dd>
            </dl>
            {a.rostered != null && lockedFrom[a.date] && (
              <div className="t-note">Roster fixed with data to {fmtDay(lockedFrom[a.date])}, at the 90th percentile of the forecast made then ({fmtInt(a.lockedCalls)} calls).</div>
            )}
            {a.holiday && <div className="t-note">{a.holiday}.</div>}
            <div className="t-note"><StaffStatus row={a} /></div>
          </Tooltip>
        )}
      </div>
      <button className="btn link small" type="button" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable} style={{ marginTop: 6 }}>
        {showTable ? 'Hide table' : 'Show these numbers as a table'}
      </button>
      {showTable && (
        <div className="table-scroll">
          <table className="data">
            <caption className="sr-only">Staffing outlook</caption>
            <thead>
              <tr><th>Day</th><th>Required (90%)</th><th>Rostered</th><th>Chance of shortfall</th><th>Calls forecast (90%)</th><th className="txt">Status</th></tr>
            </thead>
            <tbody>
              {outlook.map((r) => (
                <tr key={r.date}>
                  <td>{fmtDay(r.date)}</td>
                  <td>{fmtRange(r.required.q05, r.required.q95)}</td>
                  <td>{r.rostered == null ? '—' : fmtInt(r.rostered)}</td>
                  <td>{r.shortfallProb == null ? '—' : fmtProb(r.shortfallProb)}</td>
                  <td>{fmtRange(r.calls[0], r.calls[4])}</td>
                  <td className="txt"><StaffStatus row={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="assume">
        <h3>Assumptions you can change</h3>
        <p className="hint">
          Illustrative, not NYC 311’s own figures. They turn calls into agents; the chance of a shortfall barely moves with
          them, because the roster is built from the same assumptions. They change the lead story as well as this chart.
        </p>
        <div className="assume-grid">
          <div className="field">
            <label htmlFor="aht">Average handle time <output>{(params.ahtSec / 60).toFixed(1)} min</output></label>
            <input id="aht" type="range" min="180" max="480" step="15" value={params.ahtSec} disabled={!ready}
              onChange={(e) => setParams({ ...params, ahtSec: +e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="shr">Shrinkage (paid time off the phones) <output>{Math.round(params.shrinkage * 100)}%</output></label>
            <input id="shr" type="range" min="0.15" max="0.45" step="0.01" value={params.shrinkage} disabled={!ready}
              onChange={(e) => setParams({ ...params, shrinkage: +e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="sl">Service level target</label>
            <select id="sl" value={params.sl} disabled={!ready} onChange={(e) => setParams({ ...params, sl: e.target.value })}>
              {SERVICE_LEVELS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="adj">Change every day’s roster by <output>{params.rosterAdjust > 0 ? '+' : ''}{params.rosterAdjust} agents</output></label>
            <input id="adj" type="range" min="-30" max="30" step="1" value={params.rosterAdjust} disabled={!ready}
              onChange={(e) => setParams({ ...params, rosterAdjust: +e.target.value })} />
          </div>
        </div>
        <p className="small" style={{ marginTop: 8 }}>
          {!ready && 'Controls unlock when the model has finished fitting in your browser. '}
          {!isDefault && (
            <button className="btn link" type="button" onClick={() => setParams({ ...defaults, rosterAdjust: 0 })}>Reset to the published assumptions</button>
          )}
        </p>
      </div>
    </div>
  );
}
