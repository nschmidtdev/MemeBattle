'use client'

/**
 * Blocking +18 gate for lobbies with adult template packs. It is intentionally
 * a plain dialog without a close button: the only ways out are "yes" (stay) and
 * "no" (leave the lobby).
 */
export default function AdultGateModal({
  open,
  onAnswer,
}: {
  open: boolean
  onAnswer: (accepted: boolean) => void
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="adult-gate-title"
        aria-describedby="adult-gate-desc"
        className="w-full max-w-md rounded-2xl border border-rose/50 bg-card p-5 shadow-2xl sm:p-6"
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-rose/60 bg-rose/15 text-sm font-extrabold text-rose">
            +18
          </span>
          <h2 id="adult-gate-title" className="font-display text-2xl uppercase tracking-wide">
            Adult content
          </h2>
        </div>
        <p id="adult-gate-desc" className="text-sm leading-relaxed text-dim">
          This lobby uses template packs marked <strong className="text-rose">18+</strong>. Confirm
          that you are at least 18 years old to stay. If you decline, you will be removed from the
          lobby.
        </p>
        <p className="mt-2 text-xs text-dim">You only need to confirm once for this lobby.</p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            className="min-h-11 flex-1 rounded-xl bg-gradient-to-r from-punch to-punch2 px-4 py-2.5 font-bold text-night shadow-lg transition hover:brightness-110"
            onClick={() => onAnswer(true)}
          >
            Yes, I&apos;m 18 or older
          </button>
          <button
            className="min-h-11 flex-1 rounded-xl border border-line px-4 py-2.5 font-semibold text-dim transition hover:border-rose/60 hover:text-rose"
            onClick={() => onAnswer(false)}
          >
            No, leave lobby
          </button>
        </div>
      </div>
    </div>
  )
}
