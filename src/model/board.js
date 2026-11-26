// Decision logic shared by the daily pipeline and the page: forecasts, the
// staffing outlook, the four signal rules, and the "facts" object from which
// every statement (machine-written or template) is produced. Nothing here calls
// a language model: all numbers and verdicts come from this code.

import { PROBS, Q } from './config.js';
import { addDays, diffDays, dayType, holidayOn, fmtDay } from './calendar.js';
import { components, quantilesCount, quantileLog, exceedProb } from './predict.js';
import { fromLog } from './gibbs.js';
import { rosterFor, capacityCalls } from './staffing.js';
import { fmtInt, fmtRange, fmtProb } from './format.js';

/** 'within' | 'above' | 'below' relative to control limits. */
export const statusVs = (actual, lo, hi) => (actual > hi ? 'above' : actual < lo ? 'below' : 'within');

/** Which intraday profile a date uses: big holidays behave like a Sunday. */
export function profileType(isoDate) {
  const h = holidayOn(isoDate);
  if (h && (h.cls === 'major' || h.cls === 'federal')) return 'sun';
  return dayType(isoDate);
}

/** Forecast quantiles (ordinary-day predictive) for days fromDate..toDate. */
export function forecastDays(fit, fromDate, toDate) {
  const out = [];
  for (let d = fromDate; diffDays(d, toDate) <= 0; d = addDays(d, 1)) {
    const h = diffDays(d, fit.lastDate);
    if (h < 1) continue;
    const q = quantilesCount(components(fit, h), PROBS).map(Math.round);
    const hol = holidayOn(d);
    out.push({ date: d, h, q, holiday: hol ? hol.name : null });
  }
  return out;
}

/**
 * The expensive, assumption-free part of the staffing outlook: for each day,
 * the predictive distribution of calls. Computed once per model fit.
 */
export function outlookBasis({ fit, planningDay, days, rules }) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(planningDay, i);
    const h = diffDays(date, fit.lastDate);
    const comp = components(fit, h);
    const hol = holidayOn(date);
    out.push({
      date, h, comp,
      holiday: hol ? hol.name : null,
      qCalls: quantilesCount(comp, [0.05, 0.25, 0.5, 0.75, 0.95]),
      // calls at the percentile that brings shortfall risk down to the action threshold
      callsAtRisk: fromLog(quantileLog(comp, 1 - rules.shortfallProb, false)),
    });
  }
  return out;
}

/**
 * Staffing outlook: required agents against rostered agents, day by day.
 * locked: { [date]: calls at the roster percentile of the forecast made at lock time }
 * rosterAdjust: agents added to (or removed from) every day's roster by the reader.
 */
export function staffingOutlook({ basis, locked, peakShare, st, rules, rosterAdjust = 0 }) {
  return basis.map((b) => {
    const share = peakShare[profileType(b.date)];
    const req = b.qCalls.map((calls) => rosterFor(calls, share, st));
    const row = {
      date: b.date, h: b.h, holiday: b.holiday, peakShare: share,
      calls: b.qCalls.map(Math.round),
      required: { q05: req[0], q25: req[1], q50: req[2], q75: req[3], q95: req[4] },
    };
    const lockedCalls = locked[b.date];
    if (lockedCalls == null) {
      return { ...row, rostered: null, shortfallProb: null, surplusProb: null, status: 'no_roster', addAgents: null };
    }
    const rostered = Math.max(1, rosterFor(lockedCalls, share, st) + rosterAdjust);
    // P(required > rostered) = P(calls > the most calls this roster can serve)
    const cap = capacityCalls(rostered, share, st);
    const shortfallProb = exceedProb(b.comp, cap);
    const lowRoster = Math.floor(rules.surplusShare * rostered);
    const surplusProb = lowRoster >= 1 ? 1 - exceedProb(b.comp, capacityCalls(lowRoster, share, st)) : 0;
    const addAgents = Math.max(0, rosterFor(b.callsAtRisk, share, st) - rostered);
    const status = shortfallProb >= rules.shortfallProb ? 'shortfall'
      : surplusProb >= rules.surplusProb ? 'surplus' : 'holds';
    return { ...row, lockedCalls: Math.round(lockedCalls), rostered, capacity: cap, shortfallProb, surplusProb, status, addAgents };
  });
}

// ---- Routine: the four rules, each with a defined response and responder ----
// Illustrative. A real team would agree these with the owner before building.

export const ROUTINE = {
  owner: 'Duty workforce planner',
  meeting: 'Daily staffing huddle, 09:00, ten minutes',
  quiet: 'If no rule has fired, the huddle confirms the roster and moves on.',
  rules: [
    {
      id: 'staffing',
      check: 'Roster against the forecast',
      name: 'Roster no longer fits the forecast',
      rule: 'For any of the next 7 days, the chance that required agents exceed rostered agents is 25% or more (or the roster is very likely more than 15% too large).',
      response: 'Offer overtime or call in the flex pool for that day; if over-rostered, offer voluntary time off or move agents to training.',
      responder: 'Duty workforce planner',
      deadline: '15:00 the day before',
    },
    {
      id: 'day',
      check: 'Latest day against its expected range',
      name: 'A day outside the expected range',
      rule: 'The latest complete day falls outside the range expected the day before.',
      response: 'Look for a known cause (weather, outage, city announcement) and log it. No roster change on one day alone.',
      responder: 'Duty workforce planner',
      deadline: 'Same day',
    },
    {
      id: 'week',
      check: 'Last 7 days against their expected range',
      name: 'A week outside the expected range',
      rule: 'The last 7 days together fall outside the range expected a week ago.',
      response: 'Re-base the forecast and review rosters for the next two weeks.',
      responder: 'Planning lead',
      deadline: 'Next weekly capacity review',
    },
    {
      id: 'topics',
      check: 'Call topics against their expected ranges',
      name: 'A call topic outside the expected range',
      rule: 'A topic’s last 7 days together fall outside the range expected a week ago.',
      response: 'Brief agents, update the phone-menu message and the knowledge article, and tell the agency that owns the topic.',
      responder: 'Knowledge lead',
      deadline: 'Within one working day',
    },
  ],
};

/**
 * Evaluate the four rules.
 * day:   { date, calls, lo, hi, status }             (status 'incomplete' when no usable record)
 * week:  { start, end, total, lo, hi, status }
 * outlook: rows from staffingOutlook
 * topics: [{ name, latest: { total, lo, hi, status } }]
 */
export function evaluateSignals({ day, week, outlook, topics }) {
  const short = outlook.filter((r) => r.status === 'shortfall');
  const surplus = outlook.filter((r) => r.status === 'surplus');
  const flaggedTopics = topics.filter((t) => t.status === 'above' || t.status === 'below');
  return [
    { id: 'staffing', triggered: short.length + surplus.length > 0, shortfallDays: short.map((r) => r.date), surplusDays: surplus.map((r) => r.date) },
    { id: 'day', triggered: day.status === 'above' || day.status === 'below', status: day.status },
    { id: 'week', triggered: week.status === 'above' || week.status === 'below', status: week.status },
    { id: 'topics', triggered: flaggedTopics.length > 0, topics: flaggedTopics.map((t) => t.name) },
  ];
}

/** A rule outcome as the exact phrase every statement must use. */
function statusPhrase(status) {
  if (status === 'within') return 'within the expected range';
  if (status === 'above' || status === 'below') return `${status} the expected range`;
  if (status === 'incomplete') return 'no usable record';
  return 'no expected range on file';
}

/**
 * The facts handed to the language model (and to the template writer).
 * Every number is already formatted exactly as the page prints it.
 */
export function buildFacts({ asOf, planningDay, day, week, pastWindow, nextDay, outlook, topics, signals, rules }) {
  const rated = outlook.filter((r) => r.shortfallProb != null);
  const worst = rated.reduce((a, b) => (b.shortfallProb > (a ? a.shortfallProb : -1) ? b : a), null);
  const flagged = topics.filter((t) => t.status === 'above' || t.status === 'below');
  const routine = Object.fromEntries(ROUTINE.rules.map((r) => [r.id, r]));
  const triggered = signals.filter((s) => s.triggered).map((s) => s.id);
  return {
    data_through: fmtDay(asOf),
    planning_day: fmtDay(planningDay),
    outlook_days: outlook.length,
    overall: triggered.length === 0 ? 'no_rule_triggered' : 'rules_triggered',
    triggered_rules: triggered.map((id) => ({ rule: routine[id].name, defined_response: routine[id].response, responder: routine[id].responder })),
    volume: {
      latest_day: fmtDay(day.date),
      latest_day_status: statusPhrase(day.status),
      latest_day_calls: day.calls == null ? null : fmtInt(day.calls),
      latest_day_expected_range: day.lo == null ? null : fmtRange(day.lo, day.hi),
      days_shown: pastWindow.days,
      days_outside_expected_range: pastWindow.outside.length,
      days_outside_phrase: pastWindow.outside.length === 0
        ? `none of the ${pastWindow.days} days shown`
        : `${pastWindow.outside.length} of the ${pastWindow.days} days shown`,
      outside_days: pastWindow.outside.map((d) => ({ day: fmtDay(d.date), calls: fmtInt(d.calls), status: d.status, expected_range: fmtRange(d.lo, d.hi) })),
      // A week with a missing day has no total: null, never "0".
      last_7_days_total: week.total == null ? null : fmtInt(week.total),
      last_7_days_expected_range: week.lo == null ? null : fmtRange(week.lo, week.hi),
      last_7_days_status: week.total == null ? 'no usable record for one or more of these days' : statusPhrase(week.status),
      next_day_forecast: nextDay ? { day: fmtDay(nextDay.date), expected_range: fmtRange(nextDay.q[Q.lo3], nextDay.q[Q.hi3]), holiday: nextDay.holiday } : null,
    },
    staffing: {
      action_threshold: fmtProb(rules.shortfallProb),
      days: outlook.map((r) => ({
        day: fmtDay(r.date),
        shortfall_risk: r.shortfallProb == null ? null : fmtProb(r.shortfallProb),
        status: r.status === 'holds' ? 'roster holds' : r.status === 'shortfall' ? 'shortfall risk at or above threshold'
          : r.status === 'surplus' ? 'roster very likely too large' : 'no roster on file',
        holiday: r.holiday,
      })),
      days_with_shortfall_risk: outlook.filter((r) => r.status === 'shortfall').length,
      days_at_or_above_threshold_phrase: (() => {
        const k = outlook.filter((r) => r.status === 'shortfall').length;
        return `${k === 0 ? 'none' : k} of the next ${outlook.length} days`;
      })(),
      days_over_rostered: outlook.filter((r) => r.status === 'surplus').length,
      highest_shortfall_risk: worst ? { day: fmtDay(worst.date), shortfall_risk: fmtProb(worst.shortfallProb) } : null,
      planning_day_shortfall_risk: rated.length && rated[0].date === planningDay ? fmtProb(rated[0].shortfallProb) : null,
    },
    topics: {
      topics_tracked: topics.length,
      topics_outside_expected_range: flagged.length,
      outside: flagged.map((t) => ({ topic: t.name, status: t.status, last_7_days_calls: fmtInt(t.latest.total), expected_range: fmtRange(t.latest.lo, t.latest.hi) })),
    },
  };
}
