import type { DeviceHints } from '../density-slider';

let hints: () => DeviceHints = () => ({});

/** Called once at start-up by each platform: what it knows about the hardware. Default: nothing. */
export function configureDeviceHints(fn: () => DeviceHints): void {
  hints = fn;
}

export function deviceHints(): DeviceHints {
  return hints();
}
