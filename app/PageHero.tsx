/** Page title band. Sits directly on the full-page gooey background (see layout.tsx). */
export default function PageHero({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="hero">
      <div className="hero-inner">
        <div>
          <h1>{title}</h1>
          {children && <div className="hero-sub">{children}</div>}
        </div>
        {action}
      </div>
    </div>
  );
}
