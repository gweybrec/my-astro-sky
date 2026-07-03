import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateThumbnail, createLazyObserver } from '../../src/lazy-image';

// The ?worker import has no Vite transform in Vitest, so ThumbnailWorker is
// undefined / not a constructor. The try/catch in getWorker() catches this and
// keeps _worker null, which is the same behaviour as an unsupported browser.

describe('generateThumbnail', () => {
  it('returns null when the Worker is unavailable (test environment)', async () => {
    const result = await generateThumbnail(new File([''], 'test.jpg'));
    expect(result).toBeNull();
  });

  it('returns null consistently across multiple calls', async () => {
    const a = await generateThumbnail(new File([''], 'a.jpg'), 120);
    const b = await generateThumbnail(new File([''], 'b.jpg'), 240);
    expect(a).toBeNull();
    expect(b).toBeNull();
  });
});

// ─── IntersectionObserver mock helpers ─────────────────────────────────────

type IOCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;

function mockIO() {
  let capturedCallback: IOCallback = () => {};
  let capturedOptions: IntersectionObserverInit | undefined;
  const observe = vi.fn();
  const unobserve = vi.fn();
  const disconnect = vi.fn();

  const Ctor = vi.fn().mockImplementation((cb: IOCallback, opts?: IntersectionObserverInit) => {
    capturedCallback = cb;
    capturedOptions = opts;
    return { observe, unobserve, disconnect };
  });

  vi.stubGlobal('IntersectionObserver', Ctor);

  return {
    Ctor,
    observe,
    unobserve,
    disconnect,
    fire: (entries: Partial<IntersectionObserverEntry>[]) => capturedCallback(entries),
    get options() {
      return capturedOptions;
    },
  };
}

describe('createLazyObserver', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates an IntersectionObserver with the given scroll root', () => {
    const io = mockIO();
    const root = document.createElement('div');
    createLazyObserver({ scrollRoot: root, onVisible: vi.fn() });

    expect(io.Ctor).toHaveBeenCalledOnce();
    expect(io.options?.root).toBe(root);
  });

  it('defaults rootMargin to "300px 0px"', () => {
    const io = mockIO();
    createLazyObserver({ scrollRoot: null, onVisible: vi.fn() });

    expect(io.options?.rootMargin).toBe('300px 0px');
  });

  it('uses the provided rootMargin', () => {
    const io = mockIO();
    createLazyObserver({ scrollRoot: null, rootMargin: '500px 0px', onVisible: vi.fn() });

    expect(io.options?.rootMargin).toBe('500px 0px');
  });

  it('uses threshold 0', () => {
    const io = mockIO();
    createLazyObserver({ scrollRoot: null, onVisible: vi.fn() });

    expect(io.options?.threshold).toBe(0);
  });

  it('calls onVisible when an entry is intersecting', () => {
    const io = mockIO();
    const onVisible = vi.fn();
    const el = document.createElement('div');

    createLazyObserver({ scrollRoot: null, onVisible });
    io.fire([{ isIntersecting: true, target: el }]);

    expect(onVisible).toHaveBeenCalledOnce();
    expect(onVisible).toHaveBeenCalledWith(el);
  });

  it('calls onHidden when an entry is not intersecting', () => {
    const io = mockIO();
    const onVisible = vi.fn();
    const onHidden = vi.fn();
    const el = document.createElement('div');

    createLazyObserver({ scrollRoot: null, onVisible, onHidden });
    io.fire([{ isIntersecting: false, target: el }]);

    expect(onHidden).toHaveBeenCalledOnce();
    expect(onHidden).toHaveBeenCalledWith(el);
    expect(onVisible).not.toHaveBeenCalled();
  });

  it('does not throw when onHidden is omitted and an entry leaves the viewport', () => {
    const io = mockIO();
    const el = document.createElement('div');

    createLazyObserver({ scrollRoot: null, onVisible: vi.fn() });

    expect(() => io.fire([{ isIntersecting: false, target: el }])).not.toThrow();
  });

  it('handles multiple entries per callback invocation', () => {
    const io = mockIO();
    const onVisible = vi.fn();
    const onHidden = vi.fn();

    const a = document.createElement('div');
    const b = document.createElement('div');
    const c = document.createElement('div');

    createLazyObserver({ scrollRoot: null, onVisible, onHidden });
    io.fire([
      { isIntersecting: true, target: a },
      { isIntersecting: false, target: b },
      { isIntersecting: true, target: c },
    ]);

    expect(onVisible).toHaveBeenCalledTimes(2);
    expect(onVisible).toHaveBeenCalledWith(a);
    expect(onVisible).toHaveBeenCalledWith(c);
    expect(onHidden).toHaveBeenCalledTimes(1);
    expect(onHidden).toHaveBeenCalledWith(b);
  });
});
