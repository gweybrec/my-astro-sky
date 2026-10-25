import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@vue/compiler-sfc';

// The screens build their controls from the shared components (src/components/Phone*.vue), never from a plain
// <button>, <input>, <select> or <textarea>: a plain control misses the design system's states, its touch size and
// Ionic's handling. Only the components themselves hold the plain elements Ionic has no part for.
const pages = join(__dirname, '../src/pages');
const files = globSync('**/*.vue', { cwd: pages });
const PLAIN = new Set(['button', 'input', 'select', 'textarea']);

interface TemplateNode {
  type: number;
  tag?: string;
  loc?: { start: { line: number } };
  children?: TemplateNode[];
}

function plainControls(node: TemplateNode, out: string[]): string[] {
  // 1: an element.
  if (node.type === 1 && PLAIN.has(node.tag!))
    out.push(`<${node.tag}> at line ${node.loc!.start.line}`);
  for (const child of node.children ?? []) plainControls(child, out);
  return out;
}

describe('the phone screens', () => {
  it('found the screens to check', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it.each(files)('%s uses no plain control', (file) => {
    const { descriptor } = parse(readFileSync(join(pages, file), 'utf8'), { filename: file });
    const ast = descriptor.template?.ast as TemplateNode | undefined;
    expect(ast ? plainControls(ast, []) : []).toEqual([]);
  });
});
