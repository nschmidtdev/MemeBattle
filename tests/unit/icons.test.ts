import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const iconDir = join(root, 'public', 'res', 'icons')

describe('UI icons', () => {
  it('ships every icon as a standalone 24×24 SVG file', () => {
    const files = readdirSync(iconDir).filter((file) => file.endsWith('.svg'))

    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const svg = readFileSync(join(iconDir, file), 'utf8')
      expect(svg, file).toContain('<svg')
      expect(svg, file).toContain('viewBox="0 0 24 24"')
    }
  })

  it('keeps inline <svg> markup out of React components', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
        } else if (entry.name.endsWith('.tsx') && readFileSync(full, 'utf8').includes('<svg')) {
          offenders.push(full)
        }
      }
    }
    walk(join(root, 'src'))

    expect(offenders).toEqual([])
  })
})
