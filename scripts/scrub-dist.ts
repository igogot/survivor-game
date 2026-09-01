/**
 * Takes the database password back out of the build.
 *
 * `public/` is copied into `dist/` wholesale, and the API has to live there —
 * `scores.php` requires `config.php` from its own directory, which is what
 * that directory looks like on the host. Locally that means a real password
 * can sit in `public/api/config.php`, and every `npm run build` copies it into
 * `dist/`.
 *
 * That matters because `dist/` is also what goes to GitHub Pages, and Pages
 * does not run PHP — it would serve the file as text to anybody who asked for
 * it. The FTP deploy excludes it, so the host keeps its own copy; nothing here
 * touches that.
 *
 * CI is not where this bites: the file is gitignored, so a clean checkout never
 * has one. It bites on a laptop that has been used to test the API and then
 * uploads `dist/` by hand. Cheap to prevent, expensive to discover.
 */

import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Anything here would be published as readable text by a static host. */
const SECRETS = ['api/config.php'];

let removed = 0;
for (const relative of SECRETS) {
  const path = resolve(here, '../dist', relative);
  if (!existsSync(path)) continue;

  rmSync(path);
  removed++;
  console.warn(
    `scrub-dist: removed ${relative} from dist/ — it holds credentials and a ` +
      'static host would serve it as text. The copy on the server is untouched.',
  );
}

if (removed === 0) console.log('scrub-dist: nothing to remove');
