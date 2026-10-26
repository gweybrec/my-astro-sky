import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from '@vue/compiler-sfc';

// Every text the phone shows goes through t(), in its four languages: no word written in a screen's markup, and no
// label joined to its value by hand (the French " : " and " %" read wrong in the other three languages).
const src = join(__dirname, '../src');
// The components gallery is for the checks only (it is not in the app's bundle, see router.ts).
const files = globSync('**/*.vue', { cwd: src }).filter(
  (f) => !f.endsWith('DevComponentsPage.vue'),
);
// The units of a right ascension, written the same in every language.
const SAME_IN_EVERY_LANGUAGE = new Set(['h', 'm', 's']);

interface TemplateNode {
  type: number;
  content?: string;
  children?: TemplateNode[];
}

function wordsInMarkup(node: TemplateNode, out: string[]): string[] {
  // 2: a text node; comments and {{ }} are other types.
  const text = node.type === 2 ? (node.content ?? '').trim() : '';
  if (/\p{L}/u.test(text) && !SAME_IN_EVERY_LANGUAGE.has(text)) out.push(text);
  for (const child of node.children ?? []) wordsInMarkup(child, out);
  return out;
}

describe('the phone screens', () => {
  it('found the screens to check', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files)('%s writes no word outside t()', (file) => {
    const { descriptor } = parse(readFileSync(join(src, file), 'utf8'), { filename: file });
    const ast = descriptor.template?.ast as TemplateNode | undefined;
    expect(ast ? wordsInMarkup(ast, []) : []).toEqual([]);
  });

  it.each(files)('%s joins no label, value or percentage by hand', (file) => {
    const lines = readFileSync(join(src, file), 'utf8').split('\n');
    const joined = lines.flatMap((line, i) =>
      /\}( ?: \$\{| ?%`)/.test(line) ? [`${relative(src, join(src, file))}:${i + 1}`] : [],
    );
    expect(joined).toEqual([]);
  });
});
