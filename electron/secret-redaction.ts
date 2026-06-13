const ASTROMETRY_KEY_JSON_RE = /("apikey"\s*:\s*")([^"\\]*(?:\\.[^"\\]*)*)(")/gi;
const ASTROMETRY_KEY_JSON_URLENC_RE = /(%22apikey%22%3A%22)(.*?)(%22)/gi;
const API_KEY_FORM_RE = /(apikey=)([^&\s]+)/gi;
const ASTROMETRY_ENV_ASSIGN_RE = /(ASTROMETRY_API_KEY\s*[=:]\s*)([^\s,;]+)/gi;

function redactPattern(input: string, re: RegExp, valueGroup: number): string {
  return input.replace(re, (...args: string[]) => {
    const match = args[0];
    const groups = args.slice(1, -2);
    if (groups.length < valueGroup) return match;
    groups[valueGroup - 1] = '[redacted]';
    let rebuilt = '';
    let cursor = 0;
    const full = match;
    for (let i = 0; i < groups.length; i += 1) {
      const g = args[i + 1];
      const idx = full.indexOf(g, cursor);
      if (idx === -1) return match;
      rebuilt += full.slice(cursor, idx);
      rebuilt += groups[i];
      cursor = idx + g.length;
    }
    rebuilt += full.slice(cursor);
    return rebuilt;
  });
}

export function redactSecrets(input: string): string {
  let out = input;

  const configuredKey = process.env.ASTROMETRY_API_KEY?.trim();
  if (configuredKey) {
    out = out.split(configuredKey).join('[redacted]');
  }

  out = redactPattern(out, ASTROMETRY_KEY_JSON_RE, 2);
  out = redactPattern(out, ASTROMETRY_KEY_JSON_URLENC_RE, 2);
  out = redactPattern(out, API_KEY_FORM_RE, 2);
  out = redactPattern(out, ASTROMETRY_ENV_ASSIGN_RE, 2);

  return out;
}
