import { app, BrowserWindow, safeStorage, Menu, crashReporter, dialog, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import net from 'net';
import fs from 'fs';
import crypto from 'crypto';
import { setupErrorLogging, logMainError, logCrash } from './error-logger.js';
import { shouldReloadAfterCrash } from './crash-reload-guard.js';
import { shouldOpenExternally } from './external-links.js';
import { installLogger } from '../server/logger.js';
import { msg, type ServerLang } from '../server/messages.js';
import { ipcMain } from 'electron';
import { configureLogSink, consoleLogSink, logInfo } from '@myastrosky/core/platform/log';
import { isDatabaseUpdateError } from '@myastrosky/core/db/schema';
import { backupFileName } from '@myastrosky/core/domain/backup';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_KEY_FILE = 'settings-encryption-key.bin';

function isValidKeyBase64(value: string): boolean {
  try {
    return Buffer.from(value, 'base64').length === 32;
  } catch {
    return false;
  }
}

function initSettingsEncryptionKey(): void {
  const existing = process.env.SETTINGS_ENCRYPTION_KEY?.trim();
  if (existing && isValidKeyBase64(existing)) return;

  if (!safeStorage.isEncryptionAvailable()) {
    console.warn(
      '[Security] safeStorage is unavailable; SETTINGS_ENCRYPTION_KEY was not provisioned.',
    );
    return;
  }

  const keyPath = path.join(app.getPath('userData'), SETTINGS_KEY_FILE);

  if (fs.existsSync(keyPath)) {
    try {
      const encryptedB64 = fs.readFileSync(keyPath, 'utf8').trim();
      if (encryptedB64.length > 0) {
        const decrypted = safeStorage.decryptString(Buffer.from(encryptedB64, 'base64')).trim();
        if (isValidKeyBase64(decrypted)) {
          process.env.SETTINGS_ENCRYPTION_KEY = decrypted;
          return;
        }
      }
    } catch {
      // Key file exists but can't be decrypted (wrong app identity, corrupted, or
      // leftover from a dev/test run). Delete it so we generate a fresh key below.
      console.warn('[Security] Existing key could not be decrypted; generating a new one.');
      try {
        fs.unlinkSync(keyPath);
      } catch {
        /* best effort */
      }
    }
  }

  try {
    const keyB64 = crypto.randomBytes(32).toString('base64');
    const encrypted = safeStorage.encryptString(keyB64);
    fs.writeFileSync(keyPath, encrypted.toString('base64'), { mode: 0o600 });
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(keyPath, 0o600);
      } catch {
        // Best effort only.
      }
    }
    process.env.SETTINGS_ENCRYPTION_KEY = keyB64;
  } catch (error) {
    console.warn('[Security] Failed to initialize settings encryption key:', error);
  }
}

/** Find the first TCP port >= start that is not in use. */
function findFreePort(start: number): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(start, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', () => resolve(findFreePort(start + 1)));
  });
}

/** Poll until something accepts connections on the given port. */
function waitForPort(port: number, maxAttempts = 30): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const attempt = () => {
      const socket = new net.Socket();
      socket.setTimeout(300);
      socket.connect(port, '127.0.0.1', () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (++attempts < maxAttempts) setTimeout(attempt, 300);
        else
          reject(new Error(`Express did not start on port ${port} after ${maxAttempts} attempts`));
      });
      socket.on('timeout', () => {
        socket.destroy();
        if (++attempts < maxAttempts) setTimeout(attempt, 300);
        else reject(new Error(`Express timed out on port ${port}`));
      });
    };
    attempt();
  });
}

// Tracks recent renderer-crash timestamps so auto-reload can give up on a crash loop.
let rendererCrashTimes: number[] = [];

/**
 * Log a renderer crash and auto-reload the window to recover. If the renderer keeps
 * crashing (a crash loop), stop reloading and offer the user a Reload/Quit dialog.
 */
function handleRendererGone(win: BrowserWindow, details: Electron.RenderProcessGoneDetails): void {
  logCrash('renderer_process_gone', new Error(`Renderer gone: ${details.reason}`), {
    reason: details.reason,
    exitCode: details.exitCode,
  });

  // A clean exit is not a crash (e.g. window closing normally).
  if (details.reason === 'clean-exit') return;
  if (win.isDestroyed()) return;

  const { reload, recentCrashes } = shouldReloadAfterCrash(rendererCrashTimes, Date.now());
  rendererCrashTimes = recentCrashes;

  if (reload) {
    win.webContents.reload();
    return;
  }

  // Crash loop: stop auto-reloading and let the user decide.
  const choice = dialog.showMessageBoxSync(win, {
    type: 'error',
    buttons: ['Reload', 'Quit'],
    defaultId: 0,
    cancelId: 1,
    title: 'MyAstroSky',
    message: 'MyAstroSky keeps crashing.',
    detail: 'The app window crashed repeatedly. You can try reloading once more, or quit.',
  });
  if (choice === 0) {
    rendererCrashTimes = [];
    win.webContents.reload();
  } else {
    app.quit();
  }
}

/**
 * A database update failed, so the server cannot start; the update was undone and the data is intact. Say so and
 * offer the full backup, read from the database without the updates, until the user saves one or quits.
 */
async function offerBackupAfterFailedUpdate(err: Error): Promise<void> {
  const lang: ServerLang = app.getLocale().startsWith('fr') ? 'fr' : 'en';
  const text = msg.databaseUpdate;
  for (;;) {
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      buttons: [text.saveBackup(lang), text.quit(lang)],
      defaultId: 0,
      cancelId: 1,
      title: 'MyAstroSky',
      message: text.message(lang),
      detail: text.detail(lang, err.message),
    });
    if (choice !== 0) return;
    const file = dialog.showSaveDialogSync({
      defaultPath: path.join(app.getPath('documents'), backupFileName(new Date())),
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    });
    if (!file) continue;
    try {
      const { saveBackupWithoutUpdates } = await import('../server/backup-without-updates.js');
      await saveBackupWithoutUpdates(file);
      dialog.showMessageBoxSync({
        type: 'info',
        title: 'MyAstroSky',
        message: text.saved(lang, file),
      });
      return;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      logMainError('backup_without_updates_failed', failure);
      dialog.showErrorBox('MyAstroSky', text.saveFailed(lang, failure.message));
    }
  }
}

async function main() {
  // Start the native crash reporter as early as possible so Crashpad captures crashes in
  // all processes. Local only — minidumps are written to app.getPath('crashDumps') and
  // never uploaded (matches the app's privacy-first, offline design).
  crashReporter.start({
    productName: 'MyAstroSky',
    companyName: 'MyAstroSky',
    submitURL: '',
    uploadToServer: false,
    compress: true,
  });

  await app.whenReady();

  // Debug and info messages print in development runs only, not in the packaged app.
  configureLogSink(app.isPackaged ? null : consoleLogSink);
  logInfo('MyAstroSky', `app version=${__APP_VERSION__} build=${__APP_BUILD_TIMESTAMP__}`);

  setupErrorLogging();
  installLogger(logMainError);
  initSettingsEncryptionKey();

  const port = await findFreePort(3001);
  process.env.PORT = String(port);

  if (app.isPackaged) {
    process.env.NODE_ENV = 'production';

    // User-writable data: DB and uploaded photos live in the OS user-data directory,
    // not inside the asar archive (which is read-only).
    const userData = app.getPath('userData');
    const uploadsDir = path.join(userData, 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    process.env.UPLOADS_DIR = uploadsDir;
    process.env.DB_PATH = path.join(userData, 'data.db');

    // Read-only app assets bundled in the asar.
    // Vite copies public/data/* into dist/data/ at build time, so all catalog
    // files are available under dist/ — no separate public/data/ copy needed.
    const appPath = app.getAppPath();
    const distDataDir = path.join(appPath, 'dist', 'data');
    process.env.DIST_DIR = path.join(appPath, 'dist');
    process.env.PUBLIC_DATA_DIR = distDataDir;
    process.env.STAR_CATALOG_PATH = path.join(distDataDir, 'stars.14.json');
    process.env.RESOURCES_DIR = path.join(appPath, 'resources');
  }

  // Dynamic import AFTER env vars are set — static ESM imports are hoisted and
  // would execute before this function body runs.
  await import('../server/index.js');

  // Wait for Express to actually accept connections before opening the window.
  await waitForPort(port);

  // Remove the navigation menu.
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'MyAstroSky',
    icon: path.join(__dirname, '../../public/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Native renderer crashes (white screen) can't be caught by JS in the renderer — handle
  // them here: log to the crash stream and auto-reload to recover.
  win.webContents.on('render-process-gone', (_event, details) => {
    handleRendererGone(win, details);
  });
  win.webContents.on('unresponsive', () => {
    logCrash('window_unresponsive', new Error('Renderer window became unresponsive'));
  });

  // target="_blank" links (e.g. "Voir sur TNS", credits) open in the user's default
  // browser, never in a bare in-app window.
  const appOrigin = `http://localhost:${port}`;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternally(url, appOrigin)) {
      shell.openExternal(url).catch((err) => logMainError('open_external_failed', err));
    }
    return { action: 'deny' };
  });

  win.loadURL(appOrigin);
  win.maximize();

  // Dev tools if needed for debugging. Never enable in production builds.
  // win.webContents.openDevTools();
}

ipcMain.handle('get-location', async () => {
  const res = await fetch('http://ip-api.com/json/');
  const data = await res.json();
  if (data.status !== 'success') throw new Error('Location failed');
  return { latitude: data.lat, longitude: data.lon };
});

app.on('window-all-closed', () => app.quit());

main().catch(async (error: unknown) => {
  console.error(error);
  const err = error instanceof Error ? error : new Error(String(error));
  try {
    logMainError('main_startup_failure', err);
  } catch {
    // Intentionally ignore to avoid recursive crashes.
  }
  try {
    // A failed launch otherwise shows no window and logs only to a console nobody
    // sees — this is the one visible signal the user gets that something went wrong.
    if (isDatabaseUpdateError(err)) await offerBackupAfterFailedUpdate(err);
    else dialog.showErrorBox('MyAstroSky failed to start', err.message);
  } catch {
    // Best effort — if the dialog itself can't be shown (e.g. no display), there's
    // nothing more we can surface; fall through to exit below.
  }
  app.exit(1);
});
