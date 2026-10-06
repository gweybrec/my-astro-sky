/** Reads an environment variable. The server passes `process.env`; the phone passes a function that returns `undefined`. */
export type EnvSource = (key: string) => string | undefined;
