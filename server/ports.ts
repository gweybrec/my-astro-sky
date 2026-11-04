import type { Server } from 'node:http';

/**
 * The installed desktop app's port, reserved for it alone. Its browser storage (language, theme,
 * shortcuts) belongs to `http://localhost:3001`, so it never moves; nothing else may listen there,
 * or the app's window would show that other server's data.
 */
export const DESKTOP_APP_PORT = 3001;

/** Default port of a development or Node.js server (`npm run dev`, `npx tsx server/index.ts`). */
export const DEFAULT_SERVER_PORT = 3002;

/** Response header carrying the desktop app's start-up token, so it can tell its own server apart. */
export const INSTANCE_HEADER = 'X-MyAstroSky-Instance';

/**
 * The port this server listens on. Throws for the desktop app's port unless this is the desktop
 * app itself or a production deployment (Docker uses 3001 inside its own container).
 */
export function resolveServerPort(
  env: { PORT?: string; NODE_ENV?: string },
  isElectron: boolean,
): number {
  const port = env.PORT ? Number(env.PORT) : DEFAULT_SERVER_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be a whole number from 0 to 65535, not "${env.PORT}".`);
  }
  if (port === DESKTOP_APP_PORT && !isElectron && env.NODE_ENV !== 'production') {
    throw new Error(
      `Port ${DESKTOP_APP_PORT} is reserved for the installed MyAstroSky app. ` +
        `Use another PORT (default ${DEFAULT_SERVER_PORT}).`,
    );
  }
  return port;
}

/** Starts listening; rejects when the port cannot be had (in use, no permission) instead of carrying on. */
export function listenOn(app: { listen: (port: number) => Server }, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port);
    const fail = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already used by another program.`, { cause: err }));
      } else reject(err);
    };
    server.once('error', fail);
    server.once('listening', () => {
      server.off('error', fail);
      resolve(server);
    });
  });
}
