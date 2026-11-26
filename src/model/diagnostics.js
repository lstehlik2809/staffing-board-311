// Convergence checks for the Gibbs sampler: split R-hat and effective sample
// size (Geyer's initial-positive-sequence estimate on split chains).
// These are practical checks, not proof that the model is adequate.

function splitSequences(x, chains, n) {
  const half = Math.floor(n / 2);
  const seqs = [];
  for (let c = 0; c < chains; c++) {
    seqs.push(x.subarray(c * n, c * n + half));
    seqs.push(x.subarray(c * n + (n - half), c * n + n));
  }
  return { seqs, len: half };
}

export function rhatEss(x, chains, n) {
  const { seqs, len } = splitSequences(x, chains, n);
  const m = seqs.length;
  if (len < 4) return { rhat: NaN, ess: NaN };
  const means = new Float64Array(m);
  const vars = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    let s = 0;
    for (let i = 0; i < len; i++) s += seqs[j][i];
    const mu = s / len;
    let v = 0;
    for (let i = 0; i < len; i++) { const d = seqs[j][i] - mu; v += d * d; }
    means[j] = mu;
    vars[j] = v / (len - 1);
  }
  let grand = 0, W = 0;
  for (let j = 0; j < m; j++) { grand += means[j]; W += vars[j]; }
  grand /= m; W /= m;
  let B = 0;
  for (let j = 0; j < m; j++) B += (means[j] - grand) ** 2;
  B = (B / (m - 1)) * len;
  const varPlus = ((len - 1) / len) * W + B / len;
  if (!(W > 0) || !(varPlus > 0)) return { rhat: NaN, ess: NaN };
  const rhat = Math.sqrt(varPlus / W);

  // Autocorrelation at increasing lags, averaged over sequences.
  const maxLag = Math.min(len - 2, 400);
  const rho = [];
  for (let lag = 0; lag <= maxLag; lag++) {
    let acov = 0;
    for (let j = 0; j < m; j++) {
      const s = seqs[j], mu = means[j];
      let a = 0;
      for (let i = 0; i + lag < len; i++) a += (s[i] - mu) * (s[i + lag] - mu);
      acov += a / len;
    }
    acov /= m;
    rho.push(1 - (W - acov) / varPlus);
    // Stop once a pair of consecutive lags sums to a non-positive value.
    if (lag >= 2 && lag % 2 === 0 && rho[lag - 1] + rho[lag] <= 0) break;
  }
  let sum = 0;
  for (let k = 1; k + 1 < rho.length; k += 2) {
    const pair = rho[k] + rho[k + 1];
    if (pair <= 0) break;
    sum += pair;
  }
  const ess = (m * len) / Math.max(1e-9, 1 + 2 * sum);
  return { rhat, ess: Math.min(ess, m * len) };
}

export const RHAT_LIMIT = 1.01;
export const ESS_LIMIT = 400;
