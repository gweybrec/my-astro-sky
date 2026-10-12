// Records, sets and restores the three phone settings the tests change. The record is a JSON file you name, so a
// restore still works after a crash.
//   node settings-guard.mjs record  --serial <s> --file <record.json>   save the three settings
//   node settings-guard.mjs stayon  --serial <s>                        keep the screen on while plugged in
//   node settings-guard.mjs rotate  --serial <s> --rotation <0-3>       auto-rotate off, set user_rotation (1 and 3 are the two landscapes)
//   node settings-guard.mjs restore --serial <s> --file <record.json>   put the three back and read them back; exit 1 if one differs
// The three: stay_on_while_plugged_in, accelerometer_rotation, user_rotation.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { adb, parseArgs } from './adb.mjs';

const SETTINGS = [
  ['global', 'stay_on_while_plugged_in'],
  ['system', 'accelerometer_rotation'],
  ['system', 'user_rotation'],
];
const { positional, options } = parseArgs(process.argv.slice(2));
const [command] = positional;
const serial = options.serial;
const get = (ns, key) => adb(serial, ['shell', 'settings', 'get', ns, key]);
const put = (ns, key, value) => adb(serial, ['shell', 'settings', 'put', ns, key, String(value)]);

if (command === 'record' && options.file) {
  const record = Object.fromEntries(SETTINGS.map(([ns, key]) => [key, get(ns, key)]));
  mkdirSync(path.dirname(path.resolve(options.file)), { recursive: true });
  writeFileSync(options.file, JSON.stringify(record, null, 2));
  console.log('Recorded', record);
} else if (command === 'stayon') {
  adb(serial, ['shell', 'svc', 'power', 'stayon', 'usb']);
  console.log('stay_on_while_plugged_in =', get('global', 'stay_on_while_plugged_in'));
} else if (command === 'rotate' && options.rotation !== undefined) {
  put('system', 'accelerometer_rotation', 0);
  put('system', 'user_rotation', options.rotation);
  console.log('user_rotation =', get('system', 'user_rotation'));
} else if (command === 'restore' && options.file) {
  const record = JSON.parse(readFileSync(options.file, 'utf8'));
  let ok = true;
  for (const [ns, key] of SETTINGS) {
    // "null" means the setting did not exist: deleting it puts it back as it was.
    if (record[key] === 'null') adb(serial, ['shell', 'settings', 'delete', ns, key]);
    else put(ns, key, record[key]);
    const now = get(ns, key);
    const same = now === record[key];
    ok &&= same;
    console.log(`${key}: recorded ${record[key]}, now ${now}${same ? '' : '  <-- DIFFERENT'}`);
  }
  process.exit(ok ? 0 : 1);
} else {
  console.error(
    'Usage: settings-guard.mjs record|stayon|rotate|restore --serial <serial> [--file <record.json>] [--rotation 0-3]',
  );
  process.exit(2);
}
