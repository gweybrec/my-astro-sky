import path from 'path';
import { fileURLToPath } from 'url';

export const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.DB_PATH || path.join(SERVER_DIR, '..', 'data.db');
export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(SERVER_DIR, '..', 'uploads');
/**
 * Where an uploaded archive (a backup, a shared sky) is written while it is read: on the photos' own disk, so the
 * free-space check counts one disk. Its name starts with a dot: no photo file can, and `/uploads` does not serve it.
 */
export const INCOMING_DIR = process.env.INCOMING_DIR || path.join(UPLOADS_DIR, '.incoming');
export const RESOURCES_DIR = process.env.RESOURCES_DIR || path.join(SERVER_DIR, '..', 'resources');
export const DIST_DIR = process.env.DIST_DIR || path.join(SERVER_DIR, '..', 'dist');
export const SWAGGER_JSON_PATH = path.join(SERVER_DIR, '../public/swagger.json');
