'use client'

import { GAME_MODES, type GameMode } from '@/lib/types'
import { MODE_INFO } from '@/lib/modes'

/** Shared mode selector for the start page and the lobby settings. */
export default function GameModePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: GameMode
  onChange: (mode: GameMode) => void
  disabled?: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Game mode"
      className="grid grid-cols-2 gap-2 xl:grid-cols-4"
    >
      {GAME_MODES.map((mode) => {
        const info = MODE_INFO[mode]
        const active = value === mode
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={info.description}
            className={`rounded-xl border p-2.5 text-left transition disabled:cursor-default disabled:opacity-50 ${
              active
                ? 'border-punch bg-punch/15 ring-1 ring-punch/50'
                : 'border-line bg-night2 hover:border-dim'
            }`}
            onClick={() => onChange(mode)}
          >
            <span className="block text-sm font-bold">
              {info.emoji} {info.name}
            </span>
            <span className="mt-0.5 block text-[10px] leading-snug text-dim">{info.description}</span>
          </button>
        )
      })}
    </div>
  )
}
