import { BarChart3, Bot, CalendarCheck, Code2, GraduationCap, Lightbulb, PenLine, Search, Sparkles, Wand2, type LucideIcon } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = { Sparkles, Code2, Search, PenLine, GraduationCap, Lightbulb, BarChart3, CalendarCheck, Wand2, Bot };

export function ModeIcon({ name, className }: { name: string; className?: string }) {
  const I = ICONS[name] ?? Sparkles;
  return <I className={className} />;
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="lg-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b7bff" />
          <stop offset=".55" stopColor="#5b8cff" />
          <stop offset="1" stopColor="#2fd4c4" />
        </linearGradient>
      </defs>
      <path d="M32 6c2.8 12.4 7.4 17.6 20 20.6-12.6 3.1-17.2 8.2-20 20.6-2.8-12.4-7.4-17.5-20-20.6C24.6 23.6 29.2 18.4 32 6z" fill="url(#lg-logo)" />
      <circle cx="50" cy="49" r="6" fill="url(#lg-logo)" opacity=".85" />
    </svg>
  );
}
