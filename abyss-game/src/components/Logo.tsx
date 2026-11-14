export function Logo({ size = 'lg' }: { size?: 'sm' | 'lg' }) {
  const big = size === 'lg'
  return (
    <div className="flex select-none flex-col items-center">
      <h1
        className={`font-display text-accent ${big ? 'text-4xl sm:text-6xl' : 'text-base'}`}
        style={{ textShadow: big ? '4px 4px 0 #0b5f68, 8px 8px 0 #040a18' : '2px 2px 0 #0b5f68' }}
      >
        ABYSS
      </h1>
      {big && <div className="font-display mt-3 text-[9px] text-[#ff8fab] sm:text-[11px]">DEEP · TRIVIA · DIVE</div>}
    </div>
  )
}
