import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, X } from 'lucide-react'
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { TIER_META } from '../../engine/scoring'
import type { RarityTier } from '../../engine/types'
import { play } from '../../lib/audio'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
  silent?: boolean
}

const VARIANTS: Record<Variant, string> = {
  primary: 'px-btn px-btn-dive font-display',
  secondary: 'px-btn',
  ghost: 'px-btn-ghost',
  danger: 'px-btn px-btn-danger font-display',
}

const SIZES = {
  sm: 'h-9 px-3 text-lg gap-1.5',
  md: 'h-11 px-4 text-xl gap-2',
  lg: 'h-14 px-6 text-2xl gap-2.5',
}
const DISPLAY_SIZES = { sm: 'text-[9px]', md: 'text-[11px]', lg: 'text-[13px]' }

export function Button({ variant = 'secondary', size = 'md', icon, className = '', children, onClick, silent, ...rest }: ButtonProps) {
  const display = variant === 'primary' || variant === 'danger'
  return (
    <button
      {...rest}
      onClick={(e) => {
        if (!silent) play('click')
        onClick?.(e)
      }}
      className={`relative inline-flex select-none items-center justify-center whitespace-nowrap uppercase disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant]} ${SIZES[size]} ${display ? DISPLAY_SIZES[size] : ''} ${className}`}
    >
      {icon}
      {children}
    </button>
  )
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-box ${className}`}>{children}</div>
}

export function ScreenShell({
  title,
  subtitle,
  onBack,
  actions,
  children,
  wide = false,
}: {
  title: string
  subtitle?: string
  onBack?: () => void
  actions?: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className={`mx-auto w-full ${wide ? 'max-w-5xl' : 'max-w-3xl'} px-4 pb-16 pt-5 sm:px-6 sm:pt-8`}>
      <header className="mb-6 flex items-center gap-3 sm:mb-8">
        {onBack && (
          <button
            onClick={() => {
              play('click')
              onBack()
            }}
            aria-label="Back"
            className="px-btn flex h-11 w-11 shrink-0 items-center justify-center text-ink"
          >
            <ChevronLeft size={20} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="font-display px-shadow text-base uppercase text-accent sm:text-xl">{title}</h1>
          {subtitle && <p className="mt-1 truncate text-lg text-mist">{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </div>
  )
}

export function Modal({ open, onClose, title, children, dismissable = true }: { open: boolean; onClose: () => void; title: string; children: ReactNode; dismissable?: boolean }) {
  useEffect(() => {
    if (!open || !dismissable) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, dismissable])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-[#01040b]/80" onClick={dismissable ? onClose : undefined} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="px-box px-box-hi relative max-h-[88vh] w-full max-w-md overflow-y-auto !bg-[#071226] p-6"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ duration: 0.18, ease: (t: number) => Math.round(t * 4) / 4 }}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="font-display text-xs uppercase leading-relaxed text-accent sm:text-sm">{title}</h2>
              {dismissable && (
                <button onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 rounded-xl p-2 text-mist hover:bg-white/5 hover:text-ink">
                  <X size={18} />
                </button>
              )}
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => {
        play('click')
        onChange(!checked)
      }}
      className="flex w-full items-center justify-between gap-4 rounded-2xl px-1 py-3 text-left"
    >
      <span>
        <span className="block text-xl">{label}</span>
        {description && <span className="block text-base text-mist">{description}</span>}
      </span>
      <span className={`px-input relative flex h-7 w-14 shrink-0 items-center font-display text-[8px] ${checked ? '!bg-accent/25' : ''}`}>
        <span className={`absolute top-1 h-5 w-5 ${checked ? 'right-1 bg-accent' : 'left-1 bg-mist/50'}`} />
        <span className={`w-full px-1.5 ${checked ? 'text-left text-accent' : 'text-right text-mist'}`}>{checked ? 'ON' : 'OFF'}</span>
      </span>
    </button>
  )
}

export function RarityBadge({ tier, size = 'md' }: { tier: RarityTier; size?: 'sm' | 'md' | 'lg' }) {
  const meta = TIER_META[tier]
  const cls = size === 'lg' ? 'px-3 py-1.5 text-[11px]' : size === 'sm' ? 'px-1.5 py-0.5 text-[7px]' : 'px-2 py-1 text-[9px]'
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-display uppercase ${cls}`}
      style={{ color: meta.color, background: `${meta.color}22`, boxShadow: `inset 0 0 0 2px ${meta.color}` }}
    >
      <span className="h-1.5 w-1.5" style={{ background: meta.color }} />
      {meta.label}
    </span>
  )
}

export function StatTile({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: string; accent?: boolean }) {
  return (
    <div className="px-box p-4">
      <div className="text-base uppercase text-mist">{label}</div>
      <div className={`mt-1 font-display text-sm tabular-nums sm:text-base ${accent ? 'text-accent' : ''}`}>{value}</div>
      {hint && <div className="mt-1 truncate text-base text-mist">{hint}</div>}
    </div>
  )
}

export function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`px-input h-3 overflow-hidden ${className}`}>
      <motion.div
        className="h-full bg-accent"
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  )
}

/** Animated number count-up. */
export function CountUp({ value, duration = 1.2, className = '' }: { value: number; duration?: number; className?: string }) {
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    const start = performance.now()
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / (duration * 1000))
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(from + (value - from) * eased))
      if (t < 1) raf = requestAnimationFrame(step)
      else fromRef.current = value
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  return <span className={`tabular-nums ${className}`}>{display.toLocaleString()}</span>
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="px-box inline-flex gap-1 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => {
            play('click')
            onChange(o.value)
          }}
          className={`relative px-3 py-1.5 text-lg uppercase sm:px-4 ${value === o.value ? 'text-slate-950' : 'text-mist hover:text-ink'}`}
        >
          {value === o.value && (
            <motion.span layoutId={`seg-${options.map((x) => x.value).join('')}`} className="absolute inset-0 bg-accent" transition={{ duration: 0.12 }} />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return
    const t = setTimeout(onDone, 2400)
    return () => clearTimeout(t)
  }, [message, onDone])
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 20, opacity: 0 }}
          className="px-box px-box-hi fixed bottom-6 left-1/2 z-[60] w-max max-w-[90vw] -translate-x-1/2 !bg-[#071226] px-5 py-3 text-xl"
          role="status"
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
