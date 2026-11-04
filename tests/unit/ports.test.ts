import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import {
  DEFAULT_SERVER_PORT,
  DESKTOP_APP_PORT,
  listenOn,
  resolveServerPort,
} from '../../server/ports';

describe('resolveServerPort', () => {
  it('defaults to the development port, not the desktop app port', () => {
    expect(resolveServerPort({}, false)).toBe(DEFAULT_SERVER_PORT);
    expect(DEFAULT_SERVER_PORT).not.toBe(DESKTOP_APP_PORT);
  });

  it('refuses the desktop app port to a development server', () => {
    expect(() => resolveServerPort({ PORT: String(DESKTOP_APP_PORT) }, false)).toThrow(
      /reserved for the installed MyAstroSky app/,
    );
  });

  it('gives the desktop app port to the desktop app and to a production deployment', () => {
    expect(resolveServerPort({ PORT: String(DESKTOP_APP_PORT) }, true)).toBe(DESKTOP_APP_PORT);
    expect(
      resolveServerPort({ PORT: String(DESKTOP_APP_PORT), NODE_ENV: 'production' }, false),
    ).toBe(DESKTOP_APP_PORT);
  });

  it('takes another port as given and rejects a malformed one', () => {
    expect(resolveServerPort({ PORT: '4000' }, false)).toBe(4000);
    expect(() => resolveServerPort({ PORT: 'abc' }, false)).toThrow(/whole number/);
    expect(() => resolveServerPort({ PORT: '70000' }, false)).toThrow(/whole number/);
  });
});

describe('listenOn', () => {
  const servers: http.Server[] = [];
  const app = { listen: (port: number) => http.createServer().listen(port) };

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  });

  it('resolves once listening', async () => {
    const server = await listenOn(app, 0);
    servers.push(server);
    expect(server.listening).toBe(true);
  });

  it('rejects when another server already holds the port, instead of carrying on', async () => {
    const first = await listenOn(app, 0);
    servers.push(first);
    const { port } = first.address() as { port: number };
    await expect(listenOn(app, port)).rejects.toThrow(`Port ${port} is already used`);
  });
});
