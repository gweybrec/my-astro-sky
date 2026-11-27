import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureErrorReporter } from '@myastrosky/core/platform/error-hook';
import { DomainError } from '@myastrosky/core/domain/errors';
import { userFacingError } from '@myastrosky/core/platform/error-report';
import { showErrorToast, showToast } from '../../src/toast';
import { reportUnknownRendererError } from '../../src/error-reporter';

const reporter = vi.fn();

beforeEach(() => {
  document.body.innerHTML = '';
  reporter.mockReset();
  configureErrorReporter(reporter);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function lastToast(): HTMLElement {
  const toasts = document.querySelectorAll<HTMLElement>('#toast-container .toast');
  return toasts[toasts.length - 1];
}

describe('showErrorToast', () => {
  it('shows a bug with a generic text, its reference, and logs it once', () => {
    showErrorToast(
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      'errors.updatePhoto',
      {
        category: 'photo_update_failed',
      },
    );
    const toast = lastToast();
    expect(toast.textContent).not.toContain('Cannot read');
    const ref = toast.querySelector('[data-testid="toast-ref"]')!.textContent!;
    expect(ref).toMatch(/INTERNAL_ERROR · [0-9A-Z]{4}$/);
    expect(reporter).toHaveBeenCalledOnce();
    const [category, , , ticket] = reporter.mock.calls[0];
    expect(category).toBe('photo_update_failed');
    expect(ref).toContain(ticket.ref);
  });

  it('shows the translated code of a network failure, with the reference the server gave', () => {
    showErrorToast(
      new DomainError('upstream', 'Network error', { code: 'NETWORK_ERROR', ref: 'K7Q2' }),
      'errors.updatePhoto',
    );
    expect(lastToast().querySelector('[data-testid="toast-ref"]')!.textContent).toContain(
      'NETWORK_ERROR · K7Q2',
    );
  });

  it('shows a message about what the user entered as it is, with no reference and no log', () => {
    showErrorToast(userFacingError('Enter a whole number', { kind: 'invalid' }), 'x');
    const toast = lastToast();
    expect(toast.textContent).toBe('Enter a whole number');
    expect(toast.querySelector('[data-testid="toast-ref"]')).toBeNull();
    expect(reporter).not.toHaveBeenCalled();
  });

  it('copies the version, platform, code and reference', async () => {
    vi.stubGlobal('__APP_VERSION__', '9.9.9');
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    showErrorToast(new Error('x'), 'errors.updatePhoto');
    lastToast().querySelector('button')!.click();
    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/^MyAstroSky 9\.9\.9 \(Web\) · INTERNAL_ERROR · [0-9A-Z]{4} · \d{4}-/),
    );
  });

  it('stays while the pointer is on it', () => {
    showErrorToast(new Error('x'), 'errors.updatePhoto');
    const toast = lastToast();
    toast.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(20000);
    expect(toast.classList.contains('toast-fade-out')).toBe(false);
    toast.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(8000);
    expect(toast.classList.contains('toast-fade-out')).toBe(true);
  });
});

describe('showToast', () => {
  it('no longer logs a plain error toast (a caught error goes through showErrorToast)', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    showToast({ message: 'Enter a date', type: 'error' });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe('reportUnknownRendererError', () => {
  it('prints to the console when there is no log file (a browser)', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ticket = reportUnknownRendererError('cat', new Error('boom'));
    expect(log).toHaveBeenCalledWith(
      `[cat] INTERNAL_ERROR ${ticket.ref}`,
      'boom',
      expect.any(String),
    );
    log.mockRestore();
  });

  it('sends the code and reference to the desktop log file', () => {
    const logError = vi.fn(() => Promise.resolve({ ok: true }));
    vi.stubGlobal('myAstroDiagnostics', { logError });
    window.myAstroDiagnostics = { logError } as unknown as typeof window.myAstroDiagnostics;
    const ticket = reportUnknownRendererError('cat', new Error('boom'), { id: 1 });
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'cat',
        code: 'INTERNAL_ERROR',
        ref: ticket.ref,
        context: { id: 1 },
      }),
    );
    delete window.myAstroDiagnostics;
  });
});
