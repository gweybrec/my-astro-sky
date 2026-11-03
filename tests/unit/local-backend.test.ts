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
import { convertRawPhoto, getPlans } from '@myastrosky/app-state/api';

/** Services with the given members; every other member is empty. */
function servicesWith(members: Record<string, unknown>): Services {
  return new Proxy(members, {
    get: (target, key: string) => target[key] ?? {},
  }) as unknown as Services;
}

function backendWith(plans: Record<string, unknown>) {
  return backendOf({ plans });
}

function backendOf(members: Record<string, unknown>, maxPhotoBytes?: number) {
  return createLocalBackend({
    maxPhotoBytes,
    services: servicesWith(members),
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

describe('cancelling a transfer of the local backend', () => {
  /** A signal that turns cancelled while the file is being read, and the file that does it. */
  function cancelledWhileReading() {
    const cancel = { aborted: false, addEventListener: () => {}, removeEventListener: () => {} };
    const file = {
      name: 'a.jpg',
      size: 3,
      read: async () => {
        cancel.aborted = true;
        return new Uint8Array([1, 2, 3]);
      },
    };
    return { cancel, file };
  }

  it('an upload cancelled while its file is read stores nothing', async () => {
    const upload = vi.fn();
    const { cancel, file } = cancelledWhileReading();
    const err = await backendOf({ photos: { upload } })
      .photos.upload(file, { correspondences: '[]' }, { cancel })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'AbortError' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('a conversion cancelled while its file is read converts nothing', async () => {
    const convert = vi.fn();
    const { cancel, file } = cancelledWhileReading();
    const err = await backendOf({ solvedImport: { convert } })
      .solvedImport.convert(file, { cancel })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'AbortError' });
    expect(convert).not.toHaveBeenCalled();
  });
});

describe('the size limit of a photo on the local backend', () => {
  /** A photo file of `size` bytes whose reading is recorded; the bytes are never made. */
  function photoOfSize(size: number) {
    const read = vi.fn(async () => new Uint8Array(1));
    return { file: { name: 'stack.fits', size, read }, read };
  }

  it('refuses a larger photo with PHOTO_TOO_LARGE, before reading or converting it', async () => {
    const convert = vi.fn();
    const { file, read } = photoOfSize(101);
    const err = await backendOf({ solvedImport: { convert } }, 100)
      .solvedImport.convert(file)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'PHOTO_TOO_LARGE' });
    expect(read).not.toHaveBeenCalled();
    expect(convert).not.toHaveBeenCalled();
  });

  it('refuses a larger photo for every reading of a whole photo', async () => {
    const backend = backendOf(
      {
        photos: { upload: vi.fn() },
        solvedImport: { solveWcs: vi.fn() },
        novaSolve: { submit: vi.fn() },
      },
      100,
    );
    const { file, read } = photoOfSize(101);
    for (const call of [
      () => backend.photos.upload(file, { correspondences: '[]' }),
      () => backend.solvedImport.solveWcs(file),
      () => backend.novaSolve.submit(file),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'PHOTO_TOO_LARGE' });
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('reaches the import list as the translated message', async () => {
    configureI18n({
      storedLang: () => 'fr',
      storeLang: () => undefined,
      preferredLanguages: () => ['fr'],
      reload: () => undefined,
    });
    setBackend(backendOf({ solvedImport: { convert: vi.fn() } }, 100));
    await expect(convertRawPhoto(new File([new Uint8Array(101)], 'stack.fits'))).rejects.toThrow(
      'Cette photo est trop volumineuse pour cet appareil (200 Mo au plus).',
    );
  });

  it('converts a photo of the limit', async () => {
    const convert = vi.fn(async () => ({ png: new Uint8Array(1), width: 1, height: 1 }));
    const { file, read } = photoOfSize(100);
    await backendOf({ solvedImport: { convert } }, 100).solvedImport.convert(file);
    expect(read).toHaveBeenCalledOnce();
    expect(convert).toHaveBeenCalledOnce();
  });
});
