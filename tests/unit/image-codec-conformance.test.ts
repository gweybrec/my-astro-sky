// @vitest-environment node
/** The `ImageCodec` conformance suite on the server's `sharp` codec (the phone's codec runs it on the device). */
import { it, expect } from 'vitest';
import sharp from 'sharp';
import { createSharpImageCodec } from '../../server/image-codec';
import { describeImageCodecConformance } from '../helpers/image-codec-conformance';

describeImageCodecConformance('server sharp codec', createSharpImageCodec, {
  keepsOriginalWithoutOrientation: false,
});

it('loading the server codec turns the libvips cache off, before any import', () => {
  const { memory, files, items } = sharp.cache();
  expect([memory.max, files.max, items.max]).toEqual([0, 0, 0]);
});
