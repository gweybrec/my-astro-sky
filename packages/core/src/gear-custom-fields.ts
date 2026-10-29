/**
 * The fields of the "Ajouter un télescope / une caméra / un accessoire / un filtre"
 * forms, shared by the desktop modal and the phone page, and the record a filled
 * form is saved as.
 *
 * A field's `name` is both its label (`targets.gear.fields.<name>`) and its help
 * text (`targets.gear.fields.help.<name>`).
 */

import type { CustomGearType } from './gear-catalog';

export interface CustomGearField {
  /** The property of the saved record. */
  key: string;
  name: string;
  type: 'text' | 'number' | 'select' | 'color';
  required: boolean;
  /** For `select`: the values and the i18n keys of their labels. */
  options?: { value: string; labelKey: string }[];
  step?: string;
  placeholder?: string;
  /** Initial value (a `color` or `select` field always submits one). */
  defaultValue?: string;
  /** The phone shows the help behind an "i"; the other fields' help is obvious from the label. */
  phoneInfo?: boolean;
}

export const DEFAULT_FILTER_COLOR = '#2850a0';

const FILTER_TYPES = [
  'broadband',
  'narrowband',
  'dual_narrowband',
  'triband_narrowband',
  'quadband_narrowband',
  'light_pollution',
  'solar_narrowband',
  'solar_nd',
];

export const CUSTOM_GEAR_FIELDS: Record<CustomGearType, CustomGearField[]> = {
  telescope: [
    { key: 'brand', name: 'brand', type: 'text', required: true, placeholder: 'e.g. Celestron' },
    { key: 'model', name: 'model', type: 'text', required: true, placeholder: 'e.g. C8 SCT' },
    {
      key: 'aperture_mm',
      name: 'apertureMm',
      type: 'number',
      required: true,
      step: '0.1',
      placeholder: 'e.g. 203',
    },
    {
      key: 'focal_length_mm',
      name: 'focalLengthMm',
      type: 'number',
      required: true,
      step: '0.1',
      placeholder: 'e.g. 2032',
    },
    {
      key: 'optical_design',
      name: 'opticalDesign',
      type: 'text',
      required: false,
      placeholder: 'e.g. Schmidt-Cassegrain',
      phoneInfo: true,
    },
    {
      key: 'mount_interface',
      name: 'mountInterface',
      type: 'text',
      required: false,
      placeholder: 'e.g. M48, 2"',
      phoneInfo: true,
    },
    { key: 'optical_notes', name: 'opticalNotes', type: 'text', required: false },
  ],
  camera: [
    { key: 'brand', name: 'brand', type: 'text', required: true, placeholder: 'e.g. Atik' },
    { key: 'model', name: 'model', type: 'text', required: true, placeholder: 'e.g. 314L+' },
    {
      key: 'color_type',
      name: 'colorType',
      type: 'select',
      required: true,
      options: [
        { value: 'OSC', labelKey: 'targets.gear.colorTypeOSC' },
        { value: 'Mono', labelKey: 'targets.gear.colorTypeMono' },
      ],
      defaultValue: 'OSC',
      phoneInfo: true,
    },
    {
      key: 'sensor_width_mm',
      name: 'sensorWidthMm',
      type: 'number',
      required: true,
      step: '0.01',
      placeholder: 'e.g. 8.98',
    },
    {
      key: 'sensor_height_mm',
      name: 'sensorHeightMm',
      type: 'number',
      required: true,
      step: '0.01',
      placeholder: 'e.g. 6.71',
    },
    {
      key: 'pixel_size_um',
      name: 'pixelSizeUm',
      type: 'number',
      required: true,
      step: '0.01',
      placeholder: 'e.g. 6.45',
    },
    {
      key: 'sensor',
      name: 'sensor',
      type: 'text',
      required: false,
      placeholder: 'e.g. Sony ICX285AL',
      phoneInfo: true,
    },
  ],
  accessory: [
    { key: 'brand', name: 'brand', type: 'text', required: true, placeholder: 'e.g. Celestron' },
    {
      key: 'model',
      name: 'model',
      type: 'text',
      required: true,
      placeholder: 'e.g. Focal Reducer 0.63×',
    },
    {
      key: 'magnification_factor',
      name: 'magnificationFactor',
      type: 'number',
      required: true,
      step: '0.01',
      placeholder: 'e.g. 0.63',
      phoneInfo: true,
    },
    {
      key: 'type',
      name: 'accessoryType',
      type: 'text',
      required: false,
      placeholder: 'e.g. focal reducer',
      phoneInfo: true,
    },
    { key: 'notes', name: 'accessoryNotes', type: 'text', required: false },
    {
      key: 'thread_input',
      name: 'threadInput',
      type: 'text',
      required: false,
      placeholder: 'e.g. M48',
      phoneInfo: true,
    },
    {
      key: 'thread_output',
      name: 'threadOutput',
      type: 'text',
      required: false,
      placeholder: 'e.g. M42',
      phoneInfo: true,
    },
  ],
  filter: [
    { key: 'brand', name: 'brand', type: 'text', required: true, placeholder: 'e.g. Antlia' },
    { key: 'model', name: 'model', type: 'text', required: true, placeholder: 'e.g. ALP-T 5nm' },
    {
      key: 'color',
      name: 'filterColor',
      type: 'color',
      required: false,
      defaultValue: DEFAULT_FILTER_COLOR,
      phoneInfo: true,
    },
    {
      key: 'type',
      name: 'filterType',
      type: 'select',
      required: false,
      options: FILTER_TYPES.map((v) => ({ value: v, labelKey: `targets.gear.filterTypes.${v}` })),
      defaultValue: 'broadband',
      phoneInfo: true,
    },
    {
      key: 'subtype',
      name: 'filterSubtype',
      type: 'text',
      required: false,
      placeholder: 'e.g. Ha+OIII',
      phoneInfo: true,
    },
    {
      key: 'mono_osc',
      name: 'monoOsc',
      type: 'select',
      required: false,
      options: ['both', 'mono', 'osc'].map((v) => ({
        value: v,
        labelKey: `targets.gear.monoOsc.${v}`,
      })),
      defaultValue: 'both',
      phoneInfo: true,
    },
    {
      key: 'center_nm',
      name: 'centerNm',
      type: 'number',
      required: false,
      step: '0.1',
      placeholder: 'e.g. 656.3',
      phoneInfo: true,
    },
    {
      key: 'fwhm_nm',
      name: 'fwhmNm',
      type: 'number',
      required: false,
      step: '0.1',
      placeholder: 'e.g. 5',
      phoneInfo: true,
    },
    {
      key: 'bandpass_nm',
      name: 'bandpassNm',
      type: 'number',
      required: false,
      step: '0.1',
      phoneInfo: true,
    },
  ],
};

/** Focal length over aperture, to one decimal as the catalog gives it (`null` without both). */
export function fRatio(apertureMm: number | undefined, focalMm: number | undefined): number | null {
  if (!apertureMm || !focalMm) return null;
  return Math.round((focalMm / apertureMm) * 10) / 10;
}

/** A form's starting values: each field's default, or empty. */
export function initialCustomGearValues(type: CustomGearType): Record<string, string> {
  return Object.fromEntries(CUSTOM_GEAR_FIELDS[type].map((f) => [f.key, f.defaultValue ?? '']));
}

/** The required fields left empty (a number field also when it is not a number). */
export function missingCustomGearFields(
  type: CustomGearType,
  values: Record<string, string>,
): string[] {
  return CUSTOM_GEAR_FIELDS[type]
    .filter((f) => {
      if (!f.required) return false;
      const v = (values[f.key] ?? '').trim();
      return !v || (f.type === 'number' && !Number.isFinite(parseFloat(v.replace(',', '.'))));
    })
    .map((f) => f.key);
}

/**
 * The record a filled form is saved as: the typed values (numbers parsed, empty
 * fields left out) plus the fields the catalog's entries carry and a custom item
 * cannot set (a custom telescope is never smart, a custom filter has no AstroBin name…).
 */
export function buildCustomGearData(
  type: CustomGearType,
  values: Record<string, string>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of CUSTOM_GEAR_FIELDS[type]) {
    const v = (values[field.key] ?? '').trim();
    if (!v) continue;
    data[field.key] = field.type === 'number' ? parseFloat(v.replace(',', '.')) : v;
  }
  if (type === 'telescope') {
    data.f_ratio = fRatio(data.aperture_mm as number, data.focal_length_mm as number);
    data.is_smart_telescope = 0;
    data.integrated_camera = 0;
    data.integrated_camera_id = null;
  } else if (type === 'camera') {
    data.sensor_generation = 'CMOS';
  } else if (type === 'filter') {
    // A custom filter has no AstroBin/SPCC entry, so filterLabel() falls back to
    // its model — which is what the user typed and expects to see on the badge.
    data.astrobin_name = null;
    data.spcc_name = null;
    data.series = null;
    data.type ??= 'broadband';
    data.subtype ??= '';
    data.mono_osc ??= 'both';
    data.color ??= DEFAULT_FILTER_COLOR;
  }
  data.status = 'active';
  return data;
}
