// Erlang C staffing arithmetic: turn a call volume into the number of agents
// needed to answer a target share of calls within a target time.
//
// Simplifications, stated on the board: one pooled queue, the busiest hour of
// the day decides the requirement, callers do not abandon, and the handle
// time, service level and shrinkage are illustrative assumptions.

/** Probability that an arriving call has to wait (Erlang C). */
export function erlangC(agents, load) {
  if (agents <= load) return 1;
  let b = 1; // Erlang B by stable recursion
  for (let k = 1; k <= agents; k++) b = (load * b) / (k + load * b);
  return (agents * b) / (agents - load * (1 - b));
}

/** Share of calls answered within `answerSec`. */
export function serviceLevel(agents, load, ahtSec, answerSec) {
  if (agents <= load) return 0;
  return 1 - erlangC(agents, load) * Math.exp((-(agents - load) * answerSec) / ahtSec);
}

/** Agents needed on the phones in an hour with `callsPerHour` arrivals. */
export function agentsOnPhones(callsPerHour, st) {
  const load = (callsPerHour * st.ahtSec) / 3600;
  let n = Math.max(1, Math.floor(load) + 1);
  while (serviceLevel(n, load, st.ahtSec, st.answerSec) < st.slTarget) n++;
  return n;
}

/** Agents to roster for the peak hour of a day, including shrinkage. */
export function rosterFor(callsPerDay, peakShare, st) {
  return Math.ceil(agentsOnPhones(callsPerDay * peakShare, st) / (1 - st.shrinkage));
}

/** Largest daily call volume a roster of `rostered` agents can serve at target. */
export function capacityCalls(rostered, peakShare, st) {
  if (rostered < 1 || rosterFor(0, peakShare, st) > rostered) return 0;
  let lo = 0, hi = 1000;
  while (rosterFor(hi, peakShare, st) <= rostered) hi *= 2;
  // Invariant: rosterFor(lo) <= rostered < rosterFor(hi)
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (rosterFor(mid, peakShare, st) <= rostered) lo = mid; else hi = mid;
  }
  return lo;
}
