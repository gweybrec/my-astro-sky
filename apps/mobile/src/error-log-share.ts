import { phoneErrorLog } from './platform-init';
import { saveFile } from './platform-device';

/**
 * Hands the phone's error log to the share sheet (save, email, messaging…), as one JSON-lines file named with the
 * day. Returns false when there is nothing to share: no error logged, or no log at all (a browser).
 */
export async function shareErrorLog(now: Date = new Date()): Promise<boolean> {
  const text = (await phoneErrorLog()?.read()) ?? '';
  if (!text.trim()) return false;
  const day = now.toISOString().slice(0, 10);
  await saveFile(
    `myastrosky-errors-${day}.jsonl`,
    new Blob([text], { type: 'application/x-ndjson' }),
  );
  return true;
}
