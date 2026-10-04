import { SQL_LEGACY_CALL_IN_TX } from '@myastrosky/core/ports/sql-db';

/**
 * While a `SqlDb.transaction` is open on the shared connection, old synchronous `server/db.ts`
 * code must not run: its statements would silently join the open transaction.
 */
let serviceTxOpen = false;

export function setServiceTxOpen(open: boolean): void {
  serviceTxOpen = open;
}

export function assertLegacyAllowed(): void {
  if (serviceTxOpen) {
    const err = new Error(
      'Legacy database code was called while a SqlDb transaction is open. ' +
        'A transaction body may only await tx calls.',
    ) as Error & { code: string };
    err.code = SQL_LEGACY_CALL_IN_TX;
    throw err;
  }
}

type AnyFn = (...args: any[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Wraps a native better-sqlite3 object (connection or statement) so the members named in
 * `guarded` call `assertLegacyAllowed()` first. Every other function member is bound to the real
 * object (native methods throw "Illegal invocation" on a Proxy `this`), non-function members are
 * read from the real object, and a method that returns the object itself (`bind()`,
 * `safeIntegers()`, ...) returns the wrapper instead.
 */
function guardNative<T extends object>(
  target: T,
  guarded: ReadonlySet<string>,
  wrapResult?: (name: string, result: unknown) => unknown,
): T {
  const bound = new Map<string | symbol, AnyFn>();
  const proxy: T = new Proxy(target, {
    get(t, prop) {
      const value = Reflect.get(t, prop, t);
      if (typeof value !== 'function') return value;
      let fn = bound.get(prop);
      if (!fn) {
        const name = typeof prop === 'string' ? prop : '';
        const isGuarded = guarded.has(name);
        fn = (...args: unknown[]) => {
          if (isGuarded) assertLegacyAllowed();
          const result = (value as AnyFn).apply(t, args);
          if (result === t) return proxy;
          return wrapResult ? wrapResult(name, result) : result;
        };
        bound.set(prop, fn);
      }
      return fn;
    },
  });
  return proxy;
}

const GUARDED_STATEMENT = new Set(['run', 'get', 'all', 'iterate']);
const GUARDED_CONNECTION = new Set(['exec', 'pragma']);

/** Guards one transaction function: asserts, then runs it with the caller's `this`. */
function guardOne(fn: AnyFn): AnyFn {
  return function (this: unknown, ...args: unknown[]) {
    assertLegacyAllowed();
    return fn.apply(this, args);
  };
}

/** Guards a transaction function and its `deferred`/`immediate`/`exclusive` variants. */
function guardTransactionFn(fn: AnyFn): AnyFn {
  const wrapped = guardOne(fn) as unknown as Record<string, unknown>;
  wrapped.default = wrapped;
  for (const variant of ['deferred', 'immediate', 'exclusive']) {
    const v = (fn as unknown as Record<string, unknown>)[variant];
    if (typeof v === 'function') wrapped[variant] = guardOne(v as AnyFn);
  }
  return wrapped as unknown as AnyFn;
}

/**
 * The connection that old synchronous `server/db.ts` code uses: identical to the raw handle,
 * except that running a statement, `exec`, `pragma` or a transaction throws
 * `SQL_LEGACY_CALL_IN_TX` while a `SqlDb` service transaction is open.
 */
export function wrapLegacyConnection<C extends object>(conn: C): C {
  return guardNative(conn, GUARDED_CONNECTION, (name, result) => {
    if (name === 'prepare' && result && typeof result === 'object') {
      return guardNative(result, GUARDED_STATEMENT);
    }
    if (name === 'transaction' && typeof result === 'function') {
      return guardTransactionFn(result as AnyFn);
    }
    return result;
  });
}
