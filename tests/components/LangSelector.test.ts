import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import LangSelector from '../../src/components/panels/LangSelector.vue';

const mockSetLang = vi.hoisted(() => vi.fn());
vi.mock('../../src/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fr',
  setLang: mockSetLang,
}));

function mountSelector() {
  return mount(LangSelector, {
    global: { plugins: [createTestingPinia({ createSpy: vi.fn })] },
  });
}

describe('LangSelector', () => {
  afterEach(() => {
    mockSetLang.mockClear();
  });

  it('renders 4 language buttons', () => {
    const wrapper = mountSelector();
    expect(wrapper.findAll('.lang-btn')).toHaveLength(4);
  });

  it('shows all 4 language codes as uppercase', () => {
    const wrapper = mountSelector();
    const labels = wrapper.findAll('.lang-btn').map((b) => b.text());
    expect(labels).toEqual(['FR', 'EN', 'ES', 'DE']);
  });

  it('marks the current language as active', () => {
    const wrapper = mountSelector();
    const active = wrapper.findAll('.lang-btn.active');
    expect(active).toHaveLength(1);
    expect(active[0].text()).toBe('FR');
  });

  it('calls setLang when a language button is clicked', async () => {
    const wrapper = mountSelector();
    await wrapper.findAll('.lang-btn')[1].trigger('click'); // EN
    expect(mockSetLang).toHaveBeenCalledWith('en');
  });
});
