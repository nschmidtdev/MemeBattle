import type { CSSProperties } from 'react'

/**
 * Renders a monochrome icon from `public/res/icons/<name>.svg`.
 *
 * Icons live as real .svg files instead of inline JSX: the browser downloads
 * them once, they are cacheable and the code stays free of path data. The file
 * is used as a CSS mask, so `currentColor` and Tailwind text colours keep
 * working exactly like they did with inline SVGs.
 *
 * Add a new icon by dropping a 24×24 viewBox SVG into public/res/icons and
 * rendering `<Icon name="file-name" />` — never paste SVG markup into a
 * component.
 */
export default function Icon({
  name,
  className,
  label,
}: {
  name: string
  /** Sizing/colour/animation classes, e.g. `h-5 w-5 text-mint animate-spin`. */
  className?: string
  /** Accessible label; omit for purely decorative icons. */
  label?: string
}) {
  const url = `url('/res/icons/${name}.svg')`
  const style: CSSProperties = {
    backgroundColor: 'currentColor',
    maskImage: url,
    WebkitMaskImage: url,
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskPosition: 'center',
    WebkitMaskPosition: 'center',
    maskSize: 'contain',
    WebkitMaskSize: 'contain',
  }

  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`inline-block shrink-0 ${className ?? ''}`}
      style={style}
    />
  )
}
