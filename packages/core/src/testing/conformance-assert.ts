/** Small assertions for the conformance suites: they throw on failure, so no test framework is needed. */

export function show(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function fail(message: string): never {
  throw new Error(message);
}

export function toBe(actual: unknown, expected: unknown, what: string): void {
  if (!Object.is(actual, expected)) {
    fail(`${what}: expected ${show(expected)}, got ${show(actual)}`);
  }
}

export function ok(condition: unknown, what: string): asserts condition {
  if (!condition) fail(what);
}

export function bytesEqual(a: Uint8Array | null, b: Uint8Array, what: string): void {
  if (a === null) fail(`${what}: expected ${b.length} bytes, got null`);
  if (a.length !== b.length) fail(`${what}: expected ${b.length} bytes, got ${a.length}`);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) fail(`${what}: byte ${i} differs (expected ${b[i]}, got ${a[i]})`);
  }
}

export async function rejects(fn: () => Promise<unknown>, what: string): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
  return fail(`${what}: expected a rejection`);
}

/** Deterministic pseudo-random bytes (so a wrong byte order or a lost piece shows). */
export function patternBytes(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}
