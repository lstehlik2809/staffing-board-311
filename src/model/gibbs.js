// Bayesian model for daily call counts, fitted by a blocked Gibbs sampler.
// Every block is an exact conditional draw, so there is nothing to tune and the
// same code runs in Node (daily pipeline) and in a browser worker.
//
//   y_t     = log(count_t + 0.5)
//   y_t     = level_t + calendar_t' beta + a_t
//   level_t = level_{t-1} + drift_t          drift_t ~ Normal(0, tau^2)       slow level
//   a_t     = phi * a_{t-1} + e_t                                              one-day carry-over
//   e_t     ~ Normal(0, sigma_c^2)           ordinary day      (z_t = 0)
//   e_t     ~ Normal(0, kappa^2 sigma_c^2)   exceptional day   (z_t = 1),  z_t ~ Bernoulli(pi)
//
// c = class of the day (Mon-Fri, weekend, holiday): each has its own ordinary
// variance. sigma describes ordinary (common-cause) variation only; exceptional
// days are absorbed by the second component instead of widening control limits.
//
// Blocks: level path (2-state forward filter, backward sampling), beta
// (multivariate normal), phi (truncated normal), sigma_c^2 and tau^2
// (inverse-gamma), z_t (Bernoulli), pi (beta), missing days (normal).

import { makeRng, hashSeed } from './rng.js';
import { N_FEATURES, featureIdx, holidayOn, dow } from './calendar.js';
import { rhatEss, RHAT_LIMIT, ESS_LIMIT } from './diagnostics.js';

export const toLog = (count) => Math.log(count + 0.5);
export const fromLog = (y) => Math.max(0, Math.exp(y) - 0.5);

export const N_CLASSES = 3;
export const CLASS_LABELS = ['Monday to Friday', 'weekend', 'holiday'];
/** 0 = Monday-Friday, 1 = weekend, 2 = modelled holiday. */
export function dayClass(isoDate) {
  if (holidayOn(isoDate)) return 2;
  const d = dow(isoDate);
  return d === 0 || d === 6 ? 1 : 0;
}

/**
 * Turn dated counts into model inputs. A count of null/undefined/NaN means
 * "no usable record" and is treated as missing, never as zero.
 */
export function prepareSeries(dates, counts) {
  const T = dates.length;
  const y = new Float64Array(T);
  const cls = new Uint8Array(T);
  const rows = new Array(T);
  for (let t = 0; t < T; t++) {
    const c = counts[t];
    y[t] = c == null || !Number.isFinite(c) ? NaN : toLog(c);
    cls[t] = dayClass(dates[t]);
    rows[t] = featureIdx(dates[t]);
  }
  return { y, rows, cls, lastDate: dates[T - 1] };
}

// In-place Cholesky of a symmetric positive-definite p x p matrix (row-major).
function cholesky(A, p) {
  for (let j = 0; j < p; j++) {
    let s = A[j * p + j];
    for (let k = 0; k < j; k++) s -= A[j * p + k] * A[j * p + k];
    const d = Math.sqrt(s);
    A[j * p + j] = d;
    for (let i = j + 1; i < p; i++) {
      let v = A[i * p + j];
      for (let k = 0; k < j; k++) v -= A[i * p + k] * A[j * p + k];
      A[i * p + j] = v / d;
    }
  }
}

const PHI_MAX = 0.9;

/**
 * @param {{y: Float64Array, rows: number[][], cls: Uint8Array, lastDate: string}} data
 * @param {{chains:number, warmup:number, draws:number, seed:number, kappa:number, priors:object}} s
 * @param {(fraction:number)=>void} [onProgress]
 */
export function fitModel(data, s, onProgress) {
  const { rows, cls } = data;
  const T = data.y.length;
  const p = N_FEATURES;
  const { chains, warmup, draws, kappa, priors } = s;
  const S = chains * draws;
  const k2 = kappa * kappa;
  const precBeta = 1 / (priors.betaSd * priors.betaSd);
  const precPhi = 1 / (priors.phiSd * priors.phiSd);

  const missing = [];
  let firstObs = -1;
  for (let t = 0; t < T; t++) {
    if (Number.isFinite(data.y[t])) { if (firstObs < 0) firstObs = t; } else missing.push(t);
  }
  const nObs = T - missing.length;
  if (nObs < 60) throw new Error(`Too few usable days to fit the model (${nObs}).`);
  const isMissing = new Uint8Array(T);
  for (const t of missing) isMissing[t] = 1;

  const out = {
    T, p, S, chains, drawsPerChain: draws, kappa, lastDate: data.lastDate,
    beta: new Float64Array(S * p),
    phi: new Float64Array(S),
    sigma2: new Float64Array(S * N_CLASSES),
    tau2: new Float64Array(S),
    pi: new Float64Array(S),
    muT: new Float64Array(S),
    aT: new Float64Array(S),
    zProb: new Float64Array(T),
    muMean: new Float64Array(T),
    nMissing: missing.length,
  };

  const y = new Float64Array(T);
  const mu = new Float64Array(T);
  const xb = new Float64Array(T);
  const a = new Float64Array(T);
  const V = new Float64Array(T);
  // filtered moments of the state (level_t, level_{t-1})
  const m1 = new Float64Array(T), m2 = new Float64Array(T);
  const c11 = new Float64Array(T), c12 = new Float64Array(T), c22 = new Float64Array(T);
  const P = new Float64Array(p * p);
  const rhs = new Float64Array(p);
  const u = new Float64Array(p);
  const xi = new Int32Array(8), xv = new Float64Array(8);
  const total = chains * (warmup + draws);
  let done = 0;

  for (let c = 0; c < chains; c++) {
    const rng = makeRng(hashSeed(s.seed, 'chain', c));
    const beta = new Float64Array(p);
    for (let j = 0; j < p; j++) beta[j] = 0.1 * rng.normal();
    const sigma2 = new Float64Array(N_CLASSES);
    for (let k = 0; k < N_CLASSES; k++) sigma2[k] = 0.004 * Math.exp(0.7 * rng.normal());
    let tau2 = (priors.tauB / priors.tauA) * Math.exp(0.3 * rng.normal());
    let phi = 0.2 + 0.2 * rng.uniform();
    let pi = priors.piA / (priors.piA + priors.piB);
    const z = new Uint8Array(T);

    // start missing days from the nearest earlier (or first) usable value
    y.set(data.y);
    for (const t of missing) y[t] = t > firstObs ? y[t - 1] : data.y[firstObs];
    const m0 = y[0], C0 = 1;

    for (let it = 0; it < warmup + draws; it++) {
      const phi2 = phi * phi;
      for (let t = 0; t < T; t++) {
        const r = rows[t];
        let v = 0;
        for (let k = 0; k < r.length; k++) v += beta[r[k]];
        xb[t] = v;
        V[t] = z[t] ? sigma2[cls[t]] * k2 : sigma2[cls[t]];
      }

      // ---- 1. level path | rest ------------------------------------------
      // t = 0: y_0 - xb_0 = level_0 + a_0, a_0 ~ Normal(0, V_0 / (1 - phi^2))
      {
        const V0 = V[0] / (1 - phi2);
        const K = C0 / (C0 + V0);
        m1[0] = m0 + K * (y[0] - xb[0] - m0);
        c11[0] = C0 * (1 - K);
        m2[0] = m1[0]; c12[0] = c11[0]; c22[0] = c11[0];
      }
      // t >= 1: (y_t - xb_t) - phi (y_{t-1} - xb_{t-1}) = level_t - phi level_{t-1} + e_t
      for (let t = 1; t < T; t++) {
        const mp = m1[t - 1], cp = c11[t - 1];
        const R11 = cp + tau2;                 // predicted cov of (level_t, level_{t-1})
        const rf0 = (1 - phi) * cp + tau2;     // R F', with F = [1, -phi]
        const rf1 = (1 - phi) * cp;
        const Qv = rf0 - phi * rf1 + V[t];
        const k0 = rf0 / Qv, k1 = rf1 / Qv;
        const innov = (y[t] - xb[t]) - phi * (y[t - 1] - xb[t - 1]) - (1 - phi) * mp;
        m1[t] = mp + k0 * innov;
        m2[t] = mp + k1 * innov;
        c11[t] = R11 - k0 * rf0;
        c12[t] = cp - k0 * rf1;
        c22[t] = cp - k1 * rf1;
      }
      // backward: level_{t-1} | level_t, y_{1:t} comes from the filtered state at t
      mu[T - 1] = m1[T - 1] + Math.sqrt(Math.max(c11[T - 1], 0)) * rng.normal();
      for (let t = T - 1; t >= 1; t--) {
        const b = c12[t] / c11[t];
        const v = Math.max(c22[t] - b * c12[t], 0);
        mu[t - 1] = m2[t] + b * (mu[t] - m1[t]) + Math.sqrt(v) * rng.normal();
      }

      // ---- 2. beta | rest -------------------------------------------------
      P.fill(0); rhs.fill(0);
      for (let j = 0; j < p; j++) P[j * p + j] = precBeta;
      for (let t = 0; t < T; t++) {
        let n = 0, target, w;
        const r = rows[t];
        if (t === 0) {
          for (let k = 0; k < r.length; k++) { xi[n] = r[k]; xv[n++] = 1; }
          target = y[0] - mu[0];
          w = (1 - phi2) / V[0];
        } else {
          for (let k = 0; k < r.length; k++) { xi[n] = r[k]; xv[n++] = 1; }
          const q = rows[t - 1];
          for (let k = 0; k < q.length; k++) {
            let found = -1;
            for (let j = 0; j < n; j++) if (xi[j] === q[k]) { found = j; break; }
            if (found >= 0) xv[found] -= phi; else { xi[n] = q[k]; xv[n++] = -phi; }
          }
          target = (y[t] - mu[t]) - phi * (y[t - 1] - mu[t - 1]);
          w = 1 / V[t];
        }
        for (let i = 0; i < n; i++) {
          rhs[xi[i]] += w * xv[i] * target;
          for (let j = 0; j < n; j++) P[xi[i] * p + xi[j]] += w * xv[i] * xv[j];
        }
      }
      cholesky(P, p);
      for (let i = 0; i < p; i++) {
        let v = rhs[i];
        for (let k = 0; k < i; k++) v -= P[i * p + k] * u[k];
        u[i] = v / P[i * p + i];
      }
      for (let i = 0; i < p; i++) u[i] += rng.normal();
      for (let i = p - 1; i >= 0; i--) {
        let v = u[i];
        for (let k = i + 1; k < p; k++) v -= P[k * p + i] * beta[k];
        beta[i] = v / P[i * p + i];
      }

      // ---- carry-over series a_t = y_t - level_t - calendar_t
      for (let t = 0; t < T; t++) {
        const r = rows[t];
        let v = 0;
        for (let k = 0; k < r.length; k++) v += beta[r[k]];
        xb[t] = v;
        a[t] = y[t] - mu[t] - v;
      }

      // ---- 3. phi | rest (truncated normal) --------------------------------
      {
        let sxx = precPhi, sxy = 0;
        for (let t = 1; t < T; t++) { const w = 1 / V[t]; sxx += w * a[t - 1] * a[t - 1]; sxy += w * a[t] * a[t - 1]; }
        const mean = sxy / sxx, sd = 1 / Math.sqrt(sxx);
        let cand = phi, ok = false;
        for (let k = 0; k < 60 && !ok; k++) { cand = mean + sd * rng.normal(); ok = cand > -PHI_MAX && cand < PHI_MAX; }
        phi = ok ? cand : Math.max(-PHI_MAX + 1e-6, Math.min(PHI_MAX - 1e-6, mean));
      }

      // ---- 4. sigma_c^2 | rest ---------------------------------------------
      // e_t = a_t - phi a_{t-1}; the first day is scaled to the same variance.
      const ssq = [0, 0, 0], cnt = [0, 0, 0];
      const e0 = a[0] * Math.sqrt(1 - phi * phi);
      for (let t = 0; t < T; t++) {
        const e = t === 0 ? e0 : a[t] - phi * a[t - 1];
        V[t] = e; // reuse V as the innovation buffer until the end of the sweep
        ssq[cls[t]] += z[t] ? (e * e) / k2 : e * e;
        cnt[cls[t]]++;
      }
      for (let k = 0; k < N_CLASSES; k++) sigma2[k] = rng.invGamma(priors.sigA + cnt[k] / 2, priors.sigB + ssq[k] / 2);

      // ---- 5. tau^2 | rest --------------------------------------------------
      let sd2 = 0;
      for (let t = 1; t < T; t++) { const d = mu[t] - mu[t - 1]; sd2 += d * d; }
      tau2 = rng.invGamma(priors.tauA + (T - 1) / 2, priors.tauB + sd2 / 2);

      // ---- 6. z_t | rest, pi | z --------------------------------------------
      const odds0 = ((1 - pi) / pi) * kappa;
      const cz = (1 - 1 / k2) / 2;
      let nz = 0;
      for (let t = 0; t < T; t++) {
        const e = V[t];
        const pz = 1 / (1 + odds0 * Math.exp((-e * e * cz) / sigma2[cls[t]]));
        z[t] = rng.uniform() < pz ? 1 : 0;
        nz += z[t];
      }
      pi = rng.beta(priors.piA + nz, priors.piB + T - nz);

      // ---- 7. missing days | rest (data augmentation) -----------------------
      for (let i = 0; i < missing.length; i++) {
        const t = missing[i];
        const vt = z[t] ? sigma2[cls[t]] * k2 : sigma2[cls[t]];
        let prec, num;
        if (t === 0) { prec = (1 - phi * phi) / vt; num = 0; }
        else { prec = 1 / vt; num = (phi * a[t - 1]) / vt; }
        if (t < T - 1) {
          const vn = z[t + 1] ? sigma2[cls[t + 1]] * k2 : sigma2[cls[t + 1]];
          prec += (phi * phi) / vn;
          num += (phi * a[t + 1]) / vn;
        }
        a[t] = num / prec + rng.normal() / Math.sqrt(prec);
        y[t] = mu[t] + xb[t] + a[t];
      }

      // ---- record
      if (it >= warmup) {
        const k = c * draws + (it - warmup);
        out.beta.set(beta, k * p);
        out.phi[k] = phi;
        out.sigma2.set(sigma2, k * N_CLASSES);
        out.tau2[k] = tau2;
        out.pi[k] = pi;
        out.muT[k] = mu[T - 1];
        out.aT[k] = a[T - 1];
        for (let t = 0; t < T; t++) { out.zProb[t] += z[t]; out.muMean[t] += mu[t]; }
      }
      done++;
      if (onProgress && done % 250 === 0) onProgress(done / total);
    }
  }
  for (let t = 0; t < T; t++) {
    out.zProb[t] = isMissing[t] ? NaN : out.zProb[t] / S;
    out.muMean[t] /= S;
  }
  out.diag = diagnose(out);
  if (onProgress) onProgress(1);
  return out;
}

/** One named column of posterior draws, for summaries and diagnostics. */
export function drawsOf(fit, name) {
  const { S, p } = fit;
  const o = new Float64Array(S);
  if (name.startsWith('beta:')) { const j = +name.slice(5); for (let i = 0; i < S; i++) o[i] = fit.beta[i * p + j]; }
  else if (name.startsWith('sigma:')) { const k = +name.slice(6); for (let i = 0; i < S; i++) o[i] = Math.sqrt(fit.sigma2[i * N_CLASSES + k]); }
  else if (name === 'tau') for (let i = 0; i < S; i++) o[i] = Math.sqrt(fit.tau2[i]);
  else o.set(fit[name]);
  return o;
}

/** Split R-hat and effective sample size for every monitored quantity. */
export function diagnose(fit) {
  const { chains, drawsPerChain: n, p } = fit;
  const names = ['sigma:0', 'sigma:1', 'sigma:2', 'tau', 'phi', 'pi', 'muT'];
  for (let j = 0; j < p; j++) names.push(`beta:${j}`);
  const items = names.map((name) => ({ name, ...rhatEss(drawsOf(fit, name), chains, n) }));
  const finite = items.filter((d) => Number.isFinite(d.rhat));
  const maxRhat = Math.max(...finite.map((d) => d.rhat));
  const minEss = Math.min(...finite.map((d) => d.ess));
  return {
    items, maxRhat, minEss,
    ok: maxRhat <= RHAT_LIMIT && minEss >= ESS_LIMIT,
    rhatLimit: RHAT_LIMIT, essLimit: ESS_LIMIT,
  };
}
