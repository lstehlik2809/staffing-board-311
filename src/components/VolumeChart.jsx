import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useWidth, useTextScale, niceTicks, axisFormat, Tooltip, Mark, RangeBar, StatusWord, SwatchRange, SwatchMid, SwatchDot, SwatchFlag } from '../lib/ui.jsx';
import { fmtDay, fmtDayShort, dow, diffDays } from '../model/calendar.js';
import { fmtInt, fmtRange } from '../model/format.js';
import { Q } from '../model/config.js';

// The top margin holds two annotation lanes, so labels never sit on the data.
const MARGIN = { top: 50, right: 14, bottom: 46, left: 44 };

/**
 * Daily calls against the range expected the day before (control limits),
 * continuing into the future as a forecast band — bars only, no line.
 */
export default function VolumeChart({ pastDays, forecast, asOf, planningDay, outlookDays, today }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState(null);
  const [showTable, setShowTable] = useState(false);
  const scroller = useRef(null);
  const [scrolls, setScrolls] = useState(false);
  // On a narrow screen the chart keeps all its days and scrolls sideways, starting at the latest ones.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const wide = el.scrollWidth > el.clientWidth + 2;
    setScrolls(wide);
    if (wide) el.scrollLeft = el.scrollWidth;
  }, [width, pastDays]);

  const k = useTextScale();
  const M = { top: MARGIN.top * k, right: (scrolls ? 44 : MARGIN.right) * k, bottom: MARGIN.bottom * k, left: MARGIN.left * k };
  const H = 234 + M.top + M.bottom;

  const slots = useMemo(() => {
    const past = pastDays.map((d) => ({ ...d, kind: 'past' }));
    const future = forecast
      .filter((f) => diffDays(f.date, planningDay) < outlookDays)
      .map((f) => ({
        kind: 'future', date: f.date, holiday: f.holiday, calls: null, status: 'forecast',
        // a forecast for a day that has already come: its data is not published yet
        pending: diffDays(f.date, today) <= 0, isToday: f.date === today,
        lo: f.q[Q.lo3], q25: f.q[Q.q25], q75: f.q[Q.q75], hi: f.q[Q.hi3],
      }));
    return [...past, ...future];
  }, [pastDays, forecast, planningDay, outlookDays, today]);

  const maxVal = Math.max(...slots.map((s) => Math.max(s.hi || 0, s.calls || 0, s.recorded || 0)));
  // The axis ends just above the data; ticks are clean values inside it.
  const yMax = maxVal * 1.05;
  const ticks = niceTicks(maxVal, 4).filter((t) => t <= yMax);
  const fmtAxis = axisFormat(yMax);
  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = H - M.top - M.bottom;
  const slotW = slots.length ? innerW / slots.length : 0;
  const x = (i) => M.left + (i + 0.5) * slotW;
  const y = (v) => M.top + innerH * (1 - v / yMax);
  const barW = Math.max(3, Math.min(12, slotW * 0.62));
  const nPast = pastDays.length;
  const dividerX = M.left + nPast * slotW;
  const lastIdx = nPast - 1;
  const planIdx = slots.findIndex((s) => s.date === planningDay);
  const pendingIdx = slots.map((s, i) => (s.pending ? i : -1)).filter((i) => i >= 0);

  // a date label needs about 66px at default text size: show every n-th Monday accordingly
  const mondays = slots.map((s, i) => (dow(s.date) === 1 ? i : -1)).filter((i) => i >= 0);
  const every = Math.max(1, Math.ceil((66 * k) / Math.max(1, 7 * slotW)));
  const labelled = new Set(mondays.filter((_, n) => (mondays.length - 1 - n) % every === 0));

  // holiday labels on a second axis line, skipping any that would collide
  const holidayLabels = [];
  let lastEnd = -Infinity;
  slots.forEach((s, i) => {
    if (!s.holiday) return;
    const text = s.holiday.replace('Martin Luther King Jr. Day', 'MLK Day').replace('Columbus / Indigenous Peoples Day', 'Columbus Day');
    const half = text.length * 3.1 * k;
    const cx = Math.min(Math.max(x(i), M.left + half), width - M.right - half);
    if (cx - half > lastEnd + 8) { holidayLabels.push({ i, cx, text }); lastEnd = cx + half; }
  });

  const onKey = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const cur = active == null ? lastIdx : active;
      setActive(Math.max(0, Math.min(slots.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1))));
    } else if (e.key === 'Escape') setActive(null);
  };

  // the planning-day label reads to the right of its leader, unless it would run off the chart
  const planRight = planIdx >= 0 && x(planIdx) > width - 90 * k;
  const a = active != null ? slots[active] : null;
  const flaggedLabel = (s, i) => {
    const above = s.status === 'above';
    const ty = above ? y(s.calls) - 11 : y(s.calls) + 8 + 12 * k;
    const anchor = x(i) > width - 140 ? 'end' : x(i) < 120 ? 'start' : 'middle';
    return <text key={`fl${i}`} className="lbl" x={x(i)} y={ty} textAnchor={anchor}>{fmtDay(s.date)} · {fmtInt(s.calls)}</text>;
  };

  return (
    <div>
      <div className="legend" aria-hidden="true">
        <span><SwatchDot /> Calls recorded</span>
        <span><SwatchRange /> Expected range (99.7% of ordinary days)</span>
        <span><SwatchMid /> Middle half of that range</span>
        <span><SwatchFlag /> Outside the expected range</span>
      </div>
      <div
        className="chart-scroll chart-focus" ref={scroller} tabIndex={0} role="group" onKeyDown={onKey} onBlur={() => setActive(null)}
        aria-label="Daily calls against the expected range. Use the left and right arrow keys to read each day; a table view follows the chart."
      >
      <div className="chart" ref={ref}>
        {width > 0 && (
          <svg height={H} role="img" aria-label={`Daily agent-handled calls for ${nPast} days to ${fmtDay(asOf)}, each with the range expected the day before, followed by the forecast range to ${fmtDay(slots[slots.length - 1].date)}.`}>
            {/* weekend shading explains the weekly rhythm */}
            {slots.map((s, i) => (dow(s.date) === 6 ? (
              <rect key={`we${i}`} x={M.left + i * slotW} y={M.top} width={Math.min(slotW * 2, innerW - i * slotW)} height={innerH} fill="var(--band)" fillOpacity="0.6" />
            ) : null))}
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--hairline)'} />
                <text x={M.left - 8} y={y(t) + 4} textAnchor="end">{fmtAxis(t)}</text>
                {scrolls && <text x={width - M.right + 8} y={y(t) + 4} textAnchor="start">{fmtAxis(t)}</text>}
              </g>
            ))}
            <text x={4} y={14 * k} textAnchor="start">Calls per day</text>

            {/* forecast region */}
            {dividerX < width - M.right && (
              <g>
                <line x1={dividerX} x2={dividerX} y1={4} y2={M.top + innerH} stroke="var(--axis)" />
                <text x={dividerX + 6} y={14 * k} textAnchor="start" className="lbl-2">Forecast →</text>
              </g>
            )}

            {slots.map((s, i) => (s.lo == null ? null : (
              <RangeBar key={`rb${i}`} x={x(i)} w={barW} yLo={y(s.lo)} yHi={y(s.hi)} yQ25={y(s.q25)} yQ75={y(s.q75)} faded={s.kind === 'future'} />
            )))}
            {slots.map((s, i) => {
              if (s.kind !== 'past') return null;
              if (s.calls == null) return s.recorded != null ? <Mark key={`m${i}`} x={x(i)} y={y(s.recorded)} status="incomplete" /> : null;
              return <Mark key={`m${i}`} x={x(i)} y={y(s.calls)} status={s.status} />;
            })}

            {/* selective labels: outside-range days, the latest day, the planning day */}
            {slots.map((s, i) => (s.kind === 'past' && (s.status === 'above' || s.status === 'below') && i !== lastIdx ? flaggedLabel(s, i) : null))}
            {slots[lastIdx] && slots[lastIdx].calls != null && (
              <g>
                <line x1={x(lastIdx)} x2={x(lastIdx)} y1={19 * k} y2={y(Math.max(slots[lastIdx].calls, slots[lastIdx].hi ?? 0)) - 7} stroke="var(--ink)" strokeWidth="1" />
                <text className="lbl" x={dividerX - 6} y={14 * k} textAnchor="end">{fmtDay(slots[lastIdx].date)} · {fmtInt(slots[lastIdx].calls)} calls</text>
              </g>
            )}
            {/* forecast days already past: a bracket, because their data is not yet published */}
            {pendingIdx.length > 0 && (() => {
              const x0 = M.left + pendingIdx[0] * slotW + 2;
              const x1 = M.left + (pendingIdx[pendingIdx.length - 1] + 1) * slotW - 2;
              const yb = M.top - 9;
              const hasToday = pendingIdx.some((i) => slots[i].isToday);
              return (
                <g>
                  <path d={`M${x0} ${yb + 5}V${yb}H${x1}V${yb + 5}`} fill="none" stroke="var(--ink-2)" strokeWidth="1" />
                  {!planRight && (
                    <text className="lbl-2 halo" x={x1 + 2} y={31 * k} textAnchor="end">
                      {hasToday ? 'to today: data not yet published' : 'data not yet published'}
                    </text>
                  )}
                </g>
              );
            })()}
            {planIdx >= 0 && (
              <g>
                <line x1={x(planIdx)} x2={x(planIdx)} y1={36 * k} y2={y(slots[planIdx].hi) - 4} stroke="var(--ink)" strokeWidth="1" />
                <text className="lbl" x={x(planIdx) + (planRight ? -4 : 4)} y={31 * k} textAnchor={planRight ? 'end' : 'start'}>Planning day</text>
              </g>
            )}

            {/* x axis: a date at each Monday; holidays named underneath */}
            {slots.map((s, i) => (dow(s.date) === 1 ? (
              <g key={`xt${i}`}>
                <line x1={x(i)} x2={x(i)} y1={M.top + innerH} y2={M.top + innerH + 4} stroke="var(--axis)" />
                {labelled.has(i) && <text x={x(i)} y={M.top + innerH + 5 + 12 * k} textAnchor="middle">Mon {fmtDayShort(s.date)}</text>}
              </g>
            ) : null))}
            {holidayLabels.map((h) => (
              <g key={`h${h.i}`}>
                <line x1={x(h.i)} x2={x(h.i)} y1={M.top + innerH + 4} y2={M.top + innerH + 10 + 14 * k} stroke="var(--hairline)" />
                <text x={h.cx} y={M.top + innerH + 8 + 28 * k} textAnchor="middle" className="lbl-2">{h.text}</text>
              </g>
            ))}

            {slots.map((s, i) => (
              <rect
                key={`hit${i}`} className={`hit${active === i ? ' on' : ''}`} x={M.left + i * slotW} y={M.top - 4} width={slotW} height={innerH + 8}
                onPointerEnter={() => setActive(i)} onPointerMove={() => setActive(i)} onPointerLeave={() => setActive(null)}
              />
            ))}
          </svg>
        )}
        {a && (
          <Tooltip x={x(active)} y={M.top} width={width}>
            <div className="t-head">{fmtDay(a.date)}{a.isToday ? ' · today' : ''}{a.kind === 'future' ? ' · forecast' : ''}{a.date === planningDay ? ' · planning day' : ''}</div>
            {a.kind === 'past' && a.calls != null && <div><span className="t-val num">{fmtInt(a.calls)}</span> calls</div>}
            {a.kind === 'past' && a.calls == null && <div><span className="t-val">No usable record</span></div>}
            <dl>
              {a.lo != null && (<><dt>Expected range</dt><dd>{fmtRange(a.lo, a.hi)}</dd></>)}
              {a.q25 != null && (<><dt>Middle half</dt><dd>{fmtRange(a.q25, a.q75)}</dd></>)}
              {a.kind === 'past' && (<><dt>Verdict</dt><dd><StatusWord status={a.status} /></dd></>)}
            </dl>
            {a.pending && <div className="t-note">{a.isToday ? 'Today is still in progress, so its data is not yet published.' : 'This day has passed, but its data is not yet published.'} The range is a forecast made from data to {fmtDay(asOf)}.</div>}
            {a.holiday && <div className="t-note">{a.holiday} — allowed for in the expected range.</div>}
            {a.note && <div className="t-note">{a.note}</div>}
          </Tooltip>
        )}
      </div>
      </div>
      {scrolls && <p className="small" style={{ marginTop: 4 }}>Scroll the chart sideways for earlier days.</p>}
      <button className="btn link small" type="button" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable} style={{ marginTop: 6 }}>
        {showTable ? 'Hide table' : 'Show these numbers as a table'}
      </button>
      {showTable && (
        <div className="table-scroll">
          <table className="data">
            <caption className="sr-only">Daily calls and expected ranges</caption>
            <thead>
              <tr><th>Day</th><th>Calls</th><th>Expected range</th><th>Middle half</th><th className="txt">Verdict</th><th className="txt">Note</th></tr>
            </thead>
            <tbody>
              {[...slots].reverse().map((s) => (
                <tr key={s.date}>
                  <td>{fmtDay(s.date)}</td>
                  <td>{s.kind === 'future' ? '—' : s.calls != null ? fmtInt(s.calls) : 'no usable record'}</td>
                  <td>{s.lo != null ? fmtRange(s.lo, s.hi) : '—'}</td>
                  <td>{s.q25 != null ? fmtRange(s.q25, s.q75) : '—'}</td>
                  <td className="txt">{s.kind === 'future' ? 'Forecast' : <StatusWord status={s.status} />}</td>
                  <td className="txt">{[s.isToday ? 'Today' : null, s.pending ? 'Data not yet published' : null, s.date === planningDay ? 'Planning day' : null, s.holiday, s.note].filter(Boolean).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
