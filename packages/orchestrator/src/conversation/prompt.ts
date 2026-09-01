import type { RiskProfile } from '../types/index.js';
import type { ChatTurn } from './session.js';

/** A single chat message sent to the model. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * The grounding contract. This is what makes the layer "explainable + grounded":
 * the model may ONLY use the supplied profile, must refuse when it lacks the
 * answer, must surface conflicts honestly, and has NO authority to change the
 * risk judgement.
 */
const SYSTEM_PROMPT = [
  'You are the explanation layer of a token risk assessment system. You explain an',
  'ALREADY-COMPUTED risk profile to a user in plain language. You never judge risk yourself.',
  '',
  'STRICT GROUNDING RULES:',
  '1. Answer ONLY from the JSON risk profile provided in this conversation. It is the single',
  '   source of truth. Do NOT use any outside knowledge about this token, its project, price,',
  '   team, or reputation.',
  '2. If the profile does not contain the answer, say so plainly — e.g. "The risk profile does',
  '   not include that information." Never guess, estimate, or invent a value.',
  '3. Never give financial advice or a buy/sell/hold recommendation. You describe findings; you',
  '   do not tell the user what to do.',
  '4. The overall risk and every factor are ALREADY decided in the profile. Do not re-rank,',
  '   re-weight, recompute, or overturn them. Report them exactly as given, using the profile\'s',
  '   own severity words (none/low/medium/high/critical).',
  '5. CONFLICTS: when a signal has "conflict": true, surface it honestly. State that the sources',
  '   disagree, report what EACH source said (from "conflictDetail": source, value, severity),',
  '   and explain that the system deliberately took the more cautious, higher-severity reading.',
  '   Never present a contested signal as if the sources agreed.',
  '6. lp_locked: a locked or burned LP reduces the immediate-withdrawal ("rug") risk ONLY — it',
  '   is NOT a guarantee of safety. Always convey this qualification (also noted in the signal\'s',
  '   evidence).',
  '7. Attribute findings to their sources when relevant, using each signal\'s "sources" array',
  '   (e.g. "GoPlus and honeypot.is both report ..."). Multiple agreeing sources mean higher',
  '   CONFIDENCE, not a stronger verdict.',
  '8. Be concise, neutral, and clear.',
  '',
  'OUTPUT FORMAT: respond with ONLY a JSON object of the form',
  '  {"reply": "<your plain-language answer>", "citedKeys": ["<Signal.key>", "..."]}',
  'where "reply" is the natural-language text the user reads, and "citedKeys" lists the EXACT',
  'Signal.key strings from the profile that "reply" actually refers to. Never invent a key and',
  'never list a key you did not mention; use [] if you referenced no specific signal.',
].join('\n');

/** Instruction that drives the opening summary. */
const SUMMARY_INSTRUCTION = [
  'Give the OPENING SUMMARY of the loaded risk profile:',
  '- Open with the overall risk (the "overallRisk" field) in one sentence.',
  '- List the main contributing factors, grouped from highest severity to lowest. For each, name',
  '  the signal in plain words, its status/value, and which sources reported it.',
  '- Explicitly call out any conflicts (the "conflicts" list): name the key, what each source',
  '  said, and that the cautious (higher-severity) reading was used.',
  '- End by inviting the user to ask follow-up questions.',
  'Put this readable summary (short paragraphs or bullets) in the JSON "reply" field, and list the',
  'Signal.key strings you referenced in "citedKeys".',
].join('\n');

function serializeProfile(profile: RiskProfile): string {
  return JSON.stringify(profile, null, 2);
}

/**
 * Assemble the messages for one model call. The profile is injected as a system
 * message so it stays the fixed factual context; chat history is included only
 * for follow-up questions (the opening summary starts clean to avoid leaking a
 * previous token's context).
 */
export function buildMessages(
  kind: 'summary' | 'question',
  profile: RiskProfile,
  question: string,
  history: ChatTurn[],
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'system',
      content: `RISK PROFILE (the ONLY factual source for your answer):\n${serializeProfile(profile)}`,
    },
  ];

  if (kind === 'question') {
    for (const turn of history) messages.push({ role: turn.role, content: turn.content });
    messages.push({ role: 'user', content: question });
  } else {
    messages.push({ role: 'user', content: SUMMARY_INSTRUCTION });
  }

  return messages;
}

/** The model's grounded reply plus the machine-readable keys it cited. */
export interface GroundedReply {
  reply: string;
  citedKeys: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Parse the model's JSON `{reply, citedKeys}` output (tolerating code fences).
 * `citedKeys` is the SAME list the faithfulness evaluation scores, so the
 * explanation that is measured is exactly the one the user receives.
 */
export function parseGroundedReply(text: string): GroundedReply {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  const jsonText = start >= 0 && end > start ? body.slice(start, end + 1) : body;

  const parsed: unknown = JSON.parse(jsonText);
  if (!isRecord(parsed)) throw new Error('model did not return a JSON object');
  const reply = typeof parsed.reply === 'string' ? parsed.reply : '';
  const citedKeys = Array.isArray(parsed.citedKeys)
    ? parsed.citedKeys.filter((k): k is string => typeof k === 'string')
    : [];
  return { reply, citedKeys };
}
