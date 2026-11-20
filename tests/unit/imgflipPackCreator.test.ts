import { describe, expect, it } from 'vitest'
import {
  imageExtensionForContentType,
  isAllowedImageSize,
  packNameKey,
} from '../../src/app/admin/ImgflipPackCreator'

describe('packNameKey', () => {
  it('ignores case and repeated whitespace for the collision check', () => {
    expect(packNameKey('  Imgflip   Top 100 ')).toBe('imgflip top 100')
  })
})

describe('imageExtensionForContentType', () => {
  it('maps the formats accepted by the upload endpoint', () => {
    expect(imageExtensionForContentType('image/png')).toBe('.png')
    expect(imageExtensionForContentType('image/jpeg')).toBe('.jpg')
    expect(imageExtensionForContentType('IMAGE/JPG')).toBe('.jpg')
    expect(imageExtensionForContentType('image/gif')).toBe('.gif')
    expect(imageExtensionForContentType('image/webp')).toBe('.webp')
  })

  it('handles parameters, whitespace and unsupported types', () => {
    expect(imageExtensionForContentType('image/jpeg; charset=binary')).toBe('.jpg')
    expect(imageExtensionForContentType(' image/png ; q=1 ')).toBe('.png')
    expect(imageExtensionForContentType('text/html')).toBeNull()
    expect(imageExtensionForContentType('image/svg+xml')).toBeNull()
    expect(imageExtensionForContentType('')).toBeNull()
    expect(imageExtensionForContentType(null)).toBeNull()
  })
})

describe('isAllowedImageSize', () => {
  it('accepts 1 KB to 10 MB inclusive', () => {
    expect(isAllowedImageSize(1024)).toBe(true)
    expect(isAllowedImageSize(10 * 1024 * 1024)).toBe(true)
    expect(isAllowedImageSize(1023)).toBe(false)
    expect(isAllowedImageSize(10 * 1024 * 1024 + 1)).toBe(false)
    expect(isAllowedImageSize(Number.NaN)).toBe(false)
  })
})
