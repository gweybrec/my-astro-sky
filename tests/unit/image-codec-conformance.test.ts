// @vitest-environment node
/** The `ImageCodec` conformance suite on the server's `sharp` codec (the phone's codec runs it on the device). */
import { createSharpImageCodec } from '../../server/image-codec';
import { describeImageCodecConformance } from '../helpers/image-codec-conformance';

describeImageCodecConformance('server sharp codec', createSharpImageCodec, {
  keepsOriginalWithoutOrientation: false,
});
