import { describe, it, expect } from 'vitest';
// The Stop hook is plain ESM under .claude/ — it exports its pure classifiers and
// only runs main() when invoked directly, so importing it here is side-effect-free.
import {
  isUiEdit,
  classifyUiEdits,
  calledReviewerSubagent,
} from '../../.claude/hooks/ui-verify-guard.js';

/** Wrap one or more tool_use blocks in a single assistant transcript entry. */
function assistant(...blocks: unknown[]) {
  return { type: 'assistant', message: { content: blocks } };
}
function edit(file_path: string, strings: Record<string, string> = {}) {
  return { type: 'tool_use', name: 'Edit', input: { file_path, ...strings } };
}

describe('isUiEdit', () => {
  it('ignores pure-logic src .ts edits', () => {
    expect(isUiEdit('Edit', { file_path: 'src/affine.ts', new_string: 'return a * b;' })).toBe(
      false,
    );
  });
  it('ignores i18n text files even with markup-looking strings', () => {
    expect(
      isUiEdit('Edit', { file_path: 'src/i18n/fr.ts', new_string: 'foo: \'class="x"\'' }),
    ).toBe(false);
  });
  it('flags a .vue edit', () => {
    expect(isUiEdit('Edit', { file_path: 'src/components/Foo.vue', new_string: '<p>hi</p>' })).toBe(
      true,
    );
  });
  it('flags a DOM-signal .ts edit', () => {
    expect(isUiEdit('Edit', { file_path: 'src/ui.ts', new_string: 'row.appendChild(btn);' })).toBe(
      true,
    );
  });
});

describe('classifyUiEdits', () => {
  it('returns "none" with no UI edits', () => {
    const entries = [assistant(edit('src/affine.ts', { new_string: 'return a * b;' }))];
    expect(classifyUiEdits(entries, 0)).toBe('none');
  });

  it('returns "none" for an i18n-only edit', () => {
    const entries = [assistant(edit('src/i18n/en.ts', { new_string: "hello: 'Hello'" }))];
    expect(classifyUiEdits(entries, 0)).toBe('none');
  });

  it('returns "trivial" for a uno.config.ts colour value swap', () => {
    const entries = [
      assistant(
        edit('uno.config.ts', {
          old_string: "primary: '#3b82f6'",
          new_string: "primary: '#f59e0b'",
        }),
      ),
    ];
    expect(classifyUiEdits(entries, 0)).toBe('trivial');
  });

  it('returns "trivial" for a single class-string swap in a .ts file', () => {
    const entries = [
      assistant(
        edit('src/ui.ts', {
          old_string: "el.className = 'tag-chip'",
          new_string: "el.className = 'tag-chip status-info'",
        }),
      ),
    ];
    expect(classifyUiEdits(entries, 0)).toBe('trivial');
  });

  it('returns "structural" when a .ts edit adds DOM nodes', () => {
    const entries = [
      assistant(
        edit('src/ui.ts', {
          new_string: 'const btn = document.createElement("button");\nrow.appendChild(btn);',
        }),
      ),
    ];
    expect(classifyUiEdits(entries, 0)).toBe('structural');
  });

  it('returns "structural" for any .vue edit', () => {
    const entries = [assistant(edit('src/components/Panel.vue', { new_string: '<span>x</span>' }))];
    expect(classifyUiEdits(entries, 0)).toBe('structural');
  });

  it('returns "structural" for a canvas.css block adding layout props', () => {
    const entries = [
      assistant(
        edit('src/styles/canvas.css', { new_string: '.foo::before { display: flex; gap: 4px; }' }),
      ),
    ];
    expect(classifyUiEdits(entries, 0)).toBe('structural');
  });

  it('takes the strongest severity across multiple edits in a turn', () => {
    const entries = [
      assistant(edit('uno.config.ts', { new_string: "primary: '#f59e0b'" })),
      assistant(edit('src/ui.ts', { new_string: 'parent.insertBefore(node, ref);' })),
    ];
    expect(classifyUiEdits(entries, 0)).toBe('structural');
  });
});

describe('calledReviewerSubagent', () => {
  const reviewerCall = {
    type: 'tool_use',
    name: 'Agent',
    input: { subagent_type: 'ui-verify-reviewer', prompt: 'verify' },
  };

  it('detects the reviewer subagent spawn', () => {
    expect(calledReviewerSubagent([assistant(reviewerCall)], 0)).toBe(true);
  });
  it('is false for an unrelated subagent', () => {
    const other = { type: 'tool_use', name: 'Agent', input: { subagent_type: 'Explore' } };
    expect(calledReviewerSubagent([assistant(other)], 0)).toBe(false);
  });
  it('is false when no subagent was spawned', () => {
    expect(calledReviewerSubagent([assistant(edit('src/ui.ts'))], 0)).toBe(false);
  });
});
