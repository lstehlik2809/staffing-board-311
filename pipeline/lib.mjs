// Shared helpers for the pipeline: NYC Open Data queries, file I/O, dates.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const p = (...parts) => path.join(ROOT, ...parts);

export const DATASET = {
  id: 'wewp-mm3p',
  name: '311 Call Center Inquiry',
  publisher: 'NYC Open Data (NYC 311)',
  page: 'https://data.cityofnewyork.us/City-Government/311-Call-Center-Inquiry/wewp-mm3p',
  api: 'https://data.cityofnewyork.us/resource/wewp-mm3p.json',
};

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
export function writeJson(file, obj, pretty = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, pretty ? 2 : 0) + '\n');
}

/** Today's date in New York, as YYYY-MM-DD. */
export const nyToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);

export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One SoQL query against the dataset, with retries. */
export async function soql(params) {
  const url = `${DATASET.api}?${new URLSearchParams(params)}`;
  const headers = { Accept: 'application/json' };
  if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error(`Unexpected response: ${JSON.stringify(rows).slice(0, 200)}`);
      return rows;
    } catch (err) {
      lastErr = err;
      log(`  query failed (attempt ${attempt}): ${err.message}`);
      await sleep(3000 * attempt);
    }
  }
  throw new Error(`NYC Open Data query failed after retries: ${lastErr.message}`);
}

const ts = (iso) => `${iso}T00:00:00`;
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Calls per day since `start` → { 'YYYY-MM-DD': n }. Days with no rows are absent. */
export async function fetchDailyTotals(start) {
  const rows = await soql({ $select: 'date,count(*) as n', $where: `date >= '${ts(start)}'`, $group: 'date', $order: 'date', $limit: '6000' });
  return Object.fromEntries(rows.map((r) => [r.date.slice(0, 10), +r.n]));
}

/** Timestamp of the most recent record ('YYYY-MM-DDTHH:MM:SS'). */
export async function fetchLastTimestamp(sinceIso) {
  const rows = await soql({ $select: 'max(date_time) as ts', $where: `date >= '${ts(sinceIso)}'` });
  return rows[0]?.ts?.slice(0, 19) ?? null;
}

/** Highest-volume call topics between two dates (inclusive). */
export async function fetchTopTopics(start, end, n) {
  const rows = await soql({
    $select: 'inquiry_name,count(*) as n',
    $where: `date >= '${ts(start)}' AND date <= '${ts(end)}' AND inquiry_name IS NOT NULL`,
    $group: 'inquiry_name', $order: 'n DESC, inquiry_name', $limit: String(n),
  });
  return rows.map((r) => ({ name: r.inquiry_name, calls: +r.n }));
}

/** Daily calls per topic since `start` → { topic: { date: n } }. */
export async function fetchTopicDaily(names, start) {
  const rows = await soql({
    $select: 'date,inquiry_name,count(*) as n',
    $where: `date >= '${ts(start)}' AND inquiry_name in (${names.map(quote).join(',')})`,
    $group: 'date,inquiry_name', $limit: '50000',
  });
  const out = Object.fromEntries(names.map((n) => [n, {}]));
  for (const r of rows) out[r.inquiry_name][r.date.slice(0, 10)] = +r.n;
  return out;
}

/** Calls by weekday (0 = Sunday) and hour between two dates, excluding listed dates. */
export async function fetchHourly(start, end, excludeDates) {
  const excl = excludeDates.length ? ` AND date not in (${excludeDates.map((d) => quote(`${ts(d)}.000`)).join(',')})` : '';
  const rows = await soql({
    $select: 'date_extract_dow(date_time) as dow,date_extract_hh(date_time) as hh,count(*) as n',
    $where: `date >= '${ts(start)}' AND date <= '${ts(end)}'${excl}`,
    $group: 'dow,hh', $limit: '500',
  });
  return rows.map((r) => ({ dow: +r.dow, hh: +r.hh, n: +r.n }));
}
