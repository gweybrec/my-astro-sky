import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import BaseModal from '../../src/components/base/BaseModal.vue';

vi.mock('../../src/i18n', () => ({ t: (key: string) => key, getLang: () => 'fr', setLang: vi.fn() }));

// BaseModal uses <Teleport to="body">. Its DOM lands in document.body, not
// inside the wrapper root. All selectors must target document.body directly.

function mountModal(props: Record<string, unknown> = {}) {
  return mount(BaseModal, {
    props: { title: 'Test Modal', ...props },
    global: {
      plugins: [createTestingPinia({ createSpy: vi.fn })],
    },
    attachTo: document.body,
  });
}

describe('BaseModal', () => {
  let wrapper: ReturnType<typeof mountModal>;

  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = '';
  });

  it('renders the title', () => {
    wrapper = mountModal({ title: 'My Title' });
    expect(document.body.querySelector('.modal-header')?.textContent).toContain('My Title');
  });

  it('emits close when the close button is clicked', async () => {
    wrapper = mountModal();
    const btn = document.body.querySelector<HTMLButtonElement>('.modal-close');
    btn?.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('does NOT emit close when the backdrop is clicked', async () => {
    wrapper = mountModal();
    const backdrop = document.body.querySelector<HTMLElement>('.modal-backdrop');
    backdrop?.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('close')).toBeFalsy();
  });

  it('does NOT emit close when the modal body is clicked', async () => {
    wrapper = mountModal();
    const modal = document.body.querySelector<HTMLElement>('.modal');
    modal?.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('close')).toBeFalsy();
  });

  it('emits close when Escape is pressed', async () => {
    wrapper = mountModal();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('close')).toBeTruthy();
  });
});
