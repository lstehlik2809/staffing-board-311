// Fits the headline model in the reader's browser, off the main thread.
// Same code and seed as the daily pipeline, so the result can be compared.
import { fitModel, prepareSeries, drawsOf, CLASS_LABELS } from '../model/gibbs.js';
import { dateRange, addDays, FEATURES } from '../model/calendar.js';
import { forecastDays, outlookBasis } from '../model/board.js';
import { summarise } from '../model/predict.js';

self.onmessage = (ev) => {
  const { id, series, settings, planningDay, horizon, outlookDays, rules } = ev.data;
  try {
    const t0 = performance.now();
    const dates = dateRange(series.start, series.end);
    const data = prepareSeries(dates, series.counts);
    let last = 0;
    const fit = fitModel(data, settings, (f) => {
      const now = performance.now();
      if (now - last > 80) { last = now; self.postMessage({ id, type: 'progress', fraction: f }); }
    });
    const forecast = forecastDays(fit, addDays(series.end, 1), addDays(series.end, horizon));
    const basis = outlookBasis({ fit, planningDay, days: outlookDays, rules });
    const round = (o) => ({ q05: +o.q05.toFixed(4), q50: +o.q50.toFixed(4), q95: +o.q95.toFixed(4) });
    const params = [
      ...CLASS_LABELS.map((label, k) => ({ key: `sigma:${k}`, label: `Ordinary day-to-day noise, ${label}`, ...round(summarise(drawsOf(fit, `sigma:${k}`))) })),
      { key: 'tau', label: 'Daily drift of the level', ...round(summarise(drawsOf(fit, 'tau'))) },
      { key: 'phi', label: 'One-day carry-over', ...round(summarise(drawsOf(fit, 'phi'))) },
      { key: 'pi', label: 'Share of exceptional days', ...round(summarise(drawsOf(fit, 'pi'))) },
      ...FEATURES.map((f, j) => ({ key: `beta:${j}`, label: f.label, ...round(summarise(drawsOf(fit, `beta:${j}`))) })),
    ];
    self.postMessage({
      id, type: 'done', ms: Math.round(performance.now() - t0),
      forecast, basis, params,
      diag: { maxRhat: fit.diag.maxRhat, minEss: fit.diag.minEss, ok: fit.diag.ok, rhatLimit: fit.diag.rhatLimit, essLimit: fit.diag.essLimit },
      draws: fit.S,
    });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String(err && err.message ? err.message : err) });
  }
};
