import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import LabelTagInput from '../../src/components/base/LabelTagInput.vue';

const attachAnchoredPanel = vi.hoisted(() => vi.fn(() => vi.fn()));

vi.mock('../../src/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'en',
  setLang: vi.fn(),
}));
vi.mock('../../src/popup-utils', () => ({
  attachAnchoredPanel: (...args: unknown[]) => attachAnchoredPanel(...(args as [])),
}));

let wrapper: VueWrapper | null = null;

function mountInput(modelValue: string[] = [], known: string[] = ['vespera', 'ccd', 'winter']) {
  wrapper = mount(LabelTagInput, { props: { modelValue, known } });
  return wrapper;
}

/**
 * The suggestion panel is teleported, so it lives on <body>. `mount()` keeps the
 * component's own tree in a detached element, so anything found here is teleported.
 */
function panel(): HTMLElement | null {
  return document.body.querySelector('.tag-suggest');
}

beforeEach(() => {
  attachAnchoredPanel.mockClear();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('LabelTagInput — chips', () => {
  it('renders a chip per label with a remove button', () => {
    const w = mountInput(['vespera', 'winter']);
    expect(w.findAll('.tag-chip')).toHaveLength(2);
    expect(w.findAll('.tag-chip-remove')).toHaveLength(2);
  });

  it('emits the list without the removed label', async () => {
    const w = mountInput(['vespera', 'winter']);
    await w.findAll('.tag-chip-remove')[0].trigger('click');
    expect(w.emitted('update:modelValue')![0]).toEqual([['winter']]);
  });

  it('commits a typed label on Enter and refuses a duplicate', async () => {
    const w = mountInput(['vespera']);
    const input = w.find('input.tag-input');
    await input.setValue('winter');
    await input.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('update:modelValue')![0]).toEqual([['vespera', 'winter']]);

    await input.setValue('vespera');
    await input.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('update:modelValue')).toHaveLength(1); // no second emit
  });
});

describe('LabelTagInput — suggestion panel', () => {
  it('teleports the panel to <body> so a scrolling ancestor cannot clip it', async () => {
    const w = mountInput([]);
    expect(panel()).toBeNull();

    await w.find('input.tag-input').trigger('focus');
    await flushPromises();

    const p = panel();
    expect(p).not.toBeNull();
    expect(p!.parentElement).toBe(document.body);
    // and NOT inside the component's own (potentially clipped) wrapper
    expect(w.element.querySelector('.tag-suggest')).toBeNull();
  });

  it('anchors the panel to the input instead of relying on static positioning', async () => {
    const w = mountInput([]);
    await w.find('input.tag-input').trigger('focus');
    await flushPromises();

    expect(attachAnchoredPanel).toHaveBeenCalledTimes(1);
    const [panelEl, anchorEl, opts] = attachAnchoredPanel.mock.calls[0] as unknown as [
      HTMLElement,
      HTMLElement,
      Record<string, unknown>,
    ];
    expect(panelEl).toBe(panel());
    expect(anchorEl).toBe(w.find('input.tag-input').element);
    expect(typeof opts.onAnchorOutOfView).toBe('function');
  });

  it('detaches the panel when the suggestions close', async () => {
    const detach = vi.fn();
    attachAnchoredPanel.mockReturnValueOnce(detach);
    const w = mountInput([]);
    await w.find('input.tag-input').trigger('focus');
    await flushPromises();

    await w.find('input.tag-input').trigger('keydown', { key: 'Escape' });
    await flushPromises();

    expect(detach).toHaveBeenCalled();
    expect(panel()).toBeNull();
  });

  it('removes the teleported panel on unmount (no orphan left on <body>)', async () => {
    const w = mountInput([]);
    await w.find('input.tag-input').trigger('focus');
    await flushPromises();
    expect(panel()).not.toBeNull();

    w.unmount();
    wrapper = null;
    expect(panel()).toBeNull();
  });

  it('excludes labels already applied from the suggestions', async () => {
    const w = mountInput(['vespera']);
    await w.find('input.tag-input').trigger('focus');
    await flushPromises();

    const texts = [...panel()!.querySelectorAll('.tag-suggest-item')].map((e) =>
      e.textContent!.trim(),
    );
    expect(texts).not.toContain('vespera');
    expect(texts).toEqual(['ccd', 'winter']);
  });

  it('picking a suggestion emits it and closes the panel', async () => {
    const w = mountInput([]);
    await w.find('input.tag-input').trigger('focus');
    await flushPromises();

    const item = panel()!.querySelector('.tag-suggest-item') as HTMLElement;
    item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(w.emitted('update:modelValue')![0]).toEqual([['vespera']]);
    expect(panel()).toBeNull();
  });
});
