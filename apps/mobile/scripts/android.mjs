// The Android debug app, in two separate steps:
//   `npm run mobile:android:build`   builds the web app, syncs it into the Android project and makes the debug APK;
//   `npm run mobile:android:install` installs the APK already built on the phone plugged in by USB and starts it,
//                                    without compiling anything (`-- --serial <serial>` or ANDROID_SERIAL when more
//                                    than one phone is plugged in).
// Installing keeps the app's data. Real phones only: this never starts an emulator, and Gradle never downloads SDK
// packages (android.builder.sdkDownload=false).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const android = path.join(repo, 'apps/mobile/android');
const apk = path.join(android, 'app/build/outputs/apk/debug/app-debug.apk');
const win = process.platform === 'win32';

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

// npm and gradlew.bat are scripts: on Windows they need a shell; adb is run directly (its path may hold spaces).
function run(command, args, { cwd = repo, shell = false } = {}) {
  console.log(`\n> ${[command, ...args].join(' ')}`);
  execFileSync(command, args, { cwd, stdio: 'inherit', shell: shell && win });
}

/** adb from $ADB, else $ANDROID_HOME/platform-tools, else the default SDK folder, else the PATH. */
function adbPath() {
  const exe = win ? 'adb.exe' : 'adb';
  const candidates = [
    process.env.ADB,
    process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', exe),
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', exe),
  ];
  return candidates.find((c) => c && existsSync(c)) ?? 'adb';
}

/** The phone to install on: the one named, else the only one plugged in and allowed. */
function phone(adb) {
  const argSerial = process.argv.indexOf('--serial');
  const wanted = argSerial > 0 ? process.argv[argSerial + 1] : process.env.ANDROID_SERIAL;
  const devices = execFileSync(adb, ['devices'])
    .toString()
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 2)
    .map(([serial, state]) => ({ serial, state }));
  const ready = devices.filter((d) => d.state === 'device');
  if (wanted) {
    if (!ready.some((d) => d.serial === wanted)) fail(`Phone ${wanted} is not ready.`);
    return wanted;
  }
  if (ready.length === 0)
    fail(
      devices.some((d) => d.state === 'unauthorized')
        ? 'The phone is plugged in but USB debugging is not allowed yet: accept the prompt on the phone.'
        : 'No phone found: plug it in by USB, unlock it and allow USB debugging.',
    );
  if (ready.length > 1)
    fail(
      `More than one phone: ${ready.map((d) => d.serial).join(', ')}. Add -- --serial <serial>.`,
    );
  return ready[0].serial;
}

function build() {
  run('npm', ['run', 'mobile:android:sync'], { shell: true });
  // By its full path: the Windows shell may not look in the current folder.
  const gradlew = path.join(android, win ? 'gradlew.bat' : 'gradlew');
  run(win ? `"${gradlew}"` : gradlew, ['assembleDebug'], { cwd: android, shell: win });
  console.log(`\nBuilt ${path.relative(repo, apk)}.`);
}

function install() {
  if (!existsSync(apk)) fail('No debug APK yet: run npm run mobile:android:build first.');
  const adb = adbPath();
  const serial = phone(adb);
  run(adb, ['-s', serial, 'install', '-r', apk]);
  const appId = readFileSync(path.join(repo, 'apps/mobile/capacitor.config.ts'), 'utf8').match(
    /appId:\s*['"]([^'"]+)['"]/,
  )?.[1];
  if (appId) run(adb, ['-s', serial, 'shell', 'am', 'start', '-n', `${appId}/.MainActivity`]);
  console.log(`\nInstalled on ${serial}.`);
}

const step = process.argv[2];
if (step === 'build') build();
else if (step === 'install') install();
else fail('Usage: node apps/mobile/scripts/android.mjs build | install [--serial <serial>]');
