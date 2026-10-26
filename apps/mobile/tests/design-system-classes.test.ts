import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The app ships only the part of the design system's stylesheet it uses. The design system's own copy also carries the
// desktop's classes and what only the mockups draw (status bar, keyboard, drawings over a map picture); a class of
// bundle.css that no element of the app carries is dead weight, and a comment naming it does not count.
const repo = join(__dirname, '../../..');
const BUNDLE = 'apps/mobile/src/theme/design-system/bundle.css';
const sources = [
  ...globSync('apps/mobile/src/**/*.{vue,ts,css}', { cwd: repo }),
  ...globSync('packages/*/src/**/*.{vue,ts,css}', { cwd: repo }),
  'apps/mobile/index.html',
]
  .map((f) => f.replace(/\\/g, '/'))
  .filter((f) => f !== BUNDLE);

function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** The class names in the selectors of a style sheet (at-rule preludes and keyframe steps hold none). */
function selectorClasses(css: string): Set<string> {
  const out = new Set<string>();
  for (const [, prelude] of withoutComments(css).matchAll(/([^{}]+)\{/g)) {
    if (prelude.trim().startsWith('@')) continue;
    for (const [, name] of prelude.matchAll(/\.([a-zA-Z_][\w-]*)/g)) out.add(name);
  }
  return out;
}

function unused(classes: Set<string>, code: string): string[] {
  return [...classes].filter((c) => !new RegExp(`(^|[^\\w-])${c}(?![\\w-])`).test(code));
}

describe('the design system stylesheet of the phone app', () => {
  const code = sources.map((f) => withoutComments(readFileSync(join(repo, f), 'utf8'))).join('\n');

  it('found the stylesheet and the sources', () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(selectorClasses(readFileSync(join(repo, BUNDLE), 'utf8')).size).toBeGreaterThan(100);
  });

  it('flags a class named only in a comment, and not a longer name or a url', () => {
    const css =
      '@media (min-width: 0.5px) { .mob-a, .mob-b:focus { mask: url("http://www.w3.org/x.svg") } }\n.mob-c > .mob-a { }';
    const app = '<div class="mob-a mob-c-more" />\n/* .mob-b */\n// mob-c';
    expect(unused(selectorClasses(css), withoutComments(app)).sort()).toEqual(['mob-b', 'mob-c']);
  });

  it('carries no class that the app does not use', () => {
    expect(unused(selectorClasses(readFileSync(join(repo, BUNDLE), 'utf8')), code)).toEqual([]);
  });
});
