// Copies what the phone bundles into the public files of the build: the repository's `public/data/` (the star,
// name, constellation and deep-sky files) and the four gear lists of `resources/` as `gear/*.json`. The copies
// are git-ignored; this runs before each build.
import { cpSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '../../..');
const pub = join(here, '../public');

rmSync(join(pub, 'data'), { recursive: true, force: true });
rmSync(join(pub, 'gear'), { recursive: true, force: true });
cpSync(join(repo, 'public/data'), join(pub, 'data'), { recursive: true });
mkdirSync(join(pub, 'gear'), { recursive: true });
for (const name of ['telescopes', 'cameras', 'accessories', 'filters']) {
  copyFileSync(join(repo, 'resources', `${name}.json`), join(pub, 'gear', `${name}.json`));
}
console.log('bundled data copied into apps/mobile/public');
