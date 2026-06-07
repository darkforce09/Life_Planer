/**
 * PII sanitization - a hard boundary that MUST run on any text before it is
 * sent to a cloud LLM (Gemini). Strips Swedish personal numbers, credentials,
 * API keys, emails and phone numbers, replacing them with stable placeholders.
 *
 * Required by docs/engineering_standards.md. This is intentionally aggressive:
 * over-redaction is acceptable; leaking PII to a third party is not.
 */

export interface SanitizeResult {
  text: string;
  redactions: number;
}

// Order matters: more specific patterns first.
const PATTERNS: Array<{ label: string; regex: RegExp }> = [
  // Swedish personnummer / samordningsnummer: YYYYMMDD-XXXX, YYMMDD-XXXX, YYYYMMDDXXXX (10 or 12 digits, optional + or -)
  { label: '[REDACTED_PERSONNUMMER]', regex: /\b(?:19|20)?\d{6}[-+]?\d{4}\b/g },
  // Explicit password / secret / token assignments (key: value or key=value)
  {
    label: '[REDACTED_SECRET]',
    regex: /\b(?:password|passwd|pwd|secret|token|api[_-]?key|authorization|bearer)\b\s*[:=]\s*\S+/gi,
  },
  // Long opaque keys (Google/OpenAI-style)
  { label: '[REDACTED_KEY]', regex: /\b(?:AIza[0-9A-Za-z_\-]{20,}|sk-[0-9A-Za-z]{20,})\b/g },
  // Email addresses
  { label: '[REDACTED_EMAIL]', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // Swedish phone numbers (e.g. +46 70 123 45 67, 070-123 45 67)
  { label: '[REDACTED_PHONE]', regex: /(?:\+46|0)[\s-]?7\d(?:[\s-]?\d){7,8}\b/g },
];

export function sanitizeForLLM(input: string): SanitizeResult {
  if (!input) return { text: input ?? '', redactions: 0 };

  let text = input;
  let redactions = 0;
  for (const { label, regex } of PATTERNS) {
    text = text.replace(regex, () => {
      redactions += 1;
      return label;
    });
  }
  return { text, redactions };
}

/** Convenience wrapper returning only the sanitized string. */
export function sanitize(input: string): string {
  return sanitizeForLLM(input).text;
}
