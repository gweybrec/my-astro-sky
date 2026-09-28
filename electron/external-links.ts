// Pure decision logic for links the renderer asks to open in a new window
// (`<a target="_blank">`, `window.open`), e.g. "Voir sur TNS" or the credits links.
//
// Without a handler Electron opens them in a bare in-app BrowserWindow. Web pages
// belong in the user's default browser instead; anything else (the app's own
// origin, file:, javascript:, malformed URLs) is simply refused.

/** True when `url` should be handed to the OS default browser. */
export function shouldOpenExternally(url: string, appOrigin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  return parsed.origin !== appOrigin;
}
