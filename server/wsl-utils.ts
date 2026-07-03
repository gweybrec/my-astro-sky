export function isTruthySetting(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function shouldUseWSL(settingValue: string | undefined): boolean {
  return process.platform === 'win32' && isTruthySetting(settingValue);
}

export function toWSLPath(inputPath: string): string {
  const match = inputPath.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (!match) return inputPath;
  const drive = match[1].toLowerCase();
  const tail = match[2].replace(/\\/g, '/');
  return `/mnt/${drive}/${tail}`;
}

export function wslPath(pathValue: string, useWSL: boolean): string {
  return useWSL ? toWSLPath(pathValue) : pathValue;
}

export function wrapExecForWSL(
  bin: string,
  args: string[],
  useWSL: boolean,
): { cmd: string; args: string[] } {
  if (!useWSL) {
    return { cmd: bin, args };
  }
  return { cmd: 'wsl', args: [bin, ...args] };
}
