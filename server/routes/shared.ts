import { randomUUID } from 'crypto';
import fs from 'fs';
import multer from 'multer';
import { INCOMING_DIR } from '../server-paths.js';

export { ALLOWED_PHOTO_EXTENSIONS } from '@myastrosky/core/services/photos';

// In Electron the server runs inside the Electron main process (process.versions.electron is set).
// Rate limiting is meaningless there (single-user local app).
export const isElectron = !!process.versions.electron;

// Simple in-memory rate limiter
export const rateLimits = new Map<string, number[]>();
export const RATE_WINDOW_MS = 60_000;
export const UPLOAD_LIMIT = 200; // uploads per minute
export const API_LIMIT = 300; // API requests per minute — sized for batch status polling (every 2s per active solve)

export function checkRateLimit(ip: string, limit: number): boolean {
  const now = Date.now();
  let timestamps = rateLimits.get(ip);
  if (!timestamps) {
    timestamps = [];
    rateLimits.set(ip, timestamps);
  }
  // Evict old entries
  while (timestamps.length > 0 && timestamps[0] <= now - RATE_WINDOW_MS) {
    timestamps.shift();
  }
  if (timestamps.length >= limit) return false;
  timestamps.push(now);
  return true;
}

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/gif',
  'image/webp',
  'image/bmp',
]);

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(Object.assign(new Error('Invalid file type'), { status: 400, code: 'INVALID_FILE_TYPE' }));
    }
  },
});

// Separate multer instance for WCS companion files (FITS/TIFF can be large)
export const uploadWCS = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB for raw FITS/TIFF
});

/** The largest archive taken: far above any real one, so that an upload cannot fill the disk without end. */
export const MAX_BUNDLE_BYTES = 64 * 1024 * 1024 * 1024;
/** The largest `.json` backup (a photo list), which is read whole. */
export const MAX_JSON_BUNDLE_BYTES = 200 * 1024 * 1024;

// Import archives (ZIP/JSON, not image MIME types) are written to a file in INCOMING_DIR and read from there by
// pieces: an archive of several gigabytes never sits in memory. The route removes the file when it has answered.
export const uploadBundle = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdir(INCOMING_DIR, { recursive: true }, (err) => cb(err, INCOMING_DIR));
    },
    filename: (_req, _file, cb) => cb(null, `${randomUUID()}.part`),
  }),
  limits: { fileSize: MAX_BUNDLE_BYTES },
});

// Separate multer instance for raw astro image conversion (FITS/TIFF, arrives as
// application/octet-stream and can be much larger than a normal photo upload — deliberately
// no fileFilter, mirroring uploadWCS; the route validates by extension instead).
export const uploadRaw = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 600 * 1024 * 1024 }, // 600 MB — real FITS stacks can exceed 200 MB
});
