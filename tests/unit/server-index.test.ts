// @vitest-environment node
/** The server's entry point: a failed start is reported, not left as an unhandled rejection. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });
  afterEach(() => exit.mockRestore());

  it('listens once the app is made', async () => {
    const listen = vi.fn();
    createApp.mockResolvedValue({ listen });
    const { serverStarted } = await import('../../server/index.js');
    await serverStarted;
    expect(listen).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
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
