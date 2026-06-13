import { describe, it, expect, vi, beforeEach } from 'vitest';

// Reset the module between tests so each test gets a fresh logger state.
// vi.isolateModules is used to prevent the singleton from leaking across tests.

describe('server/logger', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('calls the installed logger function with the given category and error', async () => {
    const { installLogger, logServerError } = await import('../../server/logger');
    const stub = vi.fn();
    installLogger(stub);

    const err = new Error('db connection failed');
    logServerError('server_unhandled_error', err, { route: '/api/photos' });

    expect(stub).toHaveBeenCalledOnce();
    expect(stub).toHaveBeenCalledWith('server_unhandled_error', err, { route: '/api/photos' });
  });

  it('passes context as undefined when not provided', async () => {
    const { installLogger, logServerError } = await import('../../server/logger');
    const stub = vi.fn();
    installLogger(stub);

    const err = new Error('oops');
    logServerError('some_category', err);

    expect(stub).toHaveBeenCalledWith('some_category', err, undefined);
  });

  it('falls back to console.error when no logger has been installed', async () => {
    const { logServerError } = await import('../../server/logger');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logServerError('fallback_category', new Error('fallback'));

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('uses the most recently installed logger when installLogger is called multiple times', async () => {
    const { installLogger, logServerError } = await import('../../server/logger');
    const first = vi.fn();
    const second = vi.fn();
    installLogger(first);
    installLogger(second);

    logServerError('cat', new Error('x'));

    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });
});
