import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import PhoneSegmented from '../src/components/PhoneSegmented.vue';

/** A choice among a few short values side by side. */
describe('the segmented choice', () => {
  const options = ['3', '4', '5', '6'].map((value) => ({ value, label: value }));

  it('shows the values as one group of radios, the chosen one marked', () => {
    const w = mount(PhoneSegmented, {
      props: { options, label: 'Photos par ligne', modelValue: '6' },
    });
    expect(w.find('[role=radiogroup]').attributes('aria-label')).toBe('Photos par ligne');
    const radios = w.findAll('[role=radio]');
    expect(radios.map((r) => r.text())).toEqual(['3', '4', '5', '6']);
    expect(radios.map((r) => r.attributes('aria-checked'))).toEqual([
      'false',
      'false',
      'false',
      'true',
    ]);
  });

  it('tells the value tapped', async () => {
    const w = mount(PhoneSegmented, {
      props: { options, label: 'Photos par ligne', modelValue: '6' },
    });
    await w.findAll('[role=radio]')[1].trigger('click');
    expect(w.emitted('update:modelValue')).toEqual([['4']]);
  });
});
