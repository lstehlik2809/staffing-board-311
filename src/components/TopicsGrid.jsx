import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Mark, RangeBar, StatusWord, rangeTicks, axisFormat, useWidth, textScale, SwatchRange, SwatchMid, SwatchDot, SwatchFlag } from '../lib/ui.jsx';
import { fmtDayShort } from '../model/calendar.js';
import { fmtInt, fmtRange } from '../model/format.js';

const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** 7-day totals with their expected ranges, plus the range for the next 7 days. */
function Blocks({ blocks, next, width, height, axis = false }) {
  const all = next ? [...blocks, { ...next, total: null, status: 'forecast' }] : blocks;
  const vals = all.flatMap((b) => [b.lo, b.hi, b.total]).filter((v) => v != null);
  if (!vals.length || width <= 0) return <svg width="100%" height={height} />;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo || 1) * 0.12;
  const d0 = Math.max(0, lo - pad), d1 = hi + pad;
  const k = axis ? textScale() : 1;
  const m = axis ? { top: 14, right: 10, bottom: 34 * k, left: 52 * k } : { top: 6, right: 4, bottom: 4, left: 4 };
  const innerW = width - m.left - m.right, innerH = height - m.top - m.bottom;
  const slotW = innerW / all.length;
  const x = (i) => m.left + (i + 0.5) * slotW;
  const y = (v) => m.top + innerH * (1 - (v - d0) / (d1 - d0));
  const barW = Math.max(3, Math.min(axis ? 22 : 9, slotW * 0.6));
  const ticks = axis ? rangeTicks(d0, d1, 3) : [];
  const fmtAxis = axisFormat(d1);
  return (
    <svg width="100%" height={height} aria-hidden={axis ? undefined : true} role={axis ? 'img' : undefined}
      aria-label={axis ? '7-day totals against their expected ranges; exact values are in the table beside the chart.' : undefined}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke="var(--hairline)" />
          <text x={m.left - 8} y={y(t) + 4} textAnchor="end">{fmtAxis(t)}</text>
        </g>
      ))}
      {next && <line x1={m.left + blocks.length * slotW} x2={m.left + blocks.length * slotW} y1={m.top} y2={m.top + innerH} stroke="var(--axis)" />}
      {all.map((b, i) => (b.lo == null ? null : (
        <RangeBar key={`r${i}`} x={x(i)} w={barW} yLo={y(b.lo)} yHi={y(b.hi)} yQ25={y(b.q25)} yQ75={y(b.q75)} faded={b.status === 'forecast'} />
      )))}
      {all.map((b, i) => (b.total == null ? null : (
        <Mark key={`m${i}`} x={x(i)} y={y(b.total)} status={b.status} r={axis ? 4 : i === blocks.length - 1 ? 3.4 : 2.6} />
      )))}
      {axis && all.map((b, i) => (
        <text key={`x${i}`} x={x(i)} y={height - 18 * k} textAnchor="middle">{i % 2 === (all.length - 1) % 2 || slotW > 64 ? fmtDayShort(b.end) : ''}</text>
      ))}
      {axis && <text x={m.left} y={height - 3} textAnchor="start">{width < 460 ? `7 days to the date shown${next ? '; last: forecast' : ''}` : `7 days ending on the date shown${next ? '; last bar is the forecast' : ''}`}</text>}
    </svg>
  );
}

/** The verdict as it reads inside a sentence. */
function Verdict({ status }) {
  if (status === 'above' || status === 'below') return <span className="status-word alert">◆ {status} the expected range</span>;
  if (status === 'no_limits') return <span>with no expected range on file</span>;
  return <span>within the expected range</span>;
}

/** "18–24 Nov", or "28 Nov – 4 Dec" across a month boundary. */
const fmtPeriod = (start, end) => (start.slice(5, 7) === end.slice(5, 7)
  ? `${+start.slice(8, 10)}–${fmtDayShort(end)}`
  : `${fmtDayShort(start)} – ${fmtDayShort(end)}`);

/** The opened panel: spans the whole grid row directly under the panel that opened it. */
const Detail = React.forwardRef(function Detail({ item, id, onClose }, ref) {
  const [chartRef, width] = useWidth();
  const rows = [...item.blocks].reverse();
  const latest = item.blocks[item.blocks.length - 1];
  return (
    <div className="detail" id={id} ref={ref} role="region" aria-labelledby={`${id}-h`}>
      <div className="panel-head">
        <div className="grow">
          <h3 id={`${id}-h`}>{item.name}</h3>
          <p className="chart-sub">
            {latest.total == null
              ? 'The latest 7 days include a day with no usable record.'
              : <>Latest 7 days: <b>{fmtInt(latest.total)} calls</b>, <Verdict status={latest.status} />{latest.lo != null && <> ({fmtRange(latest.lo, latest.hi)})</>}.</>}
            {' '}Each period is judged against the range expected a week before it; the scale does not start at zero.
          </p>
        </div>
        <button className="btn" type="button" onClick={onClose} aria-label={`Close ${item.name}`}>Close ✕</button>
      </div>
      <div className="detail-body">
        <div className="chart" ref={chartRef}><Blocks blocks={item.blocks} next={item.next} width={width} height={230} axis /></div>
        <div className="detail-table">
          <table className="data">
            <thead><tr><th>7 days</th><th>Calls</th><th>Expected range</th><th className="opt">Middle half</th><th className="txt">Verdict</th></tr></thead>
            <tbody>
              {item.next && (
                <tr><td>{fmtPeriod(item.next.start, item.next.end)}</td><td>—</td><td>{fmtRange(item.next.lo, item.next.hi)}</td><td className="opt">{fmtRange(item.next.q25, item.next.q75)}</td><td className="txt">Forecast</td></tr>
              )}
              {rows.map((b) => (
                <tr key={b.end}>
                  <td>{fmtPeriod(b.start, b.end)}</td>
                  <td>{b.total == null ? 'incomplete' : fmtInt(b.total)}</td>
                  <td>{b.lo == null ? '—' : fmtRange(b.lo, b.hi)}</td>
                  <td className="opt">{b.q25 == null ? '—' : fmtRange(b.q25, b.q75)}</td>
                  <td className="txt"><StatusWord status={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});

const Mini = React.forwardRef(function Mini({ item, kind, open, controls, onToggle }, btnRef) {
  const [ref, width] = useWidth();
  const flagged = item.status === 'above' || item.status === 'below';
  const latest = item.blocks[item.blocks.length - 1];
  return (
    <button
      ref={btnRef} type="button" className={`mini ${kind}${flagged ? ' flag' : kind === 'total' ? '' : ' quiet'}`}
      aria-expanded={open} aria-controls={open ? controls : undefined} onClick={onToggle}
    >
      <span className="m-top">
        <span className="m-name">{item.name}</span>
        <svg className="m-chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <span className="m-val">
        <b>{latest.total == null ? '—' : fmtInt(latest.total)}</b> in 7 days
        <span style={{ display: 'block' }}><StatusWord status={latest.status} /></span>
      </span>
      <span ref={ref} style={{ display: 'block', width: '100%', marginTop: 'auto' }}>
        <Blocks blocks={item.blocks} next={item.next} width={width} height={64} />
      </span>
      <span className="sr-only">{open ? ', details shown below' : ', show details'}</span>
    </button>
  );
});

export default function TopicsGrid({ weeks, topics }) {
  const [selected, setSelected] = useState(null);
  const [cols, setCols] = useState(1);
  const [gridRef, gridWidth] = useWidth();
  const buttons = useRef({});
  const detailRef = useRef(null);
  const total = { name: 'All calls', blocks: weeks.blocks, next: weeks.next, status: weeks.blocks[weeks.blocks.length - 1].status };
  const items = [{ item: total, kind: 'total' }, ...topics.map((t) => ({ item: t, kind: 'topic' }))];
  const selIdx = selected != null ? items.findIndex((it) => it.item.name === selected) : -1;
  const detailId = selIdx >= 0 ? `topic-detail-${slug(selected)}` : undefined;

  // How many panels the grid fits in a row: the detail goes after the last panel of the selected row.
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const n = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length;
    setCols(Math.max(1, n));
  }, [gridWidth, gridRef]);
  const insertAfter = selIdx >= 0 ? Math.min(items.length - 1, Math.floor(selIdx / cols) * cols + cols - 1) : -1;

  // Bring the opened detail into view only as far as needed, and never so far
  // that the panel that opened it scrolls off the top of the screen.
  useEffect(() => {
    const d = detailRef.current;
    const b = selected ? buttons.current[selected] : null;
    if (!d || !b) return;
    const margin = 16;
    const below = d.getBoundingClientRect().bottom - (window.innerHeight - margin);
    const roomAbove = b.getBoundingClientRect().top - margin;
    const by = Math.min(below, roomAbove);
    if (by > 0) window.scrollBy({ top: by, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    const name = selected;
    setSelected(null);
    if (name && buttons.current[name]) buttons.current[name].focus();
  };
  const onKeyDown = (e) => { if (e.key === 'Escape' && selected) { e.preventDefault(); close(); } };

  const cells = [];
  items.forEach(({ item, kind }, i) => {
    cells.push(
      <Mini
        key={item.name} item={item} kind={kind} open={i === selIdx} controls={detailId}
        ref={(el) => { buttons.current[item.name] = el; }}
        onToggle={() => setSelected(i === selIdx ? null : item.name)}
      />,
    );
    if (i === insertAfter) {
      cells.push(<Detail key={`detail-${selected}`} id={detailId} item={items[selIdx].item} onClose={close} ref={detailRef} />);
    }
  });

  return (
    <div>
      <div className="legend" aria-hidden="true">
        <span><SwatchDot /> Calls in 7 days</span>
        <span><SwatchRange /> Range expected a week before</span>
        <span><SwatchMid /> Middle half</span>
        <span><SwatchFlag /> Outside the expected range</span>
        <span>Last bar in each panel: forecast for the next 7 days</span>
      </div>
      <div className="multiples" ref={gridRef} onKeyDown={onKeyDown}>
        {cells}
      </div>
    </div>
  );
}
