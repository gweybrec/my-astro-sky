// @vitest-environment node
/** The server's entry point: a failed start is reported, not left as an unhandled rejection. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

const createApp = vi.fn();
const logServerError = vi.fn();
let isElectron = false;

vi.mock('../../server/app.js', () => ({ createApp: () => createApp() }));
vi.mock('../../server/logger.js', () => ({
  logServerError: (...a: unknown[]) => logServerError(...a),
}));
vi.mock('../../server/routes/shared.js', () => ({
  get isElectron() {
    return isElectron;
  },
}));

describe('server/index.ts', () => {
  let exit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    createApp.mockReset();
    logServerError.mockReset();
    isElectron = false;
    vi.stubEnv('PORT', '');
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });
  afterEach(() => {
    exit.mockRestore();
    vi.unstubAllEnvs();
  });

  /** A fake server that either starts listening or fails with the given error. */
  function fakeListen(error?: NodeJS.ErrnoException) {
    return vi.fn(() => {
      const server = Object.assign(new EventEmitter(), { listening: false });
      setImmediate(() => (error ? server.emit('error', error) : server.emit('listening')));
      return server;
    });
  }

  it('listens once the app is made, on the development port by default', async () => {
    const listen = fakeListen();
    createApp.mockResolvedValue({ listen });
    const { serverStarted } = await import('../../server/index.js');
    await serverStarted;
    expect(listen).toHaveBeenCalledExactlyOnceWith(3002);
    expect(exit).not.toHaveBeenCalled();
  });

  it('logs and exits when its port is already taken, instead of carrying on', async () => {
    const listen = fakeListen(Object.assign(new Error('in use'), { code: 'EADDRINUSE' }));
    createApp.mockResolvedValue({ listen });
    const { serverStarted } = await import('../../server/index.js');
    await expect(serverStarted).rejects.toThrow('Port 3002 is already used by another program.');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });

  it('logs a failed start and exits with code 1', async () => {
    const failure = new Error('database is locked');
    createApp.mockRejectedValue(failure);
    const { serverStarted } = await import('../../server/index.js');
    await expect(serverStarted).rejects.toBe(failure);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(logServerError).toHaveBeenCalledWith('server_start_failed', failure);
  });

  it('in Electron, leaves the failure to the caller and does not exit', async () => {
    isElectron = true;
    const failure = new Error('database is locked');
    createApp.mockRejectedValue(failure);
    const { serverStarted } = await import('../../server/index.js');
    await expect(serverStarted).rejects.toBe(failure);
    expect(logServerError).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});
