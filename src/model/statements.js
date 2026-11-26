// Deterministic, rule-based statements built from the same facts the language
// model receives. They are used (a) as the fallback when a machine-written
// statement fails validation and (b) on the page whenever the reader changes a
// setting, because a published sentence must never describe numbers that are
// no longer on the chart.

import { plural } from './format.js';

const listNames = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

export function volumeTitle(f) {
  const v = f.volume;
  const n = v.days_outside_expected_range;
  const p = v.days_outside_phrase;
  const tail = n === 0
    ? ` ${p.charAt(0).toUpperCase() + p.slice(1)} fell outside its expected range.`
    : ` ${p} fell outside ${plural(n, 'its', 'their')} expected ${plural(n, 'range', 'ranges')}.`;
  if (v.latest_day_calls == null) return `${v.latest_day} has no usable record, so it cannot be judged.${tail}`;
  const range = v.latest_day_expected_range ? ` (${v.latest_day_expected_range})` : '';
  return `${v.latest_day}: ${v.latest_day_calls} calls, ${v.latest_day_status}${range}.${tail}`;
}

export function staffingTitle(f) {
  const s = f.staffing;
  if (!s.highest_shortfall_risk) return `No roster is on file for the next ${f.outlook_days} days, so the roster cannot be compared with the forecast.`;
  const h = s.highest_shortfall_risk;
  if (s.days_with_shortfall_risk > 0) {
    return `Shortfall risk reaches ${h.shortfall_risk} on ${h.day}: ${s.days_at_or_above_threshold_phrase} ${plural(s.days_with_shortfall_risk, 'is', 'are')} at or above the ${s.action_threshold} action threshold.`;
  }
  if (s.days_over_rostered > 0) {
    return `Shortfall risk peaks at ${h.shortfall_risk} on ${h.day}, so ${s.days_at_or_above_threshold_phrase} is at or above the ${s.action_threshold} action threshold; the roster is very likely too large on ${s.days_over_rostered} of them.`;
  }
  return `The roster holds: shortfall risk peaks at ${h.shortfall_risk} on ${h.day}, and ${s.days_at_or_above_threshold_phrase} is at or above the ${s.action_threshold} action threshold.`;
}

export function topicsTitle(f) {
  const t = f.topics;
  const v = f.volume;
  const weekPart = v.last_7_days_total == null
    ? 'The last 7 days include a day with no usable record, so their total cannot be judged.'
    : `All calls over the last 7 days: ${v.last_7_days_total}, ${v.last_7_days_status}${v.last_7_days_expected_range ? ` (${v.last_7_days_expected_range})` : ''}.`;
  if (t.topics_outside_expected_range === 0) {
    return `${weekPart} All ${t.topics_tracked} topics are within their expected ranges.`;
  }
  const shown = t.outside.slice(0, 3).map((o) => `${o.topic} (${o.last_7_days_calls} calls, ${o.status}; expected ${o.expected_range})`);
  const more = t.outside.length > 3 ? ` and ${t.outside.length - 3} more` : '';
  return `${weekPart} ${t.topics_outside_expected_range} of ${t.topics_tracked} topics ${plural(t.topics_outside_expected_range, 'is', 'are')} outside the expected range: ${listNames(shown)}${more}.`;
}

export function headline(f) {
  if (f.overall === 'no_rule_triggered') {
    // Evidence, not just the verdict: the day's count, then the roster's margin (or the week's total).
    const v = f.volume;
    const h = f.staffing.highest_shortfall_risk;
    const dayPart = v.latest_day_calls == null
      ? `${v.latest_day} has no usable record`
      : `${v.latest_day} had ${v.latest_day_calls} calls, ${v.latest_day_status}`;
    const tail = h
      ? ` The roster holds for the next ${f.outlook_days} days: the highest shortfall risk is ${h.shortfall_risk}, on ${h.day}.`
      : v.last_7_days_total != null ? ` The last 7 days had ${v.last_7_days_total} calls, ${v.last_7_days_status}.` : '';
    return `No action needed. ${dayPart}, and no rule has fired.${tail}`;
  }
  const parts = f.triggered_rules.map((r) => `${r.rule} (${r.responder})`);
  return `Action needed: ${parts.join('; ')}.`;
}

export function templateStatements(f) {
  return {
    headline: headline(f),
    volume_title: volumeTitle(f),
    staffing_title: staffingTitle(f),
    topics_title: topicsTitle(f),
  };
}
