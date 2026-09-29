import GooeyGradientBackground from './GooeyGradientBackground';

/** Page title band with the gooey gradient behind it. */
export default function PageHero({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <GooeyGradientBackground className="hero">
      <div className="hero-inner">
        <div>
          <h1>{title}</h1>
          {children && <div className="hero-sub">{children}</div>}
        </div>
        {action}
      </div>
    </GooeyGradientBackground>
  );
}
