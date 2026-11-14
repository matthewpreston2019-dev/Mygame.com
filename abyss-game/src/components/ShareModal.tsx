import { Copy, Download, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { THEMES } from '../lib/cosmetics'
import { buildShareText, renderShareCard } from '../lib/share'
import { useProfile } from '../state/profile'
import type { GameSummary } from '../state/profileTypes'
import { Button, Modal } from './ui'

export function ShareModal({ summary, open, onClose, onToast }: { summary: GameSummary; open: boolean; onClose: () => void; onToast: (m: string) => void }) {
  const theme = useProfile((s) => s.theme)
  const name = useProfile((s) => s.name)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const text = buildShareText(summary)

  useEffect(() => {
    if (!open) return
    let revoked: string | null = null
    let cancelled = false
    const accent = THEMES.find((t) => t.id === theme)?.accent ?? '#22d3ee'
    void document.fonts?.ready.then(() =>
      renderShareCard(summary, accent, name).then((b) => {
        if (cancelled || !b) return
        setBlob(b)
        revoked = URL.createObjectURL(b)
        setUrl(revoked)
      }),
    )
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [open, summary, theme, name])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      onToast('Result copied to clipboard')
    } catch {
      onToast('Copy failed — select the text manually')
    }
  }

  const download = () => {
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = `abyss-${summary.mode}-${summary.score}.png`
    a.click()
    onToast('Result card saved')
  }

  const nativeShare = async () => {
    try {
      const file = blob ? new File([blob], 'abyss-result.png', { type: 'image/png' }) : null
      if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ text, files: [file] })
      else await navigator.share({ text })
    } catch {
      /* user cancelled */
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Share your dive">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
        {url ? <img src={url} alt="Result card" className="block aspect-[4/5] w-full" /> : <div className="shimmer aspect-[4/5] w-full" />}
      </div>
      <pre className="mt-4 whitespace-pre-wrap rounded-2xl bg-white/5 p-3 font-sans text-sm leading-relaxed text-ink/90">{text}</pre>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button icon={<Copy size={16} />} onClick={copy}>
          Copy text
        </Button>
        <Button icon={<Download size={16} />} onClick={download} disabled={!url}>
          Save image
        </Button>
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <Button variant="primary" className="col-span-2" icon={<Share2 size={16} />} onClick={nativeShare}>
            Share…
          </Button>
        )}
      </div>
    </Modal>
  )
}
