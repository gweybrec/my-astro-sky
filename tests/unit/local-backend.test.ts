// @vitest-environment node
/**
 * The local backend reports a failure the way the HTTP backend reports a server error: whatever a service or an
 * adapter throws (a file that cannot be read, a decoder error) arrives as an `upstream` `DomainError` with a code, so
 * a screen shows a translated message, never the English text of a plain `Error`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLocalBackend } from '@myastrosky/backend-local/local-backend';
import { DomainError } from '@myastrosky/core/domain/errors';
import type { Services } from '@myastrosky/core/services/create-services';
import { configureI18n } from '@myastrosky/core/i18n/index';
import { configureErrorReporter } from '@myastrosky/core/platform/error-hook';
import { setBackend } from '@myastrosky/app-state/backend';
import { getPlans } from '@myastrosky/app-state/api';

/** Services whose `plans` members are the given ones; every other member is empty. */
function servicesWith(plans: Record<string, unknown>): Services {
  return new Proxy({ plans } as Record<string, unknown>, {
    get: (target, key: string) => target[key] ?? {},
  }) as unknown as Services;
}

function backendWith(plans: Record<string, unknown>) {
  return createLocalBackend({
    services: servicesWith(plans),
    files: { url: (fileName) => `/uploads/${fileName}` },
    starCatalogUrl: '/data/stars-deep.json',
    openZip: () => Promise.reject(new Error('unused')),
    newZip: () => {
      throw new Error('unused');
    },
    saveFile: async () => undefined,
    now: () => new Date(),
  });
}

const plainFailure = () => Promise.reject(new Error('Could not read plans.json: status 500'));

beforeEach(() => {
  configureErrorReporter(() => undefined);
});

describe('failures of the local backend', () => {
  it('a plain error becomes an upstream DomainError with a code, keeping its message', async () => {
    const reporter = vi.fn();
    configureErrorReporter(reporter);
    const err = await backendWith({ list: plainFailure })
      .plans.list()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toMatchObject({
      kind: 'upstream',
      code: 'INTERNAL_ERROR',
      message: 'Could not read plans.json: status 500',
    });
    expect(reporter).toHaveBeenCalledOnce();
  });

  it('a DomainError and a cancel pass through as they are', async () => {
    const domain = new DomainError('notFound', 'Plan not found', { code: 'PLAN_NOT_FOUND' });
    const abort = Object.assign(new Error('Aborted'), { name: 'AbortError' });
    const backend = backendWith({
      remove: () => Promise.reject(domain),
      list: () => Promise.reject(abort),
    });
    await expect(backend.plans.remove(1)).rejects.toBe(domain);
    await expect(backend.plans.list()).rejects.toBe(abort);
  });

  it('a synchronous member stays synchronous', () => {
    expect(backendWith({}).files.url('a.jpg')).toBe('/uploads/a.jpg');
  });

  it('reaches the screen as the translated message, as over HTTP', async () => {
    configureI18n({
      storedLang: () => 'fr',
      storeLang: () => undefined,
      preferredLanguages: () => ['fr'],
      reload: () => undefined,
    });
    setBackend(backendWith({ list: plainFailure }));
    await expect(getPlans()).rejects.toThrow("L'application a rencontré une erreur.");
  });
});
