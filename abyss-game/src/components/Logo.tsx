export function Logo({ size = 'lg' }: { size?: 'sm' | 'lg' }) {
  const big = size === 'lg'
  return (
    <div className="flex flex-col items-center select-none">
      <div className={`relative ${big ? 'mb-3 h-16 w-16' : 'mb-1 h-8 w-8'}`}>
        <div className="absolute inset-0 rounded-full bg-accent/30 blur-xl animate-pulse-glow" />
        <svg viewBox="0 0 64 64" className="relative h-full w-full">
          <defs>
            <radialGradient id="lg-orb" cx="50%" cy="35%" r="65%">
              <stop offset="0" stopColor="var(--accent)" />
              <stop offset="1" stopColor="#020814" />
            </radialGradient>
          </defs>
          <circle cx="32" cy="32" r="26" fill="url(#lg-orb)" stroke="var(--accent)" strokeOpacity="0.6" />
          <path d="M18 38c5-11 23-11 28 0" stroke="#e6f7ff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <path d="M32 6v10" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
          <circle cx="32" cy="22" r="3.4" fill="#ffffff" />
        </svg>
      </div>
      <h1
        className={`font-sans font-light tracking-[0.42em] text-gradient ${big ? 'text-5xl sm:text-7xl' : 'text-lg'}`}
        style={{ marginRight: '-0.42em' }}
      >
        ABYSS
      </h1>
    </div>
  )
}
