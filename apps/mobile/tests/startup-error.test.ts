import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import StartupError from '../src/components/StartupError.vue';

describe('the start-up error screen', () => {
  const reload = vi.fn();
  beforeEach(() => {
    localStorage.setItem('lang', 'fr');
    vi.stubGlobal('location', { ...window.location, reload });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the error text and a Réessayer button that starts again', async () => {
    const wrapper = mount(StartupError, { props: { message: 'database is locked' } });
    expect(wrapper.text()).toContain('database is locked');
    const button = wrapper.find('button');
    expect(button.text()).toBe('Réessayer');
    await button.trigger('click');
    expect(reload).toHaveBeenCalledOnce();
  });
});
