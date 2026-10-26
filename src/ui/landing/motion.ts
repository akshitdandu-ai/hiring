import { useEffect, useState } from 'react';

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of linear progress 0..1. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 24; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-5) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

/** The reveal curve used across the page. */
export const reveal = cubicBezier(0.16, 1, 0.3, 1);

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/**
 * Calls `apply(progress)` on scroll and resize (once per frame). `mode` 'pin' is how far through a tall pinned
 * section we are; 'pass' is how far the section has travelled across the viewport.
 */
export function useScrollProgress(el: React.RefObject<HTMLElement | null>, apply: (p: number) => void, mode: 'pin' | 'pass', enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const run = () => {
      frame = 0;
      const node = el.current;
      if (!node) return;
      const r = node.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const p = mode === 'pin' ? -r.top / Math.max(1, r.height - vh) : (vh - r.top) / (r.height + vh);
      apply(clamp01(p));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    run();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [el, apply, mode, enabled]);
}
