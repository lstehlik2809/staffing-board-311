import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Width of an element, tracked with a ResizeObserver. */
export function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setW(el.clientWidth);
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/**
 * Scroll to a section and move focus to it. Buttons, not #anchors: the page keeps
 * its view state in the URL hash, so an anchor link would reset the view.
 */
export function jumpTo(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

/** Text size relative to the 16px default (1 = default, 1.5 = 150%). */
export const textScale = () => Math.min(2, Math.max(0.8, parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1));

/**
 * The reader's text scale, kept up to date. Charts multiply their text-bearing
 * margins by it, so enlarged text still fits.
 */
export function useTextScale() {
  const [k, setK] = useState(textScale);
  useEffect(() => {
    const update = () => setK(textScale());
    window.addEventListener('resize', update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    return () => { window.removeEventListener('resize', update); mo.disconnect(); };
  }, []);
  return k;
}

/** Clean axis ticks from 0 up to at least `max`. */
export function niceTicks(max, target = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  const ticks = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

/** Ticks for an axis that does not start at zero. */
export function rangeTicks(lo, hi, target = 3) {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

/** One style per axis: in full under 10,000, compact once the axis reaches it. */
export function axisFormat(max) {
  if (max >= 10000) return (v) => (v === 0 ? '0' : `${+(v / 1000).toFixed(1)}K`);
  return (v) => Math.round(v).toLocaleString('en-US');
}

export function Tooltip({ x, y, width, children }) {
  // Keep the tooltip inside its chart: flip to the left of the pointer near the right edge.
  const flip = x > width * 0.6;
  const style = flip
    ? { right: Math.max(0, width - x + 14), top: Math.max(0, y) }
    : { left: x + 14, top: Math.max(0, y) };
  return <div className="tip" role="status" style={style}>{children}</div>;
}

export const IconOk = ({ size = 18 }) => (
  <svg className="ico" width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
    <circle cx="9" cy="9" r="8" fill="var(--ok-bg)" stroke="var(--ok)" strokeWidth="1.5" />
    <path d="M5.2 9.3l2.5 2.5 5-5.4" fill="none" stroke="var(--ok)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const IconAlert = ({ size = 18 }) => (
  <svg className="ico" width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
    <path d="M9 1.6l7.6 13.6H1.4z" fill="var(--alert-bg)" stroke="var(--alert)" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M9 6.6v4.2" stroke="var(--alert)" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="9" cy="13" r="1" fill="var(--alert)" />
  </svg>
);
export const IconPen = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M2 10l.6-2.6L8.4 1.6l2 2-5.8 5.8z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  </svg>
);

/** Legend swatches that mirror the marks on the charts. */
export const SwatchRange = () => (
  <svg width="12" height="16" aria-hidden="true">
    <rect x="1" y="1" width="10" height="14" rx="2" fill="var(--range)" />
    <path d="M1 1.5h10M1 14.5h10" stroke="var(--range-cap)" strokeWidth="1.5" />
  </svg>
);
export const SwatchMid = () => (
  <svg width="12" height="16" aria-hidden="true"><rect x="1" y="4" width="10" height="8" rx="2" fill="var(--range-mid)" /></svg>
);
export const SwatchDot = () => (
  <svg width="12" height="16" aria-hidden="true"><circle cx="6" cy="8" r="4" fill="var(--calls)" /></svg>
);
export const SwatchFlag = () => (
  <svg width="14" height="16" aria-hidden="true"><path d="M7 2.5l5.5 5.5L7 13.5 1.5 8z" fill="var(--alert)" /></svg>
);
export const SwatchRoster = () => (
  <svg width="12" height="16" aria-hidden="true"><path d="M6 1v14" stroke="var(--roster)" strokeWidth="2.5" /></svg>
);

/** A day marker: dot when within range, diamond when outside, hollow when the record is incomplete. */
export function Mark({ x, y, status, r = 3.6 }) {
  if (status === 'above' || status === 'below') {
    const s = r + 2.2;
    return <path d={`M${x} ${y - s}L${x + s} ${y}L${x} ${y + s}L${x - s} ${y}Z`} fill="var(--alert)" stroke="var(--page)" strokeWidth="1.5" />;
  }
  if (status === 'incomplete') {
    return <circle cx={x} cy={y} r={r} fill="var(--page)" stroke="var(--muted)" strokeWidth="1.5" />;
  }
  return <circle cx={x} cy={y} r={r} fill="var(--calls)" stroke="var(--page)" strokeWidth="1.5" />;
}

/** Expected-range bar: full range with capped ends, darker middle half. */
export function RangeBar({ x, w, yLo, yHi, yQ25, yQ75, faded = false }) {
  const h = Math.max(1, yLo - yHi);
  return (
    <g opacity={faded ? 0.8 : 1}>
      <rect x={x - w / 2} y={yHi} width={w} height={h} rx="2" fill="var(--range)" />
      {yQ25 != null && <rect x={x - w / 2} y={yQ75} width={w} height={Math.max(1, yQ25 - yQ75)} fill="var(--range-mid)" />}
      <path d={`M${x - w / 2} ${yHi}h${w}M${x - w / 2} ${yLo}h${w}`} stroke="var(--range-cap)" strokeWidth="1.5" />
    </g>
  );
}

export function StatusWord({ status }) {
  if (status === 'above') return <span className="status-word alert">◆ Above range</span>;
  if (status === 'below') return <span className="status-word alert">◆ Below range</span>;
  if (status === 'incomplete') return <span className="status-word watch">Incomplete record</span>;
  if (status === 'no_limits') return <span className="status-word ok">No range on file</span>;
  return <span className="status-word ok">Within range</span>;
}
