import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

const MEME = {
  id: '61579',
  name: 'One Does Not Simply',
  url: 'https://i.imgflip.com/1bij.jpg',
  width: 568,
  height: 335,
  box_count: 2,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('searchImgflipTemplates', () => {
  const originalKey = process.env.IMGFLIP_API_KEY
  let fetchSpy: MockInstance<typeof fetch> | undefined

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    fetchSpy?.mockRestore()
    if (originalKey === undefined) delete process.env.IMGFLIP_API_KEY
    else process.env.IMGFLIP_API_KEY = originalKey
  })

  it('reports a clear auth error when no key is configured', async () => {
    delete process.env.IMGFLIP_API_KEY
    const { searchImgflipTemplates, ImgflipAuthError } = await import('../../src/lib/imgflip')
    await expect(searchImgflipTemplates('cat')).rejects.toBeInstanceOf(ImgflipAuthError)
  })

  it('sends the bearer key and normalises the search results', async () => {
    process.env.IMGFLIP_API_KEY = ' test-key '
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ success: true, data: { memes: [MEME] } }))

    const { searchImgflipTemplates } = await import('../../src/lib/imgflip')
    const items = await searchImgflipTemplates('  one does not  ')

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      source: 'imgflip',
      sourceId: '61579',
      name: 'One Does Not Simply',
      imageUrl: 'https://i.imgflip.com/1bij.jpg',
    })

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.imgflip.com/search_memes?q=one%20does%20not')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key')
  })

  it('trims the query to the documented maximum', async () => {
    process.env.IMGFLIP_API_KEY = 'test-key'
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ success: true, data: { memes: [] } }))

    const { searchImgflipTemplates, IMGFLIP_MAX_QUERY } = await import('../../src/lib/imgflip')
    await searchImgflipTemplates('x'.repeat(500))

    const [url] = fetchSpy.mock.calls[0] as [string]
    expect(decodeURIComponent(url.split('q=')[1])).toHaveLength(IMGFLIP_MAX_QUERY)
  })

  it('treats a rejected key (401) as an auth error', async () => {
    process.env.IMGFLIP_API_KEY = 'wrong'
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}, 401))

    const { searchImgflipTemplates, ImgflipAuthError } = await import('../../src/lib/imgflip')
    await expect(searchImgflipTemplates('cat')).rejects.toBeInstanceOf(ImgflipAuthError)
  })

  it('treats an API-level rejection as an auth error', async () => {
    process.env.IMGFLIP_API_KEY = 'wrong'
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ success: false, error_message: 'Invalid API key' }),
    )

    const { searchImgflipTemplates, ImgflipAuthError } = await import('../../src/lib/imgflip')
    await expect(searchImgflipTemplates('cat')).rejects.toBeInstanceOf(ImgflipAuthError)
  })

  it('returns an empty list for an empty query without a request', async () => {
    process.env.IMGFLIP_API_KEY = 'test-key'
    fetchSpy = vi.spyOn(globalThis, 'fetch')

    const { searchImgflipTemplates } = await import('../../src/lib/imgflip')
    await expect(searchImgflipTemplates('   ')).resolves.toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
