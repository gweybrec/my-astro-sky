/**
 * `planSetupImportActions` (server/import-utils.ts) decides what an import does with the setups of a
 * bundle: which are written, under which id, which local setups they replace, which plans are
 * pointed at another setup, and which custom gear comes along.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyBundleSetup,
  parseBundlePlanSetupIds,
  parseBundleSetups,
  planSetupImportActions,
} from '../../server/import-utils';
import type { GearSetupData } from '../../packages/core/src/domain/gear';

const setup = (over: Partial<GearSetupData> & { id: string }): GearSetupData => ({
  name: `Name of ${over.id}`,
  telescopeId: 'tel-builtin',
  cameraId: 'cam-builtin',
  accessoryId: null,
  enabled: true,
  ...over,
});

type Input = Parameters<typeof planSetupImportActions>[0];

/** An input with nothing ticked and nothing local; each test overrides what it needs. */
const run = (over: Partial<Input>) =>
  planSetupImportActions({
    bundleSetups: [],
    bundlePlans: [],
    bundleGearIds: [],
    selectedPlans: new Set(),
    selectedSetups: new Set(),
    selectedGear: new Set(),
    choices: {},
    localSetups: [],
    localGearIds: new Set(),
    newId: () => 'fresh',
    ...over,
  });

const planUsing = (id: string, setupId: string | null) => ({ id, setupId });

describe('classifyBundleSetup', () => {
  it('is none when no local setup has the id or the name', () => {
    expect(classifyBundleSetup(setup({ id: 'a' }), [setup({ id: 'b' })])).toEqual({
      conflict: 'none',
    });
  });

  it('is identical for the same id and equal content, ignoring enabled', () => {
    const local = setup({ id: 'a', enabled: false });
    expect(classifyBundleSetup(setup({ id: 'a' }), [local])).toEqual({
      conflict: 'identical',
      localId: 'a',
    });
  });

  it('matches by name when no id matches, and reports the local id', () => {
    const local = setup({ id: 'local', name: 'Rig' });
    expect(classifyBundleSetup(setup({ id: 'a', name: 'Rig' }), [local])).toEqual({
      conflict: 'identical',
      localId: 'local',
    });
  });

  it('prefers the same id over the same name', () => {
    const byName = setup({ id: 'x', name: 'Rig' });
    const byId = setup({ id: 'a', name: 'Other' });
    expect(classifyBundleSetup(setup({ id: 'a', name: 'Rig' }), [byName, byId])).toMatchObject({
      localId: 'a',
      conflict: 'different',
    });
  });

  it.each([
    ['name', { name: 'Renamed' }],
    ['telescope', { telescopeId: 'other' }],
    ['camera', { cameraId: 'other' }],
    ['accessory', { accessoryId: 'acc' }],
  ])('is different when the %s differs', (_label, change) => {
    const local = setup({ id: 'a', ...change });
    expect(classifyBundleSetup(setup({ id: 'a' }), [local])).toEqual({
      conflict: 'different',
      localId: 'a',
    });
  });

  it('never matches an empty name by name', () => {
    expect(
      classifyBundleSetup(setup({ id: 'a', name: '' }), [setup({ id: 'b', name: '' })]),
    ).toEqual({ conflict: 'none' });
  });
});

describe('parseBundleSetups and parseBundlePlanSetupIds', () => {
  it('keeps only setups with a string id, telescope and camera, and fills the defaults', () => {
    expect(
      parseBundleSetups([
        { id: 'a', telescopeId: 't', cameraId: 'c' },
        { id: 'b', telescopeId: 't' },
        { telescopeId: 't', cameraId: 'c' },
        { id: 'd', name: 'D', telescopeId: 't', cameraId: 'c', accessoryId: 'x', enabled: false },
      ]),
    ).toEqual([
      { id: 'a', name: '', telescopeId: 't', cameraId: 'c', accessoryId: null, enabled: true },
      { id: 'd', name: 'D', telescopeId: 't', cameraId: 'c', accessoryId: 'x', enabled: false },
    ]);
    expect(parseBundleSetups('nope')).toEqual([]);
  });

  it('reads the setup id of each plan, null when absent', () => {
    expect(
      parseBundlePlanSetupIds([{ id: 'p1', setupId: 's1' }, { id: 'p2' }, { name: 'no id' }]),
    ).toEqual([
      { id: 'p1', setupId: 's1' },
      { id: 'p2', setupId: null },
    ]);
    expect(parseBundlePlanSetupIds(null)).toEqual([]);
  });
});

describe('planSetupImportActions', () => {
  const bundle = [setup({ id: 'new' })];

  it('imports a ticked setup with no local counterpart', () => {
    const r = run({ bundleSetups: bundle, selectedSetups: new Set(['new']) });
    expect(r.actions).toEqual([
      { bundleId: 'new', conflict: 'none', action: 'import', setup: bundle[0], replaceIds: [] },
    ]);
    expect(r.setupIdRemap).toEqual({});
  });

  it('imports the setup of a ticked plan even when it is not ticked itself', () => {
    const r = run({
      bundleSetups: bundle,
      bundlePlans: [planUsing('p', 'new')],
      selectedPlans: new Set(['p']),
    });
    expect(r.actions.map((a) => [a.bundleId, a.action])).toEqual([['new', 'import']]);
  });

  it('pulls nothing for a plan that is not ticked', () => {
    const r = run({
      bundleSetups: bundle,
      bundlePlans: [planUsing('p', 'new')],
      selectedPlans: new Set(),
    });
    expect(r.actions).toEqual([]);
    expect(r.extraGearIds).toEqual([]);
  });

  it('handles a setup required by two plans once', () => {
    const r = run({
      bundleSetups: bundle,
      bundlePlans: [planUsing('p1', 'new'), planUsing('p2', 'new')],
      selectedPlans: new Set(['p1', 'p2']),
      selectedSetups: new Set(['new']),
    });
    expect(r.actions).toHaveLength(1);
  });

  it('leaves a setup nobody ticked or needs out', () => {
    const r = run({
      bundleSetups: [setup({ id: 'a' }), setup({ id: 'b' })],
      bundlePlans: [planUsing('p', 'a')],
      selectedPlans: new Set(['p']),
    });
    expect(r.actions.map((a) => a.bundleId)).toEqual(['a']);
  });

  it('keeps a plan whose setup is neither local nor in the bundle untouched', () => {
    const r = run({
      bundleSetups: bundle,
      bundlePlans: [planUsing('p', 'ghost')],
      selectedPlans: new Set(['p']),
    });
    expect(r.actions).toEqual([]);
    expect(r.setupIdRemap).toEqual({});
  });

  describe('identical local setup', () => {
    const local = setup({ id: 'local', name: 'Name of new' });

    it('writes nothing and points the plans at the local id', () => {
      const r = run({
        bundleSetups: bundle,
        bundlePlans: [planUsing('p', 'new')],
        selectedPlans: new Set(['p']),
        selectedSetups: new Set(['new']),
        localSetups: [local],
      });
      expect(r.actions).toEqual([
        { bundleId: 'new', conflict: 'identical', action: 'useLocal', replaceIds: [] },
      ]);
      expect(r.setupIdRemap).toEqual({ new: 'local' });
    });

    it('needs no remap when the local setup has the same id', () => {
      const r = run({
        bundleSetups: bundle,
        selectedSetups: new Set(['new']),
        localSetups: [setup({ id: 'new' })],
      });
      expect(r.actions[0].action).toBe('useLocal');
      expect(r.setupIdRemap).toEqual({});
    });

    it('ignores any choice sent for it', () => {
      const r = run({
        bundleSetups: bundle,
        selectedSetups: new Set(['new']),
        choices: { new: 'keepBoth' },
        localSetups: [local],
      });
      expect(r.actions[0].action).toBe('useLocal');
    });
  });

  describe('different local setup', () => {
    // Same name, other camera; the local id differs from the bundle's.
    const local = setup({ id: 'local', name: 'Name of new', cameraId: 'other-cam' });
    const base = { bundleSetups: bundle, localSetups: [local] };

    it('replace: writes the bundle setup and deletes the local one; plans keep the bundle id', () => {
      const r = run({
        ...base,
        bundlePlans: [planUsing('p', 'new')],
        selectedPlans: new Set(['p']),
        selectedSetups: new Set(['new']),
        choices: { new: 'replace' },
      });
      expect(r.actions).toEqual([
        {
          bundleId: 'new',
          conflict: 'different',
          action: 'replace',
          setup: bundle[0],
          replaceIds: ['local'],
        },
      ]);
      expect(r.setupIdRemap).toEqual({});
    });

    it('replace: also deletes every other local setup of the same name', () => {
      const r = run({
        ...base,
        localSetups: [local, setup({ id: 'twin', name: 'Name of new', cameraId: 'x' })],
        selectedSetups: new Set(['new']),
        choices: { new: 'replace' },
      });
      expect([...r.actions[0].replaceIds].sort()).toEqual(['local', 'twin']);
    });

    it('replace: a same-id local setup with another name is replaced by the write itself', () => {
      const sameId = setup({ id: 'new', name: 'Renamed locally' });
      const r = run({
        bundleSetups: bundle,
        localSetups: [sameId],
        selectedSetups: new Set(['new']),
        choices: { new: 'replace' },
      });
      expect(r.actions[0].replaceIds).toEqual(['new']);
    });

    it('keepBoth: writes a new id with " (import)", leaves the local one, repoints the plans', () => {
      const r = run({
        ...base,
        bundlePlans: [planUsing('p', 'new')],
        selectedPlans: new Set(['p']),
        selectedSetups: new Set(['new']),
        choices: { new: 'keepBoth' },
        newId: () => 'uuid-1',
      });
      expect(r.actions).toEqual([
        {
          bundleId: 'new',
          conflict: 'different',
          action: 'keepBoth',
          setup: { ...bundle[0], id: 'setup-uuid-1', name: 'Name of new (import)' },
          replaceIds: [],
        },
      ]);
      expect(r.setupIdRemap).toEqual({ new: 'setup-uuid-1' });
    });

    it('skip: writes nothing and points the plans at the local setup', () => {
      const r = run({
        ...base,
        bundlePlans: [planUsing('p', 'new')],
        selectedPlans: new Set(['p']),
        selectedSetups: new Set(['new']),
        choices: { new: 'skip' },
      });
      expect(r.actions).toEqual([
        { bundleId: 'new', conflict: 'different', action: 'skip', replaceIds: [] },
      ]);
      expect(r.setupIdRemap).toEqual({ new: 'local' });
    });

    it('no choice, ticked: replaces (what a ticked setup did before)', () => {
      const r = run({ ...base, selectedSetups: new Set(['new']) });
      expect(r.actions[0]).toMatchObject({ action: 'replace', replaceIds: ['local'] });
    });

    it('no choice, only pulled in by a plan: skips and points the plan at the local setup', () => {
      const r = run({
        ...base,
        bundlePlans: [planUsing('p', 'new')],
        selectedPlans: new Set(['p']),
      });
      expect(r.actions[0].action).toBe('skip');
      expect(r.setupIdRemap).toEqual({ new: 'local' });
    });

    it('an unknown choice value counts as no choice', () => {
      const r = run({ ...base, selectedSetups: new Set(['new']), choices: { new: 'bogus' } });
      expect(r.actions[0].action).toBe('replace');
    });

    it('does not repoint a plan at the local id when it is the bundle id already', () => {
      const r = run({
        bundleSetups: bundle,
        localSetups: [setup({ id: 'new', cameraId: 'other-cam' })],
        bundlePlans: [planUsing('p', 'new')],
        selectedPlans: new Set(['p']),
        choices: { new: 'skip' },
      });
      expect(r.actions[0].action).toBe('skip');
      expect(r.setupIdRemap).toEqual({});
    });
  });

  describe('custom gear dependencies', () => {
    const gearSetup = setup({
      id: 's',
      telescopeId: 'custom-tel',
      cameraId: 'custom-cam',
      accessoryId: 'custom-acc',
    });

    it('imports the bundle gear a written setup uses and this machine lacks', () => {
      const r = run({
        bundleSetups: [gearSetup],
        bundleGearIds: ['custom-tel', 'custom-cam', 'custom-acc', 'custom-unused'],
        selectedSetups: new Set(['s']),
        localGearIds: new Set(['custom-cam']),
      });
      expect([...r.extraGearIds].sort()).toEqual(['custom-acc', 'custom-tel']);
    });

    it('skips gear that is already ticked', () => {
      const r = run({
        bundleSetups: [gearSetup],
        bundleGearIds: ['custom-tel', 'custom-cam', 'custom-acc'],
        selectedSetups: new Set(['s']),
        selectedGear: new Set(['custom-tel']),
      });
      expect([...r.extraGearIds].sort()).toEqual(['custom-acc', 'custom-cam']);
    });

    it('ignores ids the bundle does not carry (built-in gear)', () => {
      const r = run({
        bundleSetups: [gearSetup],
        bundleGearIds: [],
        selectedSetups: new Set(['s']),
      });
      expect(r.extraGearIds).toEqual([]);
    });

    it('brings gear for a setup pulled in by a plan, and for a kept-both copy', () => {
      const pulled = run({
        bundleSetups: [gearSetup],
        bundlePlans: [planUsing('p', 's')],
        bundleGearIds: ['custom-tel'],
        selectedPlans: new Set(['p']),
      });
      expect(pulled.extraGearIds).toEqual(['custom-tel']);

      const local = setup({ id: 'local', name: gearSetup.name, cameraId: 'x' });
      const both = run({
        bundleSetups: [gearSetup],
        bundleGearIds: ['custom-tel'],
        selectedSetups: new Set(['s']),
        localSetups: [local],
        choices: { s: 'keepBoth' },
      });
      expect(both.extraGearIds).toEqual(['custom-tel']);
    });

    it('brings no gear for a setup that is not written', () => {
      const local = setup({ id: 'local', name: gearSetup.name, cameraId: 'x' });
      const skipped = run({
        bundleSetups: [gearSetup],
        bundleGearIds: ['custom-tel'],
        selectedSetups: new Set(['s']),
        localSetups: [local],
        choices: { s: 'skip' },
      });
      expect(skipped.extraGearIds).toEqual([]);

      const identical = run({
        bundleSetups: [gearSetup],
        bundleGearIds: ['custom-tel'],
        selectedSetups: new Set(['s']),
        localSetups: [{ ...gearSetup, id: 'local' }],
      });
      expect(identical.extraGearIds).toEqual([]);
    });
  });
});
