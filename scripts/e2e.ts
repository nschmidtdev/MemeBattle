/**
 * E2E smoke test: full 2-player game over sockets, creator-reconnect navigation race, admin API.
 * Run against a live server:  npx tsx scripts/e2e.ts
 */
import { io, type Socket } from 'socket.io-client'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@localhost'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? ''

let passed = 0
let failed = 0
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ''}`)
  }
}

function connect(): Socket {
  const s = io(BASE, { transports: ['websocket'], reconnection: false, timeout: 8000 })
  return s
}

function waitEvent<T = any>(s: Socket, event: string, timeoutMs = 20000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs)
    s.once(event, (data: T) => {
      clearTimeout(t)
      resolve(data)
    })
  })
}

/** Poll until cond becomes true or timeout. */
async function until(cond: () => boolean, timeoutMs = 20000, label = 'condition') {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

function latest<T>(events: T[]): T | undefined {
  return events[events.length - 1]
}

async function main() {
  console.log(`E2E against ${BASE}\n`)

  // ------------------------------------------------------------- pages
  console.log('Pages:')
  const home = await fetch(`${BASE}/`)
  const homeHtml = await home.text()
  ok('GET / returns 200', home.status === 200, home.status)
  ok('GET / renders start page', /Meme/i.test(homeHtml))
  const login = await fetch(`${BASE}/admin/login`)
  ok('GET /admin/login returns 200', login.status === 200, login.status)
  const img = await fetch(`${BASE}/api/images/` + encodeURIComponent('public:seed/drake.svg'))
  ok('seed image served', img.status === 200 && (img.headers.get('content-type') ?? '').includes('svg'), img.status)

  // ------------------------------------------------------------- game
  console.log('\nGame (2 players):')
  const A = connect()
  const B = connect()
  await Promise.all([waitEvent(A, 'connect'), waitEvent(B, 'connect')])

  const aUpdates: any[] = []
  A.on('lobby:update', (d) => aUpdates.push(d))
  const bUpdates: any[] = []
  B.on('lobby:update', (d) => bUpdates.push(d))

  const aJoined = waitEvent(A, 'lobby:joined')
  A.emit('lobby:join', { username: 'Alice', create: true, isPublic: false, lobbyName: 'E2E Lobby' })
  const jA: { code: string; playerId: string } = await aJoined
  ok('creator gets lobby:joined with code', /^[A-Z0-9]{5}$/.test(jA.code), jA)
  ok('creator gets server-assigned playerId', typeof jA.playerId === 'string' && jA.playerId.length > 8)

  const bJoined = waitEvent(B, 'lobby:joined')
  B.emit('lobby:join', { username: 'Bob', code: jA.code, playerId: 'not-the-real-id' })
  const jB = await bJoined
  ok('joiner gets lobby:joined', jB.code === jA.code, jB)

  await until(() => (latest(aUpdates)?.players?.length ?? 0) >= 2, 10000, '2 players in lobby')
  ok('both players listed', latest(aUpdates)?.players?.length === 2, latest(aUpdates)?.players)
  ok('creator is host', latest(aUpdates)?.players?.find((p: any) => p.id === jA.playerId)?.isHost === true)

  // wrong code must fail
  const C = connect()
  await waitEvent(C, 'connect')
  const cErr = waitEvent(C, 'client:error', 5000).catch(() => null)
  C.emit('lobby:join', { username: 'Carl', code: 'ZZZZZ' })
  ok('unknown code rejected', (await cErr)?.message?.includes('not found') === true, await cErr)
  C.disconnect()

  // settings + start (needs at least one pack)
  const pubPacks = await fetch(`${BASE}/api/packs/public`).then((r) => r.json())
  ok('public packs list has a pack', pubPacks.packs?.length > 0, pubPacks)
  const packId: string = pubPacks.packs[0].id

  // Register all post-start waiters BEFORE emitting lobby:start so the
  // (synchronous) phase:caption + caption:template burst is never missed.
  const aCaption = waitEvent(A, 'phase:caption')
  const aTpl = waitEvent(A, 'caption:template')
  const bTpl = waitEvent(B, 'caption:template')
  A.emit('lobby:settings', { rounds: 1, captionTime: 45, voteTime: 3, packIds: [packId] })
  await until(() => latest(aUpdates)?.settings?.rounds === 1 && latest(aUpdates)?.settings?.packIds?.length === 1, 5000, 'settings applied')
  ok('settings updated', latest(aUpdates)?.settings?.voteTime === 3, latest(aUpdates)?.settings)
  A.emit('lobby:start')

  const capA = await aCaption
  ok('phase:caption broadcast', capA.round === 1 && capA.totalRounds === 1, capA)
  await until(() => latest(aUpdates)?.phase === 'caption', 5000, 'lobby:update with caption phase')
  ok('lobby:update carries caption phase', latest(aUpdates)?.phase === 'caption', latest(aUpdates)?.phase)
  const [tplA, tplB] = await Promise.all([aTpl, bTpl])
  ok('both got a template', !!tplA.template?.imageKey && !!tplB.template?.imageKey, [tplA.template?.name, tplB.template?.name])

  // duplicate submit must be rejected
  A.emit('caption:submit', { texts: { x: 'first' }, lines: [] })
  const dupErr = waitEvent(A, 'client:error', 5000).catch(() => null)
  A.emit('caption:submit', { texts: { y: 'second' }, lines: [] })
  ok('duplicate caption rejected', (await dupErr)?.message?.includes('already') === true, await dupErr)
  B.emit('caption:submit', {
    texts: {},
    lines: [{
      id: 'l1', text: 'bob says hi', x: 0.5, y: 0.9, w: 0.8, fontSize: 0.07,
      color: '#ffffff', stroke: '#000000', font: 'Impact', align: 'center', rotation: 0,
    }],
  })

  // voting
  const [pvA] = await Promise.all([waitEvent(A, 'phase:voting'), waitEvent(B, 'phase:voting')])
  ok('voting phase: 2 memes', pvA.memes?.length === 2 && pvA.current === 0, { memes: pvA.memes?.length, current: pvA.current })
  const bMeme = pvA.memes?.find((m: any) => m.playerId === jB.playerId)
  ok('freeform lines carried into voting', bMeme?.submission?.lines?.length === 1, bMeme?.submission)

  // Register early: round:results fires when the last meme timer ends, while we're
  // still processing votes here.
  const resP = waitEvent(A, 'round:results', 20000)

  const votesCast: Record<string, boolean> = { a: false, b: false }
  const ownOfA = pvA.memes?.findIndex((m: any) => m.playerId === jA.playerId)
  const ownOfB = pvA.memes?.findIndex((m: any) => m.playerId === jB.playerId)

  // current meme is 0; whoever does NOT own it votes now
  const current = pvA.current
  if (current === ownOfA) {
    B.emit('vote:cast', { index: current, value: 'up' })
    votesCast.b = true
  } else {
    A.emit('vote:cast', { index: current, value: 'up' })
    votesCast.a = true
  }

  // wrong-index vote must fail
  const wrongIdx = current === 0 ? 1 : 0
  const wErr = waitEvent(A, 'client:error', 5000).catch(() => null)
  A.emit('vote:cast', { index: wrongIdx, value: 'up' })
  ok('vote on non-current meme rejected', (await wErr)?.message?.includes('not up for voting') === true, await wErr)

  // wait for meme 1 to be shown, then the other player votes
  for (;;) {
    const p: any = await waitEvent(A, 'voting:progress', 15000)
    if (p.index !== 1) continue
    if (1 === ownOfA) {
      B.emit('vote:cast', { index: 1, value: 'down' })
      votesCast.b = true
    } else {
      A.emit('vote:cast', { index: 1, value: 'down' })
      votesCast.a = true
    }
    break
  }
  ok('both players voted', votesCast.a && votesCast.b, votesCast)

  // own-meme vote must fail (when that meme is current)
  const ownErr = waitEvent(B, 'client:error', 5000).catch(() => null)
  B.emit('vote:cast', { index: 1, value: 'meh' })
  const ownCheck = await ownErr
  ok('own-meme vote rejected', ownCheck === null || ownCheck.message?.includes('own meme') === true, ownCheck)

  const resA = await resP
  ok('round:results broadcast', resA.round === 1 && resA.memes?.length === 2, resA)
  ok('round totals present', resA.totals?.[jA.playerId] !== undefined && resA.totals?.[jB.playerId] !== undefined, resA.totals)

  const over = await waitEvent(A, 'game:over', 15000)
  ok('game:over with ranking', over.ranking?.length === 2 && over.totalRounds === 1, { ranking: over.ranking?.length })
  ok('game:over carries meme gallery', over.memes?.length === 2 && over.memes?.every((m: any) => m.template?.imageKey && m.submission), { memes: over.memes?.length })
  const top = over.ranking?.[0]
  const bottom = over.ranking?.[1]
  ok('ranking ordered by total', top.total >= bottom.total, over.ranking)

  // play again
  const again = waitEvent(A, 'lobby:update', 10000)
  A.emit('game:play-again')
  const after = await again
  ok('play-again resets to lobby', after.phase === 'lobby', after.phase)

  // kick: the server must check host rights, not trust the hidden UI button
  const bKickErr = waitEvent(B, 'client:error', 5000).catch(() => null)
  B.emit('lobby:kick', { playerId: jA.playerId }) // B is not the host
  ok('kick by non-host rejected', (await bKickErr)?.message?.includes('host') === true, await bKickErr)

  const bKicked = waitEvent(B, 'player:kick', 5000)
  A.emit('lobby:kick', { playerId: jB.playerId }) // A (host) kicks B
  const kEvent = await bKicked
  ok('host kick broadcasts player:kick', kEvent?.playerId === jB.playerId, kEvent)
  await until(() => (latest(aUpdates)?.players ?? []).every((p: any) => p.id !== jB.playerId), 5000, 'kicked player removed')
  ok('kicked player removed from lobby', (latest(aUpdates)?.players ?? []).every((p: any) => p.id !== jB.playerId), latest(aUpdates)?.players?.map((p: any) => p.username))

  A.disconnect()
  B.disconnect()

  // ------------------------------------------------------------- navigation race (KD6L4)
  // StartPage navigates to /lobby/CODE after lobby:joined: the old socket disconnects and a
  // new socket joins with the same code + playerId. The lobby must survive, and the creator
  // must be re-bound (no duplicate "Alice 2" player).
  console.log('\nNavigation race (creator reconnect):')
  const N1 = connect()
  await waitEvent(N1, 'connect')
  const n1Joined = waitEvent(N1, 'lobby:joined')
  N1.emit('lobby:join', { username: 'Alice', create: true, isPublic: false, lobbyName: 'E2E Nav Lobby' })
  const n1: { code: string; playerId: string } = await n1Joined
  ok('nav: creator gets lobby:joined', /^[A-Z0-9]{5}$/.test(n1.code), n1)

  N1.disconnect()
  const N2 = connect()
  const n2Updates: any[] = []
  N2.on('lobby:update', (d) => n2Updates.push(d))
  await waitEvent(N2, 'connect')
  const n2Joined = waitEvent(N2, 'lobby:joined')
  N2.emit('lobby:join', { username: 'Alice', code: n1.code, playerId: n1.playerId })
  const n2: { code: string; playerId: string } = await n2Joined
  ok('nav: lobby survives creator navigation', n2.code === n1.code && n2.playerId === n1.playerId, n2)

  await until(() => (latest(n2Updates)?.players?.length ?? 0) >= 1, 5000, 'creator visible again')
  const navPlayers = latest(n2Updates)?.players ?? []
  ok('nav: single player, no duplicate', navPlayers.length === 1, navPlayers)
  ok('nav: creator re-bound as host', navPlayers[0]?.id === n1.playerId && navPlayers[0]?.isHost === true, navPlayers)
  N2.disconnect()

  // ------------------------------------------------------------- admin
  console.log('\nAdmin API:')
  const loginRes = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  ok('admin login', loginRes.status === 200, { status: loginRes.status, body: await loginRes.clone().text() })
  const cookie = loginRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  ok('session cookie set', /mb_session=/.test(cookie), cookie)

  const H = { Cookie: cookie, 'Content-Type': 'application/json' }
  const noAuth = await fetch(`${BASE}/api/packs`)
  ok('packs require auth', noAuth.status === 401, noAuth.status)

  const packsRes = await fetch(`${BASE}/api/packs`, { headers: H })
  const packs = (await packsRes.json()).packs
  ok('packs list (incl. seeded Classic)', packs?.some((p: any) => p.name === 'Classic' && p.templateCount === 7), packs?.map((p: any) => `${p.name}:${p.templateCount}`))

  const pubRes = await fetch(`${BASE}/api/packs/public`)
  ok('public packs list', pubRes.status === 200 && Array.isArray((await pubRes.json()).packs))

  const newPack = await fetch(`${BASE}/api/packs`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'E2E Pack' }) })
  const packBody = await newPack.json()
  const pack = packBody.pack
  ok('create pack', newPack.status < 300 && !!pack?.id, packBody)

  const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  const form = new FormData()
  form.append('file', new Blob([Buffer.from(pngB64, 'base64')], { type: 'image/png' }), 'dot.png')
  const upRes = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form })
  const up = await upRes.json()
  ok('upload image', upRes.status < 300 && !!up.key && !!up.url, up)
  const upImg = await fetch(`${BASE}${up.url}`)
  ok('uploaded image served', upImg.status === 200 && (upImg.headers.get('content-type') ?? '').includes('png'), upImg.status)

  const newTpl = await fetch(`${BASE}/api/templates`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ packId: pack.id, name: 'E2E Template', imageKey: up.key }),
  })
  const tplBody = await newTpl.json()
  const tpl = tplBody.template
  ok('create template', newTpl.status < 300 && !!tpl?.id, tplBody)

  const patchRes = await fetch(`${BASE}/api/templates/${tpl.id}`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({ isFreeform: true, boxes: [], isActive: false }),
  })
  const patched = await patchRes.json()
  ok('patch template (freeform)', patched.template?.isFreeform === true && patched.template?.isActive === false, patched)

  const delTpl = await fetch(`${BASE}/api/templates/${tpl.id}`, { method: 'DELETE', headers: H })
  ok('delete template', delTpl.status < 300, delTpl.status)

  const delPack = await fetch(`${BASE}/api/packs/${pack.id}`, { method: 'DELETE', headers: H })
  ok('delete pack', delPack.status < 300, delPack.status)

  const logout = await fetch(`${BASE}/api/admin/logout`, { method: 'POST', headers: H })
  ok('logout', logout.status < 300, logout.status)
  const afterLogout = await fetch(`${BASE}/api/packs`, { headers: H })
  ok('session invalid after logout', afterLogout.status === 401, afterLogout.status)

  // ------------------------------------------------------------- summary
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('E2E crashed:', e)
  process.exit(1)
})
