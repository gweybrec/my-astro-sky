function escapeRegExpSpecial(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a path-anonymizing function from a list of [rawPath, placeholder] pairs.
 * Most-specific paths should come first (e.g. userData before home).
 * After known paths are replaced, regex fallbacks handle any remaining
 * Windows (C:\Users\...) and Unix (/home/...) user-directory paths.
 */
export function buildPathAnonymizer(
  knownPaths: Array<[string, string]>,
  caseInsensitive = process.platform === 'win32',
): (input: string) => string {
  const flags = caseInsensitive ? 'gi' : 'g';
  const patterns: Array<[RegExp, string]> = knownPaths
    .filter(([p]) => Boolean(p))
    .flatMap(([p, r]) => {
      try {
        return [[new RegExp(escapeRegExpSpecial(p), flags), r] as [RegExp, string]];
      } catch {
        return [];
      }
    });

  return (input: string): string => {
    let out = input;
    for (const [re, placeholder] of patterns) {
      out = out.replace(re, placeholder);
    }
    // Fallback: any remaining Windows user-directory paths — consume the full path
    // (stop at whitespace, quotes, parens, or angle brackets, not at backslash)
    out = out.replace(/[A-Za-z]:\\Users\\[^\s"'<>()\r\n]*/gi, '<user-path>');
    // Fallback: any remaining Unix home-directory paths — consume the full path
    out = out.replace(/\/home\/[^\s"'<>()\r\n]*/g, '<user-path>');
    return out;
  };
}
