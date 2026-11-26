// Calendar helpers. Dates are ISO strings (YYYY-MM-DD) in New York local time,
// handled as UTC day numbers so no time-zone arithmetic can shift a day.

const MS_DAY = 86400000;

export const dayNum = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / MS_DAY);
export const isoFromDayNum = (n) => new Date(n * MS_DAY).toISOString().slice(0, 10);
export const addDays = (iso, k) => isoFromDayNum(dayNum(iso) + k);
export const diffDays = (a, b) => dayNum(a) - dayNum(b);
export const dow = (iso) => new Date(dayNum(iso) * MS_DAY).getUTCDay(); // 0 = Sunday

export function dateRange(startIso, endIso) {
  const out = [];
  for (let n = dayNum(startIso), e = dayNum(endIso); n <= e; n++) out.push(isoFromDayNum(n));
  return out;
}

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Tue 24 Nov" */
export const fmtDay = (iso) => `${DOW_SHORT[dow(iso)]} ${+iso.slice(8, 10)} ${MONTH_SHORT[+iso.slice(5, 7) - 1]}`;
/** "24 Nov" */
export const fmtDayShort = (iso) => `${+iso.slice(8, 10)} ${MONTH_SHORT[+iso.slice(5, 7) - 1]}`;
/** "Tuesday 24 November 2026" style, short month */
export const fmtDayLong = (iso) => `${DOW_LONG[dow(iso)]} ${+iso.slice(8, 10)} ${MONTH_SHORT[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
export const dowShort = (iso) => DOW_SHORT[dow(iso)];

// ---- Holidays -------------------------------------------------------------

function nthWeekday(year, month, weekday, n) {
  // n-th given weekday (0 = Sun) of a month (1-12); n = -1 means the last one.
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    return iso(year, month, day);
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDow = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return iso(year, month, lastDay - ((lastDow - weekday + 7) % 7));
}
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const yearCache = new Map();
function holidaysOfYear(year) {
  if (yearCache.has(year)) return yearCache.get(year);
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  const list = [
    [iso(year, 1, 1), "New Year's Day", 'major'],
    [nthWeekday(year, 1, 1, 3), 'Martin Luther King Jr. Day', 'federal'],
    [nthWeekday(year, 2, 1, 3), "Presidents' Day", 'minor'],
    [nthWeekday(year, 5, 1, -1), 'Memorial Day', 'federal'],
    [iso(year, 6, 19), 'Juneteenth', 'minor'],
    [iso(year, 7, 4), 'Independence Day', 'federal'],
    [nthWeekday(year, 9, 1, 1), 'Labor Day', 'federal'],
    [nthWeekday(year, 10, 1, 2), 'Columbus / Indigenous Peoples Day', 'minor'],
    [iso(year, 11, 11), 'Veterans Day', 'minor'],
    [thanksgiving, 'Thanksgiving', 'major'],
    [addDays(thanksgiving, 1), 'Day after Thanksgiving', 'bridge'],
    [iso(year, 12, 24), 'Christmas Eve', 'bridge'],
    [iso(year, 12, 25), 'Christmas Day', 'major'],
    [iso(year, 12, 31), "New Year's Eve", 'bridge'],
  ];
  const map = new Map(list.map(([d, name, cls]) => [d, { name, cls }]));
  yearCache.set(year, map);
  return map;
}

/**
 * Holiday on a given date, or null. Holidays are modelled only when they fall
 * on Monday-Friday: weekend call volumes barely change on a holiday.
 */
export function holidayOn(isoDate) {
  const d = dow(isoDate);
  if (d === 0 || d === 6) return null;
  return holidaysOfYear(+isoDate.slice(0, 4)).get(isoDate) || null;
}

/** True for a weekday that directly follows a federal or minor weekday holiday. */
export function isAfterHoliday(isoDate) {
  const d = dow(isoDate);
  if (d === 0 || d === 6 || holidayOn(isoDate)) return false;
  const prev = holidayOn(addDays(isoDate, -1));
  return !!prev && (prev.cls === 'federal' || prev.cls === 'minor');
}

// ---- Model features -------------------------------------------------------
// Monday is the reference weekday; every feature is a 0/1 indicator.

export const FEATURES = [
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
  { key: 'h_major', label: 'Major holiday (Thanksgiving, Christmas, New Year)' },
  { key: 'h_federal', label: 'Federal holiday (MLK, Memorial, 4 July, Labor Day)' },
  { key: 'h_minor', label: "Minor holiday (Presidents', Juneteenth, Columbus, Veterans)" },
  { key: 'h_bridge', label: 'Holiday eve or bridge day' },
  { key: 'h_after', label: 'Day after a holiday' },
];
export const N_FEATURES = FEATURES.length;
const DOW_COL = [5, -1, 0, 1, 2, 3, 4]; // Sunday → col 5, Monday → none, Tuesday → 0 ...
const HOL_COL = { major: 6, federal: 7, minor: 8, bridge: 9 };

/** Indices of the active (value 1) features for a date. */
export function featureIdx(isoDate) {
  const out = [];
  const c = DOW_COL[dow(isoDate)];
  if (c >= 0) out.push(c);
  const h = holidayOn(isoDate);
  if (h) out.push(HOL_COL[h.cls]);
  else if (isAfterHoliday(isoDate)) out.push(10);
  return out;
}

/** 'weekday' | 'sat' | 'sun' — used to pick an intraday call profile. */
export function dayType(isoDate) {
  const d = dow(isoDate);
  return d === 0 ? 'sun' : d === 6 ? 'sat' : 'weekday';
}
