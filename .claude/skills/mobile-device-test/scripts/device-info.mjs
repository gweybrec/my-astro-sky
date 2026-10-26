// Reads, never changes: lists the devices adb sees, and for one of them the lock state, the screen state and the three
// settings the tests touch (stay_on_while_plugged_in, accelerometer_rotation, user_rotation).
// Usage: node device-info.mjs [--serial <serial>]
// Without --serial, the only listed device in state "device" is used; with none, or several, it says so and stops.
import { adb, listDevices, parseArgs } from './adb.mjs';

const { options } = parseArgs(process.argv.slice(2));
const devices = listDevices();
console.log(
  'Devices:',
  devices.length ? devices.map((d) => `${d.serial} (${d.state})`).join(', ') : 'none',
);

const ready = devices.filter((d) => d.state === 'device');
const serial = options.serial ?? (ready.length === 1 ? ready[0].serial : undefined);
if (!serial) {
  console.log(
    ready.length === 0
      ? 'No device ready. Ask the user to plug the phone in, unlock it and accept the USB debugging prompt.'
      : 'Several devices: pass --serial <serial>.',
  );
  process.exit(1);
}

const dump = adb(serial, ['shell', 'dumpsys', 'window']);
const locked =
  /isKeyguardShowing=true|mShowingLockscreen=true|keyguardShowing=true|mDreamingLockscreen=true/.test(
    dump,
  );
const power =
  adb(serial, ['shell', 'dumpsys', 'power']).match(/mWakefulness=(\w+)/)?.[1] ?? 'unknown';
console.log(`Serial: ${serial}`);
console.log(`Model: ${adb(serial, ['shell', 'getprop', 'ro.product.model'])}`);
console.log(`Android: ${adb(serial, ['shell', 'getprop', 'ro.build.version.release'])}`);
console.log(`Screen: ${power}; locked: ${locked}`);
if (locked || power !== 'Awake') {
  console.log('The phone is locked or asleep: ask the user to unlock it. Never try to unlock it.');
}
for (const [ns, key] of [
  ['global', 'stay_on_while_plugged_in'],
  ['system', 'accelerometer_rotation'],
  ['system', 'user_rotation'],
]) {
  console.log(`${key} = ${adb(serial, ['shell', 'settings', 'get', ns, key])}`);
}
