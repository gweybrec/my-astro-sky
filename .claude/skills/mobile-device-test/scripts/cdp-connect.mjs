// Connects to the app's WebView over its debugging socket: finds the socket, forwards it to a local port and returns a
// playwright-core page. The app must be running (a debug build) on the device.
// As a module: import { connect } from './cdp-connect.mjs'; const { page, close } = await connect({ serial });
// As a command: node cdp-connect.mjs --serial <serial> [--port 9223] [--package <app id>]
//   prints the page's URL and title, then removes the forward. The package id defaults to the appId of
//   apps/mobile/capacitor.config.ts.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { adb, appId, parseArgs, repoRoot } from './adb.mjs';

function loadChromium() {
  for (const f of [
    path.join(repoRoot, 'apps/mobile/package.json'),
    path.join(repoRoot, 'package.json'),
  ]) {
    try {
      return createRequire(f)('playwright-core').chromium;
    } catch {
      /* try the next place */
    }
  }
  console.error(
    'playwright-core is not installed: run `npm install` at the repository root (a devDependency of apps/mobile).',
  );
  process.exit(2);
}

/** The pid in the app's WebView socket name (webview_devtools_remote_<pid>). */
export function webviewPid(serial, packageId = appId()) {
  const appPids = adb(serial, ['shell', 'pidof', packageId]).split(/\s+/).filter(Boolean);
  if (appPids.length === 0) throw new Error(`${packageId} is not running: start it first.`);
  const sockets = adb(serial, ['shell', 'cat', '/proc/net/unix']);
  const pids = [...sockets.matchAll(/webview_devtools_remote_(\d+)/g)].map((m) => m[1]);
  const pid = pids.filter((p) => appPids.includes(p)).at(-1);
  if (!pid) throw new Error('No WebView debugging socket for the app: is it a debug build?');
  return pid;
}

export async function connect({ serial, port = 9223, packageId = appId() }) {
  const pid = webviewPid(serial, packageId);
  adb(serial, ['forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`]);
  const browser = await loadChromium().connectOverCDP(`http://localhost:${port}`);
  const pages = browser.contexts().flatMap((c) => c.pages());
  const page = pages.find((p) => p.url().startsWith('https://localhost')) ?? pages[0];
  if (!page) throw new Error('No WebView page found over the debugging connection.');
  const close = async () => {
    await browser.close();
    adb(serial, ['forward', '--remove', `tcp:${port}`]);
  };
  return { browser, page, close };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? fileURLToPath(import.meta.url)).href) {
  const { options } = parseArgs(process.argv.slice(2));
  if (!options.serial) {
    console.error('Usage: cdp-connect.mjs --serial <serial> [--port 9223] [--package <app id>]');
    process.exit(2);
  }
  const { page, close } = await connect({
    serial: options.serial,
    port: Number(options.port ?? 9223),
    packageId: options.package ?? appId(),
  });
  console.log('URL:', page.url());
  console.log('Title:', await page.title());
  await close();
}
