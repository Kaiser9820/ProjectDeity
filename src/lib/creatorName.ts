export const MAX_NAME_LENGTH = 20;

export type NameValidation = { ok: true; value: string } | { ok: false; error: string };

/**
 * A creator name appears inside the terminal prompt (`name@solarsystem ~$`),
 * so it is limited to a conservative, shell-safe character set.
 */
const ALLOWED = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function validateCreatorName(input: string): NameValidation {
  if (input.length === 0 || input.trim().length === 0) return { ok: false, error: 'A creator needs a name.' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(input)) return { ok: false, error: 'Control characters are not allowed.' };
  if (/\s/.test(input)) return { ok: false, error: 'Whitespace is not allowed.' };
  if ([...input].length > MAX_NAME_LENGTH) return { ok: false, error: `Keep it within ${MAX_NAME_LENGTH} characters.` };
  if (!ALLOWED.test(input))
    return { ok: false, error: 'Use letters, digits, "_", "-" or "." and start with a letter or digit.' };
  return { ok: true, value: input };
}
