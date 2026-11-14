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
  primary:
    'bg-gradient-to-br from-accent to-accent-2 text-slate-950 font-semibold shadow-[0_10px_40px_-10px_rgb(var(--glow)/0.8)] hover:shadow-[0_14px_50px_-8px_rgb(var(--glow)/0.95)] hover:brightness-110',
  secondary: 'glass text-ink hover:bg-white/10 hover:border-white/20',
  ghost: 'text-mist hover:text-ink hover:bg-white/5',
  danger: 'bg-rose-500/90 text-white hover:bg-rose-500 shadow-[0_10px_30px_-10px_rgba(244,63,94,0.7)]',
}

const SIZES = {
  sm: 'h-9 px-3.5 text-sm gap-1.5 rounded-xl',
  md: 'h-11 px-5 text-[15px] gap-2 rounded-2xl',
  lg: 'h-14 px-7 text-base gap-2.5 rounded-2xl',
}

export function Button({ variant = 'secondary', size = 'md', icon, className = '', children, onClick, silent, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      onClick={(e) => {
        if (!silent) play('click')
        onClick?.(e)
      }}
      className={`relative inline-flex select-none items-center justify-center whitespace-nowrap transition-all duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {icon}
      {children}
    </button>
  )
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`glass rounded-3xl ${className}`}>{children}</div>
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
            className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-ink transition hover:bg-white/10"
          >
            <ChevronLeft size={20} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold italic tracking-tight sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-0.5 truncate text-sm text-mist">{subtitle}</p>}
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
          <div className="absolute inset-0 bg-[#01040b]/75 backdrop-blur-sm" onClick={dismissable ? onClose : undefined} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="glass relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-3xl bg-[#071426]/90 p-6"
            initial={{ y: 40, scale: 0.97, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 30, scale: 0.98, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="font-display text-xl font-semibold italic">{title}</h2>
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
        <span className="block font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-sm text-mist">{description}</span>}
      </span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-white/15'}`}>
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 34 }}
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow ${checked ? 'right-1' : 'left-1'}`}
        />
      </span>
    </button>
  )
}

export function RarityBadge({ tier, size = 'md' }: { tier: RarityTier; size?: 'sm' | 'md' | 'lg' }) {
  const meta = TIER_META[tier]
  const cls = size === 'lg' ? 'px-4 py-1.5 text-sm' : size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold uppercase tracking-[0.14em] ${cls}`}
      style={{ color: meta.color, background: `${meta.color}1f`, boxShadow: `inset 0 0 0 1px ${meta.color}55` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color, boxShadow: `0 0 8px ${meta.color}` }} />
      {meta.label}
    </span>
  )
}

export function StatTile({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: string; accent?: boolean }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-mist">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${accent ? 'text-accent glow-text' : ''}`}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-mist">{hint}</div>}
    </div>
  )
}

export function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-white/10 ${className}`}>
      <motion.div
        className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2"
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
    <div className="glass inline-flex rounded-2xl p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => {
            play('click')
            onChange(o.value)
          }}
          className={`relative rounded-xl px-3.5 py-2 text-sm font-medium transition-colors sm:px-4 ${value === o.value ? 'text-slate-950' : 'text-mist hover:text-ink'}`}
        >
          {value === o.value && (
            <motion.span layoutId={`seg-${options.map((x) => x.value).join('')}`} className="absolute inset-0 rounded-xl bg-accent" transition={{ type: 'spring', stiffness: 450, damping: 36 }} />
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
          className="glass fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-2xl bg-[#071426]/90 px-5 py-3 text-sm font-medium"
          role="status"
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
