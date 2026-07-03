import ThumbnailWorker from './thumbnail-worker?worker';
import { reportUnknownRendererError } from './error-reporter';

let _worker: Worker | null = null;
const pending = new Map<string, (url: string | null) => void>();
let counter = 0;

function getWorker(): Worker | null {
  if (_worker) return _worker;
  try {
    _worker = new ThumbnailWorker() as Worker;
    (_worker as Worker).onmessage = (
      e: MessageEvent<{ id: string; blob?: Blob; error?: string }>,
    ) => {
      const { id, blob, error } = e.data;
      const resolve = pending.get(id);
      if (!resolve) return;
      pending.delete(id);
      resolve(!error && blob ? URL.createObjectURL(blob) : null);
    };
    (_worker as Worker).onerror = (e) => {
      reportUnknownRendererError(
        'thumbnail_worker_error',
        new Error(e.message ?? 'Thumbnail worker error'),
      );
    };
  } catch {
    // Worker not available (e.g., test environment or unsupported browser)
  }
  return _worker;
}

/** Generate a max-width thumbnail from a File off the main thread. Returns a blob URL or null on failure. */
export function generateThumbnail(file: File, maxWidth = 240): Promise<string | null> {
  const w = getWorker();
  if (!w) return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = `t${++counter}`;
    pending.set(id, resolve);
    w.postMessage({ id, file, maxWidth });
  });
}

/**
 * Create an IntersectionObserver that fires onVisible when an element enters the scroll root
 * (+ rootMargin buffer) and optionally onHidden when it leaves.
 * Pass null as scrollRoot to observe relative to the viewport.
 */
export function createLazyObserver(options: {
  scrollRoot: Element | null;
  rootMargin?: string;
  onVisible: (el: HTMLElement) => void;
  onHidden?: (el: HTMLElement) => void;
}): IntersectionObserver {
  return new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          options.onVisible(entry.target as HTMLElement);
        } else {
          options.onHidden?.(entry.target as HTMLElement);
        }
      }
    },
    { root: options.scrollRoot, rootMargin: options.rootMargin ?? '300px 0px', threshold: 0 },
  );
}
