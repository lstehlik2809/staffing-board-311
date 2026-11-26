// Statement writing. The language model receives only the facts object (numbers
// and verdicts already computed by code) and returns four sentences. Its output
// is checked by code before it can reach the page; if it fails twice, the
// rule-based template is published instead. Every run leaves an audit record:
// the inputs, the prompt, the raw output, the checks and what was published.
import crypto from 'node:crypto';
import path from 'node:path';
import { writeJson, readJson, log } from './lib.mjs';

// gpt-6.1-terra rather than gpt-6.2-sol: in a 2026-11-26 comparison on the board's
// own fact sets (12 runs each) both passed every check first time and wrote
// equally clear sentences; the code does the analysis, so a mid-size model is enough.
export const LLM = { model: 'gpt-6.1-terra', reasoningEffort: 'medium', promptVersion: '2026-11-26.5' };

export const SYSTEM_PROMPT = `You write the short statements on a contact-centre staffing board. A workforce planner reads them at a ten-minute daily huddle to decide whether tomorrow's roster needs changing.

You are given FACTS as JSON. A tested statistical model and fixed decision rules produced every number and every verdict in it. You do no analysis. You turn the facts into four plain statements.

Hard rules:
1. Use only numbers, day labels and topic names that appear in FACTS, copied character for character (for example "11,304", "9,873–12,478", "Tue 24 Nov", "4%"). Never calculate, round, combine or estimate a number.
2. State the verdict exactly as FACTS gives it: "within the expected range", "above the expected range" or "below the expected range". Do not use words such as up, down, spike, surge, drop, jump, stable, normal or unusual.
3. Give no causes and no explanations. Give no advice except the defined_response of a rule listed in triggered_rules.
4. Each statement must describe what its chart shows, leading with the conclusion.
5. Plain English, sentence case, no hedging, no exclamation marks, no emoji.

The four statements:
- headline: If overall is "no_rule_triggered", start with "No action needed." and then give the evidence in one or two sentences: the latest_day with its latest_day_calls and its exact latest_day_status phrase, and the highest_shortfall_risk value with its day. If either is null, use last_7_days_total instead. Never only restate the verdict (for example "No rule was triggered."). Otherwise start with "Action needed:" and, for each triggered rule, say in a few words what fired and who responds (use the responder exactly as written). Do not repeat the defined responses in full: the board lists them beside each rule. At most 45 words.
- volume_title: for the chart of daily calls against the range expected the day before. One or two sentences, at most 40 words. Lead with the latest day: it must name latest_day, latest_day_calls, the exact latest_day_status phrase and latest_day_expected_range. Then say how many of the days shown fell outside their expected range, using the exact days_outside_phrase as the subject (for example "None of the 42 days shown fell outside its expected range."). Never say or imply that all days were within range unless days_outside_expected_range is 0.
- staffing_title: for the chart of required agents against rostered agents over the next days. One sentence, at most 30 words. It must name the highest_shortfall_risk value and its day, and say how many days are at or above the action_threshold using the exact days_at_or_above_threshold_phrase.
- topics_title: for the small charts of 7-day call totals (all calls and each topic). One or two sentences, at most 45 words. Give the last_7_days_total for all calls with its exact last_7_days_status phrase, then the topics. If any topics are outside the expected range, say how many and name each one (at most three) with its status. If none are, say it once, positively: that all topics_tracked topics are within the expected range (for example "All 24 topics are within the expected range."). Do not also say that none are outside it. Do not write the digit 0 for a count of zero.

Return JSON only.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'volume_title', 'staffing_title', 'topics_title'],
  properties: {
    headline: { type: 'string' },
    volume_title: { type: 'string' },
    staffing_title: { type: 'string' },
    topics_title: { type: 'string' },
  },
};

const NUM = /\d[\d,]*(?:\.\d+)?%?/g;
const numberTokens = (s) => (String(s).match(NUM) || []).map((t) => t.replace(/[,.]$/, ''));
const words = (s) => s.trim().split(/\s+/).length;

function collectStrings(value, out = []) {
  if (value == null) return out;
  if (typeof value === 'string' || typeof value === 'number') out.push(String(value));
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

const BANNED = [
  'because', 'due to', 'driven by', 'caused', 'thanks to', 'as a result', 'owing to',
  'spike', 'surge', 'plunge', 'soar', 'jump', 'drop', 'unusual', 'normal', 'stable',
];
// Numbers written as words must also be numbers that appear in the facts.
const WORD_NUMBERS = { two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12' };
const LIMITS = { headline: 45, volume_title: 40, staffing_title: 30, topics_title: 45 };

/** Code-side checks of a set of statements against the facts. Returns violations. */
export function validateStatements(st, facts) {
  const problems = [];
  const allowed = new Set(collectStrings(facts).flatMap(numberTokens));
  for (const key of Object.keys(LIMITS)) {
    const text = st[key];
    if (typeof text !== 'string' || !text.trim()) { problems.push(`${key}: missing`); continue; }
    if (words(text) > LIMITS[key]) problems.push(`${key}: ${words(text)} words, limit is ${LIMITS[key]}`);
    for (const tok of numberTokens(text)) {
      if (!allowed.has(tok)) problems.push(`${key}: the number "${tok}" is not in FACTS`);
    }
    for (const [word, digit] of Object.entries(WORD_NUMBERS)) {
      if (new RegExp(`\\b${word}\\b`, 'i').test(text) && !allowed.has(digit)) problems.push(`${key}: the number "${word}" is not in FACTS`);
    }
    // Topic names are quoted from the data, so they are exempt from the word list.
    let lower = text.toLowerCase();
    for (const o of facts.topics.outside) lower = lower.split(o.topic.toLowerCase()).join(' ');
    for (const b of BANNED) {
      if (new RegExp(`\\b${b}`).test(lower)) problems.push(`${key}: uses the word "${b}", which is not allowed`);
    }
  }
  if (problems.some((x) => x.endsWith('missing'))) return problems;

  const v = facts.volume;
  const head = st.headline.trim();
  if (facts.overall === 'no_rule_triggered' && !head.startsWith('No action needed')) problems.push('headline: must start with "No action needed." because no rule was triggered');
  if (facts.overall === 'rules_triggered' && !head.startsWith('Action needed')) problems.push('headline: must start with "Action needed:" because a rule was triggered');
  if (facts.overall === 'rules_triggered') {
    for (const r of facts.triggered_rules) {
      if (!st.headline.includes(r.responder)) problems.push(`headline: must name the responder "${r.responder}"`);
    }
  }
  if (!st.volume_title.includes(v.latest_day)) problems.push(`volume_title: must name the day "${v.latest_day}"`);
  if (v.latest_day_calls != null) {
    if (!st.volume_title.includes(v.latest_day_calls)) problems.push(`volume_title: must give the calls "${v.latest_day_calls}"`);
    if (!st.volume_title.includes(v.latest_day_status)) problems.push(`volume_title: must use the exact phrase "${v.latest_day_status}"`);
    if (v.latest_day_expected_range != null && !st.volume_title.includes(v.latest_day_expected_range)) problems.push(`volume_title: must give the expected range "${v.latest_day_expected_range}"`);
  }
  if (!st.volume_title.toLowerCase().includes(v.days_outside_phrase.toLowerCase())) problems.push(`volume_title: must include the exact phrase "${v.days_outside_phrase}"`);
  if (v.last_7_days_total != null) {
    if (!st.topics_title.includes(v.last_7_days_total)) problems.push(`topics_title: must give the 7-day total for all calls "${v.last_7_days_total}"`);
    if (!st.topics_title.includes(v.last_7_days_status)) problems.push(`topics_title: must use the exact phrase "${v.last_7_days_status}" for all calls`);
  }
  const s = facts.staffing;
  if (s.highest_shortfall_risk) {
    if (!st.staffing_title.includes(s.highest_shortfall_risk.shortfall_risk)) problems.push(`staffing_title: must give the highest shortfall risk "${s.highest_shortfall_risk.shortfall_risk}"`);
    if (!st.staffing_title.includes(s.highest_shortfall_risk.day)) problems.push(`staffing_title: must name the day "${s.highest_shortfall_risk.day}"`);
    if (!st.staffing_title.toLowerCase().includes(s.days_at_or_above_threshold_phrase.toLowerCase())) problems.push(`staffing_title: must include the exact phrase "${s.days_at_or_above_threshold_phrase}"`);
  }

  // A "no action" headline must give its evidence: the latest day's calls and the
  // roster's margin (the highest shortfall risk), or the 7-day total where either is
  // missing. Compared token by token, so "5%" is not found inside "25%".
  if (facts.overall === 'no_rule_triggered') {
    const headTokens = new Set(numberTokens(head));
    const cites = (e) => head.includes(e) && numberTokens(e).every((tk) => headTokens.has(tk));
    const risk = s.highest_shortfall_risk;
    const required = [];
    if (v.latest_day_calls != null) required.push([v.latest_day_calls, 'the latest day’s calls']);
    if (risk) required.push([risk.shortfall_risk, 'the highest shortfall risk']);
    if (required.length < 2 && v.last_7_days_total != null) required.push([v.last_7_days_total, 'the 7-day total']);
    for (const [value, what] of required) {
      if (!cites(value)) problems.push(`headline: after "No action needed." it must give ${what}, "${value}"`);
    }
    if (risk && !head.includes(risk.day)) problems.push(`headline: must name the day of the highest shortfall risk, "${risk.day}"`);
    if (v.latest_day_calls != null && !head.includes(v.latest_day)) problems.push(`headline: must name the latest day, "${v.latest_day}"`);
  }

  const t = facts.topics;
  if (t.topics_outside_expected_range === 0) {
    // The all-calls verdict comes first and may itself be "above the expected range":
    // judge the topic part without that first occurrence (only that one).
    const topicPart = v.last_7_days_status ? st.topics_title.replace(v.last_7_days_status, ' ') : st.topics_title;
    if (/\b(above|below)\b/i.test(topicPart)) problems.push('topics_title: no topic is outside the expected range, so no topic may be called "above" or "below"');
    if (/\boutside\b|\bnone of\b|\bno topics?\b/i.test(topicPart)) problems.push(`topics_title: say only that all ${t.topics_tracked} topics are within the expected range, without also saying that none are outside it`);
    if (!/within/i.test(topicPart) || !numberTokens(topicPart).includes(String(t.topics_tracked))) problems.push(`topics_title: must say that all ${t.topics_tracked} topics are within the expected range`);
  } else {
    for (const o of t.outside.slice(0, 3)) {
      if (!st.topics_title.includes(o.topic)) problems.push(`topics_title: must name the topic "${o.topic}"`);
    }
  }
  return problems;
}

async function callModel(facts, feedback) {
  const input = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `FACTS:\n${JSON.stringify(facts, null, 2)}` },
  ];
  if (feedback) {
    input.push({ role: 'assistant', content: JSON.stringify(feedback.previous) });
    input.push({ role: 'user', content: `Your statements failed these checks:\n- ${feedback.problems.join('\n- ')}\nRewrite all four statements so that every check passes.` });
  }
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: LLM.model,
      reasoning: { effort: LLM.reasoningEffort },
      input,
      text: { format: { type: 'json_schema', name: 'board_statements', strict: true, schema: SCHEMA } },
    }),
    signal: AbortSignal.timeout(180000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${JSON.stringify(body.error || body).slice(0, 300)}`);
  const text = body.output_text
    || (body.output || []).flatMap((o) => o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
  return { statements: JSON.parse(text), responseId: body.id, modelReported: body.model, reasoningReported: body.reasoning || null, usage: body.usage || null };
}

/**
 * Produce the published statements and write the audit record.
 * Returns { statements, source: 'llm' | 'template', ... } for board.json.
 */
export async function narrate(facts, templates, { useLlm, auditDir, auditId, context, force = false }) {
  const factsHash = crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 16);
  const auditFile = path.join(auditDir, `${auditId}.json`);
  const base = {
    id: auditId, context, factsHash,
    llm: { ...LLM },
    systemPrompt: SYSTEM_PROMPT,
    facts,
    templates,
  };

  // Same facts, prompt and model as the last record for this id → nothing new to write or to pay for.
  const prior = readJson(auditFile);
  // `force` rewrites them anyway (for example to test the API key on unchanged data).
  if (!force && prior && prior.factsHash === factsHash && prior.llm && prior.llm.promptVersion === LLM.promptVersion
      && prior.llm.model === LLM.model && prior.llm.reasoningEffort === LLM.reasoningEffort
      && (prior.published.source === 'llm' || !useLlm)) {
    log('statements: facts unchanged, reusing the audited statements');
    return summary(prior, auditId);
  }

  const attempts = [];
  let published = null;
  if (!useLlm) {
    published = { source: 'template', reason: 'Run without the language model (--no-llm).', statements: templates };
  } else if (!process.env.OPENAI_API_KEY) {
    published = { source: 'template', reason: 'OPENAI_API_KEY is not set.', statements: templates };
    log('statements: OPENAI_API_KEY not set, publishing templates');
  } else {
    let feedback = null;
    for (let attempt = 1; attempt <= 2 && !published; attempt++) {
      try {
        const out = await callModel(facts, feedback);
        const problems = validateStatements(out.statements, facts);
        attempts.push({ attempt, at: new Date().toISOString(), responseId: out.responseId, modelReported: out.modelReported, reasoningReported: out.reasoningReported, usage: out.usage, output: out.statements, problems });
        if (problems.length === 0) published = { source: 'llm', statements: out.statements };
        else { feedback = { previous: out.statements, problems }; log(`statements: attempt ${attempt} failed ${problems.length} check(s)`); }
      } catch (err) {
        attempts.push({ attempt, at: new Date().toISOString(), error: err.message });
        log(`statements: attempt ${attempt} error: ${err.message}`);
      }
    }
    if (!published) published = { source: 'template', reason: 'The machine-written statements failed validation or the API call failed; see attempts.', statements: templates };
  }

  const record = { ...base, generatedAt: new Date().toISOString(), attempts, published };
  writeJson(auditFile, record, true);
  const index = readJson(path.join(auditDir, 'index.json'), []);
  const entry = { id: auditId, generatedAt: record.generatedAt, source: published.source, factsHash, file: `${auditId}.json` };
  writeJson(path.join(auditDir, 'index.json'), [entry, ...index.filter((e) => e.id !== auditId)].slice(0, 400), true);
  log(`statements: published from ${published.source}${published.reason ? ` (${published.reason})` : ''}`);
  return summary(record, auditId);
}

function summary(record, auditId) {
  return {
    statements: record.published.statements,
    source: record.published.source,
    reason: record.published.reason || null,
    model: record.published.source === 'llm' ? record.llm.model : null,
    reasoningEffort: record.published.source === 'llm' ? record.llm.reasoningEffort : null,
    promptVersion: record.llm.promptVersion,
    generatedAt: record.generatedAt,
    attempts: record.attempts.length,
    checksFailedBeforePublish: record.attempts.reduce((n, a) => n + (a.problems ? a.problems.length : 0), 0),
    factsHash: record.factsHash,
    auditFile: `audit/${auditId}.json`,
  };
}
