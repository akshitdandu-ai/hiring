/**
 * Generated artwork (no image files, nothing fetched): a night-map of the UK → Germany / France / Netherlands lanes.
 * `slice` makes it behave like object-fit: cover, centred.
 */
export function HeroArt({ className = '', decorative = false }: { className?: string; decorative?: boolean }) {
  const lines = Array.from({ length: 15 }, (_, i) => 60 + i * 60);
  const cols = Array.from({ length: 27 }, (_, i) => i * 60);
  return (
    <svg className={`cover ${className}`} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': 'Map of shipping lanes from the UK to Germany, France and the Netherlands' })} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="ha-teal" cx="22%" cy="78%" r="55%">
          <stop offset="0" stopColor="#2e6b72" stopOpacity="0.75" />
          <stop offset="1" stopColor="#0a0c0e" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ha-amber" cx="82%" cy="22%" r="48%">
          <stop offset="0" stopColor="#e8913c" stopOpacity="0.55" />
          <stop offset="1" stopColor="#0a0c0e" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ha-lane" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#6fb6bf" />
          <stop offset="1" stopColor="#e8913c" />
        </linearGradient>
      </defs>
      <rect width="1600" height="900" fill="#0a0c0e" />
      <rect width="1600" height="900" fill="url(#ha-teal)" />
      <rect width="1600" height="900" fill="url(#ha-amber)" />
      <g stroke="#ede7dc" strokeOpacity="0.07" strokeWidth="1">
        {lines.map((y) => (
          <line key={`h${y}`} x1="0" x2="1600" y1={y} y2={y} />
        ))}
        {cols.map((x) => (
          <line key={`v${x}`} y1="0" y2="900" x1={x} x2={x} />
        ))}
      </g>
      <g fill="none" stroke="#ede7dc" strokeOpacity="0.16">
        <circle cx="430" cy="660" r="90" />
        <circle cx="430" cy="660" r="190" />
        <circle cx="430" cy="660" r="310" />
        <circle cx="430" cy="660" r="450" />
      </g>
      <g fill="none" stroke="url(#ha-lane)" strokeWidth="2.5" strokeLinecap="round">
        <path d="M430 660 C 620 430, 900 360, 1130 330" strokeDasharray="2 10" />
        <path d="M430 660 C 640 600, 900 560, 1190 540" />
        <path d="M430 660 C 600 520, 760 330, 1010 215" strokeDasharray="14 10" />
      </g>
      <g fontFamily="ui-monospace, Menlo, Consolas, monospace" fontSize="15" fill="#ede7dc" letterSpacing="3">
        <circle cx="430" cy="660" r="9" fill="#e8913c" />
        <text x="452" y="690" opacity="0.7">UK</text>
        <circle cx="1130" cy="330" r="7" fill="#6fb6bf" />
        <text x="1148" y="326" opacity="0.7">DE</text>
        <circle cx="1190" cy="540" r="7" fill="#6fb6bf" />
        <text x="1208" y="546" opacity="0.7">FR</text>
        <circle cx="1010" cy="215" r="7" fill="#6fb6bf" />
        <text x="1028" y="211" opacity="0.7">NL</text>
      </g>
    </svg>
  );
}
