'use client';

import { useEffect, useId, useRef } from 'react';

/**
 * Animated "gooey" gradient backdrop: five CSS-animated blobs merged by an SVG goo filter, plus one
 * blob that eases toward the pointer. Used behind page heroes only - not behind data, so it never
 * competes with the scores. Colours come from the --goo-* tokens in globals.css.
 */
export default function GooeyGradientBackground({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const blobRef = useRef<HTMLDivElement>(null);
  const filterId = `goo-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    const wrap = wrapRef.current;
    const blob = blobRef.current;
    if (!wrap || !blob || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Start centred; coordinates are relative to the hero, not the window.
    let curX = wrap.clientWidth / 2;
    let curY = wrap.clientHeight / 2;
    let tgX = curX;
    let tgY = curY;
    let frame = 0;

    const onMove = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect();
      tgX = e.clientX - r.left;
      tgY = e.clientY - r.top;
    };
    const tick = () => {
      curX += (tgX - curX) / 20;
      curY += (tgY - curY) / 20;
      blob.style.transform = `translate(${Math.round(curX)}px, ${Math.round(curY)}px)`;
      frame = requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    frame = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={wrapRef} className={`goo ${className}`}>
      <div className="goo-bg" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id={filterId}>
              <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
              <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8" result="goo" />
              <feBlend in="SourceGraphic" in2="goo" />
            </filter>
          </defs>
        </svg>
        <div className="goo-blobs" style={{ filter: `url(#${filterId}) blur(40px)` }}>
          <div className="goo-b g1" />
          <div className="goo-b g2" />
          <div className="goo-b g3" />
          <div className="goo-b g4" />
          <div className="goo-b g5" />
          <div ref={blobRef} className="goo-b goo-follow" />
        </div>
      </div>
      <div className="goo-content">{children}</div>
    </div>
  );
}
