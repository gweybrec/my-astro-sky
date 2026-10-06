import {
  FrameController as CoreFrameController,
  type FrameHost,
} from '@myastrosky/core/frame-controller';

export * from '@myastrosky/core/frame-controller';

/** The core controller on the browser's clock and animation-frame scheduler. */
export class FrameController extends CoreFrameController {
  constructor(host: FrameHost) {
    super(host, {
      now: () => performance.now(),
      requestFrame: (cb) => requestAnimationFrame(cb),
      cancelFrame: (h) => cancelAnimationFrame(h),
    });
  }
}
