import type { ChaosRule, GameMode } from './types'

export const MODE_INFO: Record<GameMode, { name: string; description: string; emoji: string }> = {
  normal: { name: 'Meme Battle', description: 'Different template for everyone', emoji: '🎲' },
  same: { name: 'Same Meme', description: 'One template, many punchlines', emoji: '🪞' },
  relaxed: { name: 'Relaxed', description: 'No points, no winner', emoji: '🌿' },
  chaos: { name: 'Chaos', description: 'A random rule each round', emoji: '🌀' },
}

export const RULE_INFO: Record<
  ChaosRule,
  { label: string; description: string; emoji: string }
> = {
  double: { label: 'Double points', description: 'Everything counts twice this round', emoji: '×2' },
  noDownvotes: { label: 'No downvotes', description: 'Only Fun and Meh are available', emoji: '🚫' },
  shortText: { label: 'Short text', description: 'Max 40 characters per line', emoji: '✂️' },
  fast: { label: 'Fast round', description: 'Half the usual time', emoji: '⚡' },
}
