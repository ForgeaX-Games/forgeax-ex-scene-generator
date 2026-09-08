/**
 * 文本解析 (Text Parse)
 * Parses text into a single number or a (possibly nested) numeric list.
 * Preserves original structure: "[1,2,3]" → flat list, "[[1,2],[3,4]]" → nested list.
 * Supports JSON, delimited values (comma, semicolon, space, newline, tab).
 * Auto-detects delimiter when not specified.
 * Self-contained — no external imports.
 */

export interface TextParseInput {
  text?: string;
  delimiter?: string;
}

export interface TextParseOutput {
  value: number;
  list: unknown[];
}

/**
 * Recursively converts a JSON value into a numeric structure.
 * Numbers pass through; arrays are recursed; anything else → NaN.
 */
function toNumeric(v: unknown): unknown {
  if (typeof v === 'number') return isNaN(v) ? null : v;
  if (typeof v === 'string') {
    const n = Number(v);
    return isNaN(n) ? null : n;
  }
  if (Array.isArray(v)) {
    const result: unknown[] = [];
    for (const item of v) {
      const converted = toNumeric(item);
      if (converted === null) return null;
      result.push(converted);
    }
    return result;
  }
  return null;
}

/** Extract the first number from a (possibly nested) structure. */
function firstNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) {
    for (const item of v) {
      const n = firstNumber(item);
      if (!isNaN(n)) return n;
    }
  }
  return NaN;
}

function detectDelimiter(text: string): string {
  const candidates: [string, number][] = [
    [',', 0],
    [';', 0],
    ['\t', 0],
    ['\n', 0],
    [' ', 0],
  ];
  for (const c of candidates) {
    for (let i = 0; i < text.length; i++) {
      if (text[i] === c[0]) c[1]++;
    }
  }
  let best = ' ';
  let bestCount = 0;
  for (const [ch, count] of candidates) {
    if (count > bestCount) {
      bestCount = count;
      best = ch;
    }
  }
  return best;
}

export function parseText(input: TextParseInput): TextParseOutput {
  const text = (input.text ?? '').trim();

  if (text === '') {
    return { value: 0, list: [] };
  }

  // ── 1. Try JSON parse — preserves any nesting structure ──
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'number' && !isNaN(parsed)) {
      return { value: parsed, list: [] };
    }
    if (Array.isArray(parsed)) {
      const converted = toNumeric(parsed);
      if (converted !== null && Array.isArray(converted)) {
        const first = firstNumber(converted);
        return {
          value: !isNaN(first) ? first : 0,
          list: converted,
        };
      }
    }
  } catch {
    // Not valid JSON — continue
  }

  // ── 2. Try as a single number ──
  const singleNum = Number(text);
  if (!isNaN(singleNum)) {
    return { value: singleNum, list: [] };
  }

  // ── 3. Split by delimiter ──
  const rawDelim = (input.delimiter ?? 'auto').trim();
  const DELIM_MAP: Record<string, string> = { tab: '\t', newline: '\n', space: ' ' };
  const delim = rawDelim === '' || rawDelim === 'auto'
    ? detectDelimiter(text)
    : DELIM_MAP[rawDelim] ?? rawDelim;
  const normalized = text.replace(/\r\n?/g, '\n');

  let tokens: string[];
  if (delim === '\n') {
    tokens = normalized.split('\n');
  } else {
    tokens = normalized.split(/\n/).flatMap((line) => line.split(delim));
  }

  const nums: number[] = [];
  for (const tok of tokens) {
    const trimmed = tok.trim();
    if (trimmed === '') continue;
    const n = Number(trimmed);
    if (!isNaN(n)) nums.push(n);
  }

  if (nums.length === 1) {
    return { value: nums[0], list: [] };
  }

  return {
    value: nums.length > 0 ? nums[0] : 0,
    list: nums,
  };
}
