import path from 'path';
import { fileURLToPath } from 'url';

export const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(SERVER_DIR, '..', 'uploads');
export const RESOURCES_DIR = process.env.RESOURCES_DIR || path.join(SERVER_DIR, '..', 'resources');
export const DIST_DIR = process.env.DIST_DIR || path.join(SERVER_DIR, '..', 'dist');
export const SWAGGER_JSON_PATH = path.join(SERVER_DIR, '../public/swagger.json');
