import { useCallback, useRef } from 'react';
import { HeroArt } from './HeroArt';
import { clamp01, reveal, usePrefersReducedMotion, useScrollProgress } from './motion';

/**
 * Portal hero: a 250vh section with a pinned 100vh stage. Scrolling slides two panels apart to reveal the image
 * (which settles from 1.1 to 1.0), splits and enlarges the wordmark, and drifts two accent dots outward.
 * Motion is written straight to CSS variables once per frame, so scrolling never re-renders React.
 */
export function PortalHero({ onStart, onSample, onSkip }: { onStart: () => void; onSample: () => void; onSkip: () => void }) {
  const section = useRef<HTMLElement>(null);
  const reduced = usePrefersReducedMotion();

  const apply = useCallback(
    (p: number) => {
      const el = section.current;
      if (!el) return;
      const q = reduced ? 1 : reveal(clamp01(p / 0.8));
      const set = (k: string, v: string) => el.style.setProperty(k, v);
      set('--img-scale', String(1.1 - 0.1 * q));
      set('--panel-l', `${-q * 100}%`);
      set('--panel-r', `${q * 100}%`);
      const split = reduced ? 0 : q;
      set('--wm-l', `${-split * 36}vw`);
      set('--wm-r', `${split * 36}vw`);
      set('--wm-scale', String(1 + 0.15 * split));
      set('--wm-ls', `${-0.03 + 0.1 * split}em`);
      set('--wm-op', reduced ? '1' : String(clamp01(1 - (q - 0.72) / 0.25)));
      set('--dot-a', `${-q * 26}vw ${-q * 15}vh`);
      set('--dot-t', `${q * 28}vw ${q * 13}vh`);
      set('--dot-op', String(clamp01(q * 3)));
      set('--hint-op', String(clamp01(1 - q * 6)));
      set('--cta-op', String(clamp01((q - 0.82) / 0.15)));
      el.dataset.open = q > 0.8 ? 'true' : 'false';
    },
    [reduced],
  );
  useScrollProgress(section, apply, 'pin');

  return (
    <section ref={section} id="top" aria-label="Introduction" data-open="false" className="group relative" style={{ height: reduced ? '100vh' : '250vh' }}>
      <div className="sticky top-0 h-screen overflow-hidden bg-ground">
        <div id="hero-image" className="duotone absolute inset-0" style={{ transform: 'scale(var(--img-scale, 1.1))', willChange: 'transform' }}>
          <HeroArt className="h-full w-full" />
        </div>

        <div id="panel-left" className="absolute inset-y-0 left-0 w-[50.1%] border-r hairline bg-ground" style={{ transform: 'translate3d(var(--panel-l, 0%), 0, 0)', willChange: 'transform' }} aria-hidden="true">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(46,107,114,0.18),transparent_55%)]" />
        </div>
        <div id="panel-right" className="absolute inset-y-0 right-0 w-[50.1%] border-l hairline bg-ground" style={{ transform: 'translate3d(var(--panel-r, 0%), 0, 0)', willChange: 'transform' }} aria-hidden="true">
          <div className="absolute inset-0 bg-[linear-gradient(315deg,rgba(232,145,60,0.14),transparent_55%)]" />
        </div>

        <span className="absolute left-1/2 top-1/2 h-3 w-3 rounded-full bg-amber shadow-[0_0_24px_6px_rgba(232,145,60,0.55)]" style={{ transform: 'translate(-50%, -50%)', opacity: 'var(--dot-op, 0)', translate: 'var(--dot-a, 0 0)' }} aria-hidden="true" />
        <span className="absolute left-1/2 top-1/2 h-3 w-3 rounded-full bg-tealLight shadow-[0_0_24px_6px_rgba(111,182,191,0.5)]" style={{ transform: 'translate(-50%, -50%)', opacity: 'var(--dot-op, 0)', translate: 'var(--dot-t, 0 0)' }} aria-hidden="true" />

        <div className="absolute inset-0 flex flex-col items-center justify-center px-4">
          <p className="label mb-5 text-ink/70" style={{ opacity: 'var(--hint-op, 1)' }}>UK → Germany · France · Netherlands</p>
          <h1
            id="portal-wordmark"
            className="flex select-none items-baseline whitespace-nowrap font-display font-extrabold leading-none"
            style={{ fontSize: 'clamp(40px, 9vw, 150px)', transform: 'scale(var(--wm-scale, 1))', letterSpacing: 'var(--wm-ls, -0.03em)', opacity: 'var(--wm-op, 1)', fontWeight: 800 }}
          >
            <span aria-hidden="true" style={{ display: 'inline-block', transform: 'translate3d(var(--wm-l, 0vw), 0, 0)', willChange: 'transform' }}>PRE</span>
            <span className="sr-only">Pre-Flight</span>
            <span aria-hidden="true" style={{ display: 'inline-block', transform: 'translate3d(var(--wm-r, 0vw), 0, 0)', willChange: 'transform' }}>FLIGHT</span>
          </h1>
          <p className="mt-6 max-w-md text-center text-sm text-ink/70" style={{ opacity: 'var(--hint-op, 1)' }}>
            Book a shipment by chat. Catch the mistakes before the goods leave.
          </p>
          <p className="label mt-10 text-ink/60" style={{ opacity: 'var(--hint-op, 1)' }}>
            <span className="inline-block animate-pulse motion-reduce:animate-none">Scroll to open ↓</span>
          </p>
        </div>

        <div className="absolute inset-x-0 bottom-16 flex flex-wrap items-center justify-center gap-3 px-4 group-data-[open=false]:invisible" style={{ opacity: 'var(--cta-op, 0)' }}>
          <button type="button" onClick={onStart} className="rounded-full bg-amber px-6 py-3 text-sm font-semibold text-ground transition-transform duration-500 hover:-translate-y-0.5 reveal">
            Start a booking
          </button>
          <button type="button" onClick={onSample} className="rounded-full border border-ink/30 px-6 py-3 text-sm font-semibold text-ink transition-colors duration-500 hover:border-amber hover:text-amber">
            Try the sample data
          </button>
        </div>

        <button type="button" onClick={onSkip} className="label absolute bottom-6 right-5 z-10 rounded-full border border-ink/25 bg-ground/60 px-4 py-2 text-ink/80 backdrop-blur-sm transition-colors duration-300 hover:border-amber hover:text-amber">
          Skip intro →
        </button>
      </div>
    </section>
  );
}
