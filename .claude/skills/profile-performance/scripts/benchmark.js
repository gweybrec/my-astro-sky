// Sky-map render benchmark — paste this whole function as the `function` argument to
// the Playwright browser_evaluate tool. It drives a deterministic interaction and
// returns frame-timing + canvas-allocation metrics so you can A/B a render change.
//
//   mode 'pan'  : hold + circular drag at constant zoom (atlas-reuse path)
//   mode 'zoom' : continuous wheel in then out (atlas-rebuild path)
//
// Canvas allocations are counted by wrapping document.createElement('canvas'); they
// expose offscreen-canvas churn that frame time alone hides (e.g. sprite-atlas thrash).
//
// Run BOTH modes before and after a change. Reload the page between stash/pop so HMR
// has served the right code. Example call shape:
//   browser_evaluate(function = "(" + <contents of this file> + ")('zoom')")
// or just paste the function body and invoke benchmark('pan').

(mode = 'pan') => {
  const canvas = document.querySelector('canvas');
  const rect = canvas.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  let allocs = 0;
  const origCreate = document.createElement.bind(document);
  document.createElement = (tag) => { if (tag === 'canvas') allocs++; return origCreate(tag); };

  const fire = (type, x, y, buttons = 1) => {
    const ev = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons });
    window.dispatchEvent(ev);
    canvas.dispatchEvent(ev);
  };
  const wheel = (dy) =>
    canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, clientX: cx, clientY: cy, deltaY: dy }));

  return new Promise((resolve) => {
    const frames = [];
    let last = performance.now();
    let i = 0;
    const N = 140;
    if (mode === 'pan') fire('mousedown', cx, cy);

    const tick = () => {
      const now = performance.now();
      if (i > 0) frames.push(now - last);
      last = now;

      if (mode === 'pan') {
        const a = i * 0.06;
        fire('mousemove', cx + Math.cos(a) * 100, cy + Math.sin(a) * 100);
      } else {
        wheel(i < N / 2 ? -100 : 100); // zoom in, then out
      }

      i++;
      if (i < N) {
        requestAnimationFrame(tick);
      } else {
        if (mode === 'pan') fire('mouseup', cx, cy);
        document.createElement = origCreate;
        const s = [...frames].sort((a, b) => a - b);
        resolve({
          mode,
          frames: frames.length,
          medianMs: +s[s.length >> 1].toFixed(2),
          avgMs: +(frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(2),
          p95Ms: +s[Math.floor(s.length * 0.95)].toFixed(2),
          canvasAllocs: allocs,
        });
      }
    };
    requestAnimationFrame(tick);
  });
}
