export const MAX_INPUT_LENGTH = 256;

export interface ParsedCommand {
  name: string;
  args: string[];
  raw: string;
}

export class ParseError extends Error {}

/** Removes control characters and caps length. Input is only ever treated as data. */
export function sanitizeInput(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, MAX_INPUT_LENGTH);
}

/**
 * Splits on whitespace, honouring "double" and 'single' quotes (no escapes, no expansion).
 * With `partial`, an unterminated quote is accepted and a trailing space yields an empty last
 * token. Autocomplete uses that to know which argument is being typed.
 */
export function tokenize(input: string, partial = false): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (quote && !partial) throw new ParseError(`Unclosed ${quote} quote.`);
  if (has) out.push(cur);
  if (partial && /\s$/.test(input) && !quote) out.push('');
  return out;
}

export function parseCommand(raw: string): ParsedCommand | null {
  const clean = sanitizeInput(raw).trim();
  if (!clean) return null;
  const [name, ...args] = tokenize(clean);
  if (name === undefined) return null;
  return { name: name.toLowerCase(), args, raw: clean };
}
