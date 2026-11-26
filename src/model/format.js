// Number formatting shared by the pipeline and the page, so that a number in a
// machine-written statement is character-for-character the number on the chart.

export const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
export const fmtRange = (lo, hi) => `${fmtInt(lo)}–${fmtInt(hi)}`;

/** Probability as a whole percent, with honest ends ("under 1%", "over 99%"). */
export function fmtProb(p) {
  if (!Number.isFinite(p)) return 'n/a';
  if (p < 0.005) return 'under 1%';
  if (p > 0.995) return 'over 99%';
  return `${Math.round(p * 100)}%`;
}

/** Share as a percent with one decimal ("9.3%"). */
export const fmtShare = (p) => `${(p * 100).toFixed(1)}%`;

export const plural = (n, one, many) => (n === 1 ? one : many);
