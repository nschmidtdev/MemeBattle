/**
 * E2E smoke test: full 2-player game over sockets, reconnect/resume, admin API.
 * Run against a live server:  npx tsx scripts/e2e.ts
 */
import '../src/lib/env' // load the same .env* files as the server (ADMIN_*, PORT, ...)
import { io, type Socket } from 'socket.io-client'

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@localhost'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? ''

const HTTP_TIMEOUT_MS = 10_000
const GLOBAL_TIMEOUT_MS = 240_000

/** Unique per run so the login rate limiter buckets never leak between runs. */
const RUN_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

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

/** All sockets are tracked so cleanup can close them even after a crash. */
const sockets = new Set<Socket>()
/** Admin session used for the test pack; stays valid so cleanup can delete it. */
let adminCookie = ''
let testPackId = ''

function http(pathOrUrl: string, init: RequestInit = {}): Promise<Response> {
  const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${BASE}${pathOrUrl}`
  return fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
}

async function readJson(res: Response): Promise<any> {
  return res.json().catch(() => null)
}

function setCookies(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const raw = res.headers.get('set-cookie')
  return raw ? [raw] : []
}

function connect(): Socket {
  const s = io(BASE, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 8000,
    autoConnect: false,
  })
  sockets.add(s)
  return s
}

/** Register the connect waiter before the handshake starts. */
async function openSocket(): Promise<Socket> {
  const s = connect()
  const connected = waitEvent(s, 'connect', 10000)
  s.connect()
  await connected
  return s
}

/** Wait for one event; the listener is always removed, including on timeout. */
function waitEvent<T = any>(s: Socket, event: string, timeoutMs = 20000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timerRef: { id?: NodeJS.Timeout } = {}
    const handler = (data: T) => {
      if (timerRef.id) clearTimeout(timerRef.id)
      s.off(event, handler)
      resolve(data)
    }
    s.on(event, handler)
    timerRef.id = setTimeout(() => {
      s.off(event, handler)
      reject(new Error(`timeout waiting for ${event}`))
    }, timeoutMs)
  })
}

/** Wait for an event matching a predicate (already-seen events are ignored). */
function waitEventWhere<T = any>(
  s: Socket,
  event: string,
  predicate: (data: T) => boolean,
  timeoutMs = 20000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timerRef: { id?: NodeJS.Timeout } = {}
    const handler = (data: T) => {
      let matches = false
      try {
        matches = predicate(data)
      } catch {
        matches = false
      }
      if (!matches) return
      if (timerRef.id) clearTimeout(timerRef.id)
      s.off(event, handler)
      resolve(data)
    }
    s.on(event, handler)
    timerRef.id = setTimeout(() => {
      s.off(event, handler)
      reject(new Error(`timeout waiting for ${event} (filtered)`))
    }, timeoutMs)
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

function adminHeaders(): Record<string, string> {
  return { Cookie: adminCookie, 'Content-Type': 'application/json' }
}

async function loginAdmin(forwardedFor: string) {
  const res = await http('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': forwardedFor },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  const body = await readJson(res)
  const cookies = setCookies(res)
  const session =
    cookies
      .map((c) => c.split(';')[0].trim())
      .find((c) => c.startsWith('mb_session=')) ?? ''
  return { res, body, cookies, session }
}

/** Best effort, never changes the test result. */
async function cleanup() {
  for (const s of sockets) {
    try {
      s.disconnect()
      s.removeAllListeners()
    } catch (e) {
      console.log(`  cleanup: socket close failed: ${(e as Error).message}`)
    }
  }
  sockets.clear()

  if (testPackId && adminCookie) {
    const id = testPackId
    testPackId = ''
    try {
      const res = await http(`/api/packs/${id}`, { method: 'DELETE', headers: { Cookie: adminCookie } })
      if (res.status >= 300) console.log(`  cleanup: delete test pack returned ${res.status}`)
    } catch (e) {
      console.log(`  cleanup: delete test pack failed: ${(e as Error).message}`)
    }
  }
}

async function runSuite() {
  console.log(`E2E against ${BASE}\n`)

  // ------------------------------------------------------------- pages & public API
  console.log('Pages & public API:')
  const home = await http('/')
  const homeHtml = await home.text()
  ok('GET / returns 200', home.status === 200, home.status)
  ok('GET / renders start page', /Meme/i.test(homeHtml))
  const loginPage = await http('/admin/login')
  ok('GET /admin/login returns 200', loginPage.status === 200, loginPage.status)

  const health = await http('/api/health')
  const healthBody = await readJson(health)
  ok('GET /api/health -> 200 {ok:true}', health.status === 200 && healthBody?.ok === true, {
    status: health.status,
    body: healthBody,
  })

  const seedImg = await http(`/api/images/${encodeURIComponent('public:seed/drake.svg')}`)
  ok(
    'seed image served',
    seedImg.status === 200 && (seedImg.headers.get('content-type') ?? '').includes('svg'),
    seedImg.status,
  )

  // Directory keys must be a plain 404, never a crash or a listing.
  const dirRoot = await http(`/api/images/${encodeURIComponent('public:')}`)
  ok('GET /api/images/public: (directory) -> 404', dirRoot.status === 404, dirRoot.status)
  const dirSeed = await http(`/api/images/${encodeURIComponent('public:seed')}`)
  ok('GET /api/images/public:seed (directory) -> 404', dirSeed.status === 404, dirSeed.status)

  const noAuthPacks = await http('/api/packs')
  ok('packs require auth', noAuthPacks.status === 401, noAuthPacks.status)

  // ------------------------------------------------------------- admin setup (own pack)
  console.log('\nAdmin setup (HTTP login + own test pack):')
  const login = await loginAdmin(`e2e-setup-${RUN_TAG}`)
  ok('admin login over HTTP', login.res.status === 200, {
    status: login.res.status,
    body: login.body,
  })
  const rawSetCookie = login.cookies.join('\n')
  ok('session cookie set', login.session.startsWith('mb_session='), rawSetCookie || login.session)
  if (BASE.startsWith('http://')) {
    // COOKIE_SECURE is unset and there is no forwarded HTTPS protocol: never
    // mark the cookie Secure or plain-HTTP logins would silently break.
    ok('session cookie is not Secure on HTTP', !/;\s*Secure/i.test(rawSetCookie), rawSetCookie)
  }
  adminCookie = login.session
  if (login.res.status !== 200 || !adminCookie.startsWith('mb_session=')) {
    throw new Error(
      'Admin login failed; the E2E pack cannot be created. ' +
        'Set ADMIN_EMAIL/ADMIN_PASSWORD to the running server credentials.',
    )
  }

  const packRes = await http('/api/packs', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ name: `E2E Pack ${RUN_TAG}`, isPublic: true }),
  })
  const packBody = await readJson(packRes)
  const pack: any = packBody?.pack
  ok('create test pack -> 201', packRes.status === 201 && !!pack?.id, {
    status: packRes.status,
    body: packBody,
  })
  if (!pack?.id) throw new Error('Could not create the E2E test pack')
  testPackId = pack.id

  // Three templates: enough to prove reroll really changes the image, and
  // independent of the seeded "Classic" pack (which may be edited/deleted).
  const seedKeys = ['public:seed/drake.svg', 'public:seed/chad.svg', 'public:seed/grumpy-cat.svg']
  const packTemplates: any[] = []
  for (let i = 0; i < seedKeys.length; i++) {
    const res = await http('/api/templates', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        packId: pack.id,
        name: `E2E Template ${i + 1} ${RUN_TAG}`,
        imageKey: seedKeys[i],
      }),
    })
    const body = await readJson(res)
    ok(`create test template ${i + 1} -> 201`, res.status === 201 && !!body?.template?.id, {
      status: res.status,
      body,
    })
    if (body?.template?.id) packTemplates.push(body.template)
  }
  if (packTemplates.length !== seedKeys.length) throw new Error('Not all E2E templates were created')

  // Tiny valid 1x1 PNG (the server sniffs magic bytes, not the filename).
  const pngB64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  const pngForm = new FormData()
  pngForm.append('file', new Blob([Buffer.from(pngB64, 'base64')], { type: 'image/png' }), 'dot.png')
  const uploadRes = await http('/api/upload', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: pngForm,
  })
  const uploadBody = await readJson(uploadRes)
  const uploadKey: string = uploadBody?.key ?? ''
  ok(
    'upload tiny PNG -> 200/201 with key',
    (uploadRes.status === 200 || uploadRes.status === 201) && !!uploadKey,
    { status: uploadRes.status, body: uploadBody },
  )
  if (uploadKey) {
    const served = await http(`/api/images/${encodeURIComponent(uploadKey)}`)
    ok(
      'uploaded image served as PNG',
      served.status === 200 && (served.headers.get('content-type') ?? '').includes('png'),
      served.status,
    )
  }

  const svgForm = new FormData()
  svgForm.append(
    'file',
    new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><text>nope</text></svg>'], { type: 'image/svg+xml' }),
    'nope.svg',
  )
  const svgRes = await http('/api/upload', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: svgForm,
  })
  ok('SVG/non-image upload rejected -> 415', svgRes.status === 415, svgRes.status)

  // ------------------------------------------------------------- game
  console.log('\nGame (2 players, own test pack):')
  const A = await openSocket()
  const B = await openSocket()

  const aUpdates: any[] = []
  A.on('lobby:update', (d) => aUpdates.push(d))

  const aJoined = waitEvent<any>(A, 'lobby:joined', 10000)
  A.emit('lobby:join', { username: 'Alice', create: true, isPublic: false, lobbyName: 'E2E Lobby' })
  const jA: { code: string; playerId: string } = await aJoined
  ok('creator gets lobby:joined with code', /^[A-Z0-9]{5}$/.test(jA.code), jA)
  ok('creator gets server-assigned playerId', typeof jA.playerId === 'string' && jA.playerId.length > 8)

  const bJoined = waitEvent<any>(B, 'lobby:joined', 10000)
  B.emit('lobby:join', { username: 'Bob', code: jA.code, playerId: 'not-the-real-id' })
  const jB: { code: string; playerId: string } = await bJoined
  ok('joiner gets lobby:joined', jB.code === jA.code, jB)

  await until(() => (latest(aUpdates)?.players?.length ?? 0) >= 2, 10000, '2 players in lobby')
  ok('both players listed', latest(aUpdates)?.players?.length === 2, latest(aUpdates)?.players)
  ok('creator is host', latest(aUpdates)?.players?.find((p: any) => p.id === jA.playerId)?.isHost === true)

  // wrong code must fail
  const C = await openSocket()
  const cErr = waitEvent<any>(C, 'client:error', 5000)
  C.emit('lobby:join', { username: 'Carl', code: 'ZZZZZ' })
  const cErrData = await cErr
  ok('unknown code rejected', cErrData?.message?.includes('not found') === true, cErrData)
  C.disconnect()

  // Settings are server-normalized; voteTime is deliberately 8s so slow test
  // machines cannot race the meme timer. Caption time is generous; both
  // players submitting early skips it anyway.
  const settingsApplied = waitEventWhere<any>(
    A,
    'lobby:update',
    (d) => d.settings?.rounds === 1 && d.settings?.packIds?.length === 1,
    5000,
  )
  A.emit('lobby:settings', { rounds: 1, captionTime: 45, voteTime: 8, packIds: [pack.id] })
  const applied = await settingsApplied
  ok(
    'settings updated and normalized',
    applied.settings.voteTime === 8 && applied.settings.captionTime === 45 && applied.settings.rounds === 1,
    applied.settings,
  )

  // Register all post-start waiters BEFORE emitting lobby:start so the
  // (synchronous) phase:caption + caption:template burst is never missed.
  const aCaption = waitEvent<any>(A, 'phase:caption', 10000)
  const aTpl = waitEvent<any>(A, 'caption:template', 15000)
  const bTpl = waitEvent<any>(B, 'caption:template', 15000)
  // The second start must hit the `starting` lock (or, if the DB answered
  // faster than the packet arrived, the already-started guard). Either way the
  // game must start exactly once.
  const startLockErr = waitEventWhere<any>(
    A,
    'client:error',
    (e) => typeof e?.message === 'string' && /starting|already started/i.test(e.message),
    5000,
  )
  A.emit('lobby:start')
  A.emit('lobby:start')
  const startLockErrData = await startLockErr
  ok(
    'concurrent start is locked',
    typeof startLockErrData?.message === 'string' &&
      /starting|already started/i.test(startLockErrData.message),
    startLockErrData,
  )

  const capA = await aCaption
  ok('phase:caption broadcast', capA.round === 1 && capA.totalRounds === 1, capA)
  await until(() => latest(aUpdates)?.phase === 'caption', 5000, 'lobby:update with caption phase')
  ok('lobby:update carries caption phase', latest(aUpdates)?.phase === 'caption', latest(aUpdates)?.phase)
  const [tplA, tplB] = await Promise.all([aTpl, bTpl])
  ok(
    'both got a template',
    !!tplA.template?.imageKey && !!tplB.template?.imageKey,
    [tplA.template?.name, tplB.template?.name],
  )

  // Reroll: A trades the template once (texts are kept client-side). With the
  // dedicated 3-template pack the new image must differ from the old one.
  const aTpl2 = waitEvent<any>(A, 'caption:template', 5000)
  A.emit('caption:reroll')
  const rerolled = await aTpl2
  ok(
    'reroll deals a different template (3-template pack)',
    !!rerolled.template?.imageKey &&
      rerolled.template?.imageKey !== tplA.template?.imageKey &&
      rerolled.rerollsLeft === 2,
    {
      from: tplA.template?.imageKey,
      to: rerolled.template?.imageKey,
      rerollsLeft: rerolled.rerollsLeft,
    },
  )

  // Duplicate submit must be rejected. Register the error waiter before the
  // offending emit so the response can never be missed.
  A.emit('caption:submit', { texts: { x: 'first' }, lines: [] })
  const dupErr = waitEvent<any>(A, 'client:error', 5000)
  A.emit('caption:submit', { texts: { y: 'second' }, lines: [] })
  const dupErrData = await dupErr
  ok('duplicate caption rejected', dupErrData?.message?.includes('already') === true, dupErrData)

  // B's submit is the one that completes the round, so the voting waiters are
  // registered before it is emitted.
  const pvAEvent = waitEvent<any>(A, 'phase:voting', 30000)
  const pvBEvent = waitEvent<any>(B, 'phase:voting', 30000)
  B.emit('caption:submit', {
    texts: {},
    lines: [
      {
        id: 'l1',
        text: 'bob says hi',
        x: 0.5,
        y: 0.9,
        w: 0.8,
        fontSize: 0.07,
        color: '#ffffff',
        stroke: '#000000',
        font: 'Impact',
        align: 'center',
        rotation: 0,
      },
    ],
  })

  const pv = await pvAEvent
  await pvBEvent
  ok('voting phase: 2 memes', pv.memes?.length === 2 && pv.current === 0, {
    memes: pv.memes?.length,
    current: pv.current,
  })
  const bMeme = pv.memes?.find((m: any) => m.playerId === jB.playerId)
  ok('freeform lines carried into voting', bMeme?.submission?.lines?.length === 1, bMeme?.submission)
  const aMeme = pv.memes?.find((m: any) => m.playerId === jA.playerId)
  ok(
    'rerolled template used for voting',
    aMeme?.template?.imageKey === rerolled.template?.imageKey,
    [aMeme?.template?.imageKey, rerolled.template?.imageKey],
  )

  const ownOfA = pv.memes?.findIndex((m: any) => m.playerId === jA.playerId) ?? -1
  const ownOfB = pv.memes?.findIndex((m: any) => m.playerId === jB.playerId) ?? -1
  ok('both memes have an owner index', ownOfA >= 0 && ownOfB >= 0 && ownOfA !== ownOfB, {
    ownOfA,
    ownOfB,
  })

  // Register early: round:results fires when the last meme timer ends, while we
  // are still processing votes here.
  const resP = waitEvent<any>(A, 'round:results', 40000)
  const gameOverP = waitEvent<any>(A, 'game:over', 60000)
  // B's own meme may not be current yet; wait for its explicit progress event
  // BEFORE checking the own-vote error (the old `null ||` check was a no-op).
  const bOwnShown =
    ownOfB === 0
      ? Promise.resolve(null)
      : waitEventWhere<any>(A, 'voting:progress', (p: any) => p.index === ownOfB, 30000)
  // Meme 1 must actually be current before the second vote; otherwise the
  // server rejects it with "not up for voting" and the tie never happens.
  const meme1ShownA = waitEventWhere<any>(A, 'voting:progress', (p: any) => p.index === 1, 30000)
  const meme1ShownB = waitEventWhere<any>(B, 'voting:progress', (p: any) => p.index === 1, 30000)

  // Collect every buddy ack on both sockets: the picker-only contract is
  // proven by the non-picker never seeing `buddy:picked` (see below).
  const aBuddyAcks: any[] = []
  const bBuddyAcks: any[] = []
  A.on('buddy:picked', (d) => aBuddyAcks.push(d))
  B.on('buddy:picked', (d) => bBuddyAcks.push(d))

  const votesCast: Record<string, boolean> = { a: false, b: false }

  // Everyone eligible (the single non-author in this 2-player game) is about to
  // vote; the server must cap the remaining time at 5s instead of waiting the
  // full voteTime.
  const timer0P = waitEvent<any>(A, 'voting:timer', 10000)

  // Meme 0: only its non-owner can vote; upvotes from both sides create a tie.
  // The same non-owner is also the Meme Buddy picker for this meme.
  const picker0 = ownOfA === 0 ? B : A
  const picker0Id = ownOfA === 0 ? jB.playerId : jA.playerId
  const observer0Acks = ownOfA === 0 ? aBuddyAcks : bBuddyAcks
  const picker0Acks = ownOfA === 0 ? bBuddyAcks : aBuddyAcks

  if (ownOfA === 0) {
    B.emit('vote:cast', { index: 0, value: 'up' })
    votesCast.b = true
  } else {
    A.emit('vote:cast', { index: 0, value: 'up' })
    votesCast.a = true
  }

  const timer0 = await timer0P
  ok(
    'voting timer capped to 5s after all eligible votes',
    timer0?.index === 0 && typeof timer0?.timeLeft === 'number' && timer0.timeLeft <= 5,
    timer0,
  )

  // Wrong-index vote must fail (meme 1 is not current yet).
  const wErr = waitEvent<any>(A, 'client:error', 5000)
  A.emit('vote:cast', { index: 1, value: 'up' })
  const wErrData = await wErr
  ok('vote on non-current meme rejected', wErrData?.message?.includes('not up for voting') === true, wErrData)

  // B's own meme while it is current: must fail.
  if (ownOfB === 0) {
    const ownErr = waitEvent<any>(B, 'client:error', 5000)
    B.emit('vote:cast', { index: 0, value: 'down' })
    const ownErrData = await ownErr
    ok('own-meme vote rejected (B, index 0)', ownErrData?.message?.includes('own meme') === true, ownErrData)
  }

  // Meme Buddy for the current meme 0: the non-owner picks it once.
  const buddy0Ack = waitEvent<any>(picker0, 'buddy:picked', 5000)
  picker0.emit('buddy:pick', { index: 0 })
  const buddy0 = await buddy0Ack
  ok('buddy pick acked to the picker (index 0)', buddy0?.index === 0, buddy0)

  // Only one buddy pick per round and player.
  const buddyTwiceErr = waitEvent<any>(picker0, 'client:error', 5000)
  picker0.emit('buddy:pick', { index: 0 })
  const buddyTwiceErrData = await buddyTwiceErr
  ok(
    'second buddy pick in the same round rejected',
    /already/i.test(String(buddyTwiceErrData?.message ?? '')),
    buddyTwiceErrData,
  )

  // The owner of the current meme 0 has not picked yet, so this isolates the
  // own-meme rule from the "already picked" rule. Their later pick at meme 1
  // also proves the rejected attempt did not consume their buddy.
  const owner0 = ownOfA === 0 ? A : B
  const owner0Err = waitEvent<any>(owner0, 'client:error', 5000)
  owner0.emit('buddy:pick', { index: 0 })
  const owner0ErrData = await owner0Err
  ok('own-meme buddy pick rejected', /own/i.test(String(owner0ErrData?.message ?? '')), owner0ErrData)

  await bOwnShown
  await Promise.all([meme1ShownA, meme1ShownB])

  // The observer received the later voting:progress for meme 1, so a wrongly
  // broadcast ack for meme 0 would already have arrived (same connection order).
  ok(
    'buddy:picked is not broadcast to the other player',
    observer0Acks.length === 0 && picker0Acks.length === 1,
    { observerAcks: observer0Acks, pickerAcks: picker0Acks },
  )

  // Meme 1: the other player upvotes it, so both memes end with one upvote,
  // and also gives the Meme Buddy for meme 1.
  const picker1 = ownOfA === 1 ? B : A
  const picker1Id = ownOfA === 1 ? jB.playerId : jA.playerId
  if (ownOfB === 1) {
    const ownErr = waitEvent<any>(B, 'client:error', 5000)
    B.emit('vote:cast', { index: 1, value: 'down' })
    const ownErrData = await ownErr
    ok('own-meme vote rejected (B, index 1)', ownErrData?.message?.includes('own meme') === true, ownErrData)
    A.emit('vote:cast', { index: 1, value: 'up' })
    votesCast.a = true
  } else {
    B.emit('vote:cast', { index: 1, value: 'up' })
    votesCast.b = true
  }
  const buddy1Ack = waitEvent<any>(picker1, 'buddy:picked', 5000)
  picker1.emit('buddy:pick', { index: 1 })
  const buddy1 = await buddy1Ack
  ok('buddy pick acked to the picker (index 1)', buddy1?.index === 1, buddy1)
  ok('both players voted', votesCast.a && votesCast.b, votesCast)

  const resA = await resP
  ok('round:results broadcast', resA?.round === 1 && resA?.memes?.length === 2, resA)
  ok(
    'round:results carries the players map',
    resA?.players?.[jA.playerId]?.username === 'Alice' &&
      resA?.players?.[jB.playerId]?.username === 'Bob' &&
      !!resA.players[jA.playerId]?.avatar &&
      !!resA.players[jA.playerId]?.color,
    resA?.players,
  )
  // Mutual upvotes -> 1000 vote points; one Meme Buddy per meme -> +10 -> 1010.
  ok(
    'round memes carry shared rank 1 and 1010 points',
    resA?.memes?.every((m: any) => m.rank === 1 && m.voteScore === 1000 && m.score === 1010),
    resA?.memes,
  )
  // Gallery data for the new round gallery: template image + submitted lines.
  const galleryB = resA?.memes?.find((m: any) => m.playerId === jB.playerId)
  ok(
    'round:results memes carry template.imageKey and submission.lines',
    resA?.memes?.every(
      (m: any) =>
        typeof m.template?.imageKey === 'string' &&
        m.template.imageKey.length > 0 &&
        Array.isArray(m.submission?.lines),
    ) && galleryB?.submission?.lines?.length === 1,
    resA?.memes?.map((m: any) => ({
      imageKey: m.template?.imageKey,
      lines: m.submission?.lines?.length,
    })),
  )
  // Each meme was picked by exactly one buddy and awarded +10.
  ok(
    'round memes carry buddyCount, buddyBonus and buddyPlayerIds',
    resA?.memes?.every(
      (m: any) =>
        m.buddyCount === 1 &&
        m.buddyBonus === 10 &&
        Array.isArray(m.buddyPlayerIds) &&
        m.buddyPlayerIds.length === 1 &&
        m.buddyPlayerIds[0] === (m.index === 0 ? picker0Id : picker1Id),
    ),
    resA?.memes,
  )
  // 1010 meme points + 505 buddy bonus (half of 1010) -> 1515 per player.
  ok(
    'round totals are tied at 1515',
    resA?.roundTotals?.[jA.playerId] === 1515 && resA?.roundTotals?.[jB.playerId] === 1515,
    resA?.roundTotals,
  )
  const buddyPicks: any[] = Array.isArray(resA?.buddies) ? resA.buddies : []
  const buddyTargets = buddyPicks.map((b: any) => b?.targetPlayerId).sort()
  const expectedTargets =
    resA?.memes?.length === 2
      ? [resA.memes[0]?.playerId, resA.memes[1]?.playerId].sort()
      : []
  ok(
    'round:results lists both buddy picks with their bonus',
    buddyPicks.length === 2 &&
      buddyPicks.every((b: any) => b?.bonus === 505) &&
      JSON.stringify(buddyTargets) === JSON.stringify(expectedTargets),
    resA?.buddies,
  )

  const over = await gameOverP
  ok(
    'game:over ranking has both players at shared rank 1',
    over?.ranking?.length === 2 && over.ranking.every((r: any) => r.rank === 1),
    over?.ranking,
  )
  ok(
    'game:over totals and rounds include the buddy bonus',
    over?.ranking?.length === 2 &&
      over.ranking.every(
        (r: any) => r.total === 1515 && Array.isArray(r.rounds) && r.rounds.length === 1 && r.rounds[0] === 1515,
      ),
    over?.ranking,
  )
  ok(
    'game:over carries meme gallery',
    over?.memes?.length === 2 && over.memes.every((m: any) => m.template?.imageKey && m.submission),
    { memes: over?.memes?.length },
  )
  ok(
    'game:over memes carry buddyCount',
    over?.memes?.length === 2 && over.memes.every((m: any) => m.buddyCount === 1),
    over?.memes?.map((m: any) => m.buddyCount),
  )
  ok('game:over totalRounds', over?.totalRounds === 1, over?.totalRounds)

  // play again
  const again = waitEventWhere<any>(A, 'lobby:update', (d) => d.phase === 'lobby', 10000)
  A.emit('game:play-again')
  const after = await again
  ok('play-again resets to lobby', after.phase === 'lobby', after.phase)

  // kick: the server must check host rights, not trust the hidden UI button
  const bKickErr = waitEvent<any>(B, 'client:error', 5000)
  B.emit('lobby:kick', { playerId: jA.playerId }) // B is not the host
  const bKickErrData = await bKickErr
  ok('kick by non-host rejected', bKickErrData?.message?.includes('host') === true, bKickErrData)

  const bKicked = waitEvent<any>(B, 'player:kick', 5000)
  A.emit('lobby:kick', { playerId: jB.playerId }) // A (host) kicks B
  const kEvent = await bKicked
  ok('host kick broadcasts player:kick', kEvent?.playerId === jB.playerId, kEvent)
  await until(
    () => (latest(aUpdates)?.players ?? []).every((p: any) => p.id !== jB.playerId),
    5000,
    'kicked player removed',
  )
  ok(
    'kicked player removed from lobby',
    (latest(aUpdates)?.players ?? []).every((p: any) => p.id !== jB.playerId),
    latest(aUpdates)?.players?.map((p: any) => p.username),
  )

  A.disconnect()
  B.disconnect()

  // ------------------------------------------------------------- host handover & same-name rejoin
  console.log('\nHost handover & same-name rejoin:')
  const R1 = await openSocket()
  const r1Joined = waitEvent<any>(R1, 'lobby:joined', 10000)
  R1.emit('lobby:join', { username: 'Alice', create: true, isPublic: false, lobbyName: 'E2E Handover' })
  const r1: { code: string; playerId: string } = await r1Joined

  const R2 = await openSocket()
  const r2Updates: any[] = []
  R2.on('lobby:update', (d) => r2Updates.push(d))
  const r2Joined = waitEvent<any>(R2, 'lobby:joined', 10000)
  R2.emit('lobby:join', { username: 'Bob', code: r1.code })
  const r2: { code: string; playerId: string } = await r2Joined

  // host disconnects: the role must move to the remaining connected player
  R1.disconnect()
  const bIsHost = () =>
    latest(r2Updates)?.players?.find((p: any) => p.id === r2.playerId)?.isHost === true
  await until(bIsHost, 10000, 'host handed over')
  ok('host handed over on host disconnect', bIsHost() === true, latest(r2Updates)?.players)

  // joining again with the same name (no playerId) must rebind, not duplicate the seat
  const R3 = await openSocket()
  const r3Joined = waitEvent<any>(R3, 'lobby:joined', 10000)
  R3.emit('lobby:join', { username: 'Bob', code: r1.code })
  const r3: { code: string; playerId: string } = await r3Joined
  ok('same-name join rebinds instead of duplicating', r3.playerId === r2.playerId, r3)

  const stableSeats = () => {
    const players = latest(r2Updates)?.players ?? []
    return players.length === 2 && players.filter((p: any) => p.isHost).length === 1
  }
  await until(stableSeats, 5000, 'stable seat list after rejoin')
  ok(
    'rejoin keeps exactly one seat per name',
    stableSeats(),
    latest(r2Updates)?.players?.map((p: any) => p.username),
  )

  R3.disconnect()
  R2.disconnect()

  // ------------------------------------------------------------- navigation race (KD6L4)
  // StartPage navigates to /lobby/CODE after lobby:joined: the old socket disconnects and a
  // new socket joins with the same code + playerId. The lobby must survive, and the creator
  // must be re-bound (no duplicate "Alice 2" player).
  console.log('\nNavigation race (creator reconnect):')
  const N1 = await openSocket()
  const n1Joined = waitEvent<any>(N1, 'lobby:joined', 10000)
  N1.emit('lobby:join', { username: 'Alice', create: true, isPublic: false, lobbyName: 'E2E Nav Lobby' })
  const n1: { code: string; playerId: string } = await n1Joined
  ok('nav: creator gets lobby:joined', /^[A-Z0-9]{5}$/.test(n1.code), n1)

  N1.disconnect()
  const N2 = await openSocket()
  const n2Updates: any[] = []
  N2.on('lobby:update', (d) => n2Updates.push(d))
  const n2Joined = waitEvent<any>(N2, 'lobby:joined', 10000)
  N2.emit('lobby:join', { username: 'Alice', code: n1.code, playerId: n1.playerId })
  const n2: { code: string; playerId: string } = await n2Joined
  ok('nav: lobby survives creator navigation', n2.code === n1.code && n2.playerId === n1.playerId, n2)

  await until(() => (latest(n2Updates)?.players?.length ?? 0) >= 1, 5000, 'creator visible again')
  const navPlayers = latest(n2Updates)?.players ?? []
  ok('nav: single player, no duplicate', navPlayers.length === 1, navPlayers)
  ok(
    'nav: creator re-bound as host',
    navPlayers[0]?.id === n1.playerId && navPlayers[0]?.isHost === true,
    navPlayers,
  )
  N2.disconnect()

  // ------------------------------------------------------------- garbage create settings
  console.log('\nRegression: garbage create settings:')
  const G1 = await openSocket()
  const g1Updates: any[] = []
  G1.on('lobby:update', (d) => g1Updates.push(d))
  const g1Joined = waitEvent<any>(G1, 'lobby:joined', 10000)
  G1.emit('lobby:join', {
    username: 'Garbage',
    create: true,
    isPublic: false,
    lobbyName: 'Garbage Lobby',
    settings: { packIds: null, rounds: 'x', captionTime: -5, voteTime: 999 },
  })
  const g1: { code: string; playerId: string } = await g1Joined
  ok('garbage settings: lobby created without crashing', /^[A-Z0-9]{5}$/.test(g1?.code ?? ''), g1)

  await until(() => latest(g1Updates)?.settings !== undefined, 5000, 'normalized settings in lobby:update')
  const gs = latest(g1Updates)?.settings
  ok(
    'garbage settings normalized to defaults/clamps',
    gs?.rounds === 3 && gs?.captionTime === 5 && gs?.voteTime === 60 && Array.isArray(gs?.packIds) && gs.packIds.length === 0,
    gs,
  )
  ok('garbage settings keep the lobby name', latest(g1Updates)?.name === 'Garbage Lobby', latest(g1Updates)?.name)

  // Start with one connected player must be rejected before template loading.
  const onePlayerErr = waitEvent<any>(G1, 'client:error', 5000)
  G1.emit('lobby:start')
  const onePlayerErrData = await onePlayerErr
  ok(
    'start with only one connected player rejected',
    onePlayerErrData?.message?.includes('2 players') === true,
    onePlayerErrData,
  )

  const G2 = await openSocket()
  const g2Joined = waitEvent<any>(G2, 'lobby:joined', 10000)
  G2.emit('lobby:join', { username: 'Garbage2', code: g1.code })
  await g2Joined
  await until(() => (latest(g1Updates)?.players?.length ?? 0) >= 2, 5000, '2 garbage players')

  const noPackErr = waitEvent<any>(G1, 'client:error', 5000)
  G1.emit('lobby:start')
  const noPackErrData = await noPackErr
  ok(
    'start without packs rejected cleanly',
    noPackErrData?.message?.toLowerCase().includes('pack') === true,
    noPackErrData,
  )

  const healthAfter = await http('/api/health')
  const healthAfterBody = await readJson(healthAfter)
  ok(
    'server still healthy after garbage input',
    healthAfter.status === 200 && healthAfterBody?.ok === true,
    { status: healthAfter.status, body: healthAfterBody },
  )
  G1.disconnect()
  G2.disconnect()

  // ------------------------------------------------------------- non-submitter & caption resume
  console.log('\nRegression: non-submitter vote & caption resume:')
  const S1 = await openSocket()
  const S2 = await openSocket()
  const s1Updates: any[] = []
  S1.on('lobby:update', (d) => s1Updates.push(d))

  const s1Joined = waitEvent<any>(S1, 'lobby:joined', 10000)
  S1.emit('lobby:join', {
    username: 'SubA',
    create: true,
    isPublic: false,
    lobbyName: 'E2E Submit',
    settings: { rounds: 1, captionTime: 15, voteTime: 8, packIds: [pack.id] },
  })
  const s1: { code: string; playerId: string } = await s1Joined
  const s2Joined = waitEvent<any>(S2, 'lobby:joined', 10000)
  S2.emit('lobby:join', { username: 'SubB', code: s1.code })
  const s2: { code: string; playerId: string } = await s2Joined
  await until(() => (latest(s1Updates)?.players?.length ?? 0) >= 2, 5000, '2 submit-test players')

  const sCaption = waitEvent<any>(S1, 'phase:caption', 10000)
  const sTpl1 = waitEvent<any>(S1, 'caption:template', 15000)
  const sTpl2 = waitEvent<any>(S2, 'caption:template', 15000)
  const sVoting = waitEvent<any>(S1, 'phase:voting', 30000)
  S1.emit('lobby:start')
  const sCaptionData = await sCaption
  ok('submit scenario: caption started', sCaptionData?.round === 1 && sCaptionData?.totalRounds === 1, sCaptionData)
  await Promise.all([sTpl1, sTpl2])

  // Only B submits. A stays a non-submitter and later tries to vote.
  // `lobby:leave` is ordered after the submit on the same socket, so the
  // resulting ghost broadcast proves the submission was processed before the
  // reconnect.
  const s2Ghosted = waitEventWhere<any>(
    S1,
    'lobby:update',
    (d) => (d.players ?? []).some((p: any) => p.id === s2.playerId && p.connected === false),
    8000,
  )
  S2.emit('caption:submit', {
    texts: {},
    lines: [
      {
        id: 's1',
        text: 'only B submitted',
        x: 0.5,
        y: 0.8,
        w: 0.8,
        fontSize: 0.07,
        color: '#ffffff',
        stroke: '#000000',
        font: 'Impact',
        align: 'center',
        rotation: 0,
      },
    ],
  })
  S2.emit('lobby:leave')
  await s2Ghosted
  S2.disconnect()

  // Reconnect B with its playerId while the caption phase is still running:
  // the resume payload must restore the template, round info and submission.
  const S2b = await openSocket()
  const s2bJoined = waitEvent<any>(S2b, 'lobby:joined', 10000)
  const s2bTemplate = waitEvent<any>(S2b, 'caption:template', 10000)
  S2b.emit('lobby:join', { username: 'SubB', code: s1.code, playerId: s2.playerId })
  const s2b: { code: string; playerId: string } = await s2bJoined
  const resume = await s2bTemplate
  ok('caption resume rebinds the same player', s2b.playerId === s2.playerId, s2b)
  ok(
    'caption resume marks the submission',
    resume?.submitted === true && resume?.round === 1 && resume?.totalRounds === 1,
    resume,
  )
  ok(
    'caption resume returns the submission lines',
    Array.isArray(resume?.submission?.lines) && resume.submission.lines.length === 1,
    resume?.submission,
  )

  const sVotingData = await sVoting
  ok(
    'non-submitter scenario: voting has only B\'s meme',
    sVotingData?.memes?.length === 1 && sVotingData.memes[0]?.playerId === s2.playerId,
    sVotingData,
  )

  const sResults = waitEvent<any>(S1, 'round:results', 30000)
  const nonSubmitterErr = waitEvent<any>(S1, 'client:error', 5000)
  S1.emit('vote:cast', { index: 0, value: 'up' })
  const nonSubmitterErrData = await nonSubmitterErr
  ok(
    'non-submitter vote rejected with a submit error',
    typeof nonSubmitterErrData?.message === 'string' && nonSubmitterErrData.message.includes('submit'),
    nonSubmitterErrData,
  )

  // A non-submitter cannot give a Meme Buddy either, even for a foreign meme.
  const nonSubmitterBuddyErr = waitEvent<any>(S1, 'client:error', 5000)
  S1.emit('buddy:pick', { index: 0 })
  const nonSubmitterBuddyErrData = await nonSubmitterBuddyErr
  ok(
    'non-submitter buddy pick rejected with a submit error',
    typeof nonSubmitterBuddyErrData?.message === 'string' &&
      nonSubmitterBuddyErrData.message.toLowerCase().includes('submit'),
    nonSubmitterBuddyErrData,
  )

  const sResultsData = await sResults
  ok(
    'non-submitter round still ends with results',
    sResultsData?.round === 1 && sResultsData?.memes?.length === 1,
    sResultsData,
  )
  ok(
    'non-submitter results keep the players map',
    sResultsData?.players?.[s2.playerId]?.username === 'SubB',
    sResultsData?.players,
  )
  S1.disconnect()
  S2b.disconnect()

  // ------------------------------------------------------------- voting resume
  console.log('\nRegression: voting resume:')
  const V1 = await openSocket()
  const V2 = await openSocket()
  const v1Updates: any[] = []
  V1.on('lobby:update', (d) => v1Updates.push(d))

  const v1Joined = waitEvent<any>(V1, 'lobby:joined', 10000)
  V1.emit('lobby:join', {
    username: 'VoteA',
    create: true,
    isPublic: false,
    lobbyName: 'E2E Vote Resume',
    settings: { rounds: 1, captionTime: 20, voteTime: 8, packIds: [pack.id] },
  })
  const v1: { code: string; playerId: string } = await v1Joined
  const v2Joined = waitEvent<any>(V2, 'lobby:joined', 10000)
  V2.emit('lobby:join', { username: 'VoteB', code: v1.code })
  const v2: { code: string; playerId: string } = await v2Joined
  await until(() => (latest(v1Updates)?.players?.length ?? 0) >= 2, 5000, '2 vote-resume players')

  const vCaption = waitEvent<any>(V1, 'phase:caption', 10000)
  const vTpl1 = waitEvent<any>(V1, 'caption:template', 15000)
  const vTpl2 = waitEvent<any>(V2, 'caption:template', 15000)
  const vVoting = waitEvent<any>(V1, 'phase:voting', 30000)
  V1.emit('lobby:start')
  await vCaption
  await Promise.all([vTpl1, vTpl2])

  V1.emit('caption:submit', { texts: { v: 'one' }, lines: [] })
  V2.emit('caption:submit', { texts: { v: 'two' }, lines: [] })
  const vVotingData = await vVoting

  // Pick the non-owner of meme 0, cast a vote, then leave. Socket.IO preserves
  // the order, so the leave handler (and its broadcast) proves the vote landed.
  const voterIsA = vVotingData.memes?.[0]?.playerId !== v1.playerId
  const voter = voterIsA ? V1 : V2
  const voterId = voterIsA ? v1.playerId : v2.playerId
  const ghosted = waitEventWhere<any>(
    voterIsA ? V2 : V1,
    'lobby:update',
    (d) => (d.players ?? []).some((p: any) => p.id === voterId && p.connected === false),
    8000,
  )
  voter.emit('vote:cast', { index: 0, value: 'up' })
  // Give the buddy as well; the ack proves the server processed it before the leave.
  const voterBuddyAck = waitEvent<any>(voter, 'buddy:picked', 5000)
  voter.emit('buddy:pick', { index: 0 })
  await voterBuddyAck
  voter.emit('lobby:leave')
  await ghosted

  const VR = await openSocket()
  const vrJoined = waitEvent<any>(VR, 'lobby:joined', 10000)
  const vrResume = waitEvent<any>(VR, 'phase:voting', 10000)
  VR.emit('lobby:join', {
    username: voterIsA ? 'VoteA' : 'VoteB',
    code: v1.code,
    playerId: voterId,
  })
  const vr: { code: string; playerId: string } = await vrJoined
  const vrResumeData = await vrResume
  ok('voting resume rebinds the same player', vr.playerId === voterId, vr)
  ok(
    'voting resume returns the own votes',
    vrResumeData?.votes?.[0] === 'up' &&
      vrResumeData?.count === 2 &&
      (vrResumeData?.current === 0 || vrResumeData?.current === 1),
    vrResumeData,
  )
  ok(
    'voting resume returns the buddy pick',
    vrResumeData?.buddyIndex === 0,
    vrResumeData,
  )
  V1.disconnect()
  V2.disconnect()
  VR.disconnect()

  // ------------------------------------------------------------- negative buddy bonus
  // Downvote + buddy on BOTH memes: vote score -1000, +10 buddy -> -990 per meme,
  // picker bonus -495 (half of -990), player round total -1485.
  console.log('\nRegression: negative buddy bonus (downvote + buddy):')
  const Neg1 = await openSocket()
  const Neg2 = await openSocket()
  const neg1Updates: any[] = []
  Neg1.on('lobby:update', (d) => neg1Updates.push(d))

  const neg1Joined = waitEvent<any>(Neg1, 'lobby:joined', 10000)
  Neg1.emit('lobby:join', {
    username: 'NegA',
    create: true,
    isPublic: false,
    lobbyName: 'E2E Negative Buddy',
    settings: { rounds: 1, captionTime: 15, voteTime: 5, packIds: [pack.id] },
  })
  const neg1: { code: string; playerId: string } = await neg1Joined
  const neg2Joined = waitEvent<any>(Neg2, 'lobby:joined', 10000)
  Neg2.emit('lobby:join', { username: 'NegB', code: neg1.code })
  const neg2: { code: string; playerId: string } = await neg2Joined
  await until(() => (latest(neg1Updates)?.players?.length ?? 0) >= 2, 5000, '2 negative-test players')

  const nCaption = waitEvent<any>(Neg1, 'phase:caption', 10000)
  const nTpl1 = waitEvent<any>(Neg1, 'caption:template', 15000)
  const nTpl2 = waitEvent<any>(Neg2, 'caption:template', 15000)
  const nVoting = waitEvent<any>(Neg1, 'phase:voting', 30000)
  Neg1.emit('lobby:start')
  await nCaption
  await Promise.all([nTpl1, nTpl2])

  Neg1.emit('caption:submit', { texts: { n: 'neg one' }, lines: [] })
  Neg2.emit('caption:submit', { texts: { n: 'neg two' }, lines: [] })
  const nVotingData = await nVoting

  const nResultsP = waitEvent<any>(Neg1, 'round:results', 40000)
  const nMeme1Shown1 = waitEventWhere<any>(Neg1, 'voting:progress', (p: any) => p.index === 1, 30000)
  const nMeme1Shown2 = waitEventWhere<any>(Neg2, 'voting:progress', (p: any) => p.index === 1, 30000)

  // Meme 0: its non-owner downvotes and gives the buddy.
  const nOwner0IsA = nVotingData.memes?.[0]?.playerId === neg1.playerId
  const nVoter0 = nOwner0IsA ? Neg2 : Neg1
  nVoter0.emit('vote:cast', { index: 0, value: 'down' })
  const nBuddy0Ack = waitEvent<any>(nVoter0, 'buddy:picked', 5000)
  nVoter0.emit('buddy:pick', { index: 0 })
  await nBuddy0Ack

  await Promise.all([nMeme1Shown1, nMeme1Shown2])

  // Meme 1: the other player is its non-owner, downvotes and gives the buddy.
  const nVoter1 = nOwner0IsA ? Neg1 : Neg2
  nVoter1.emit('vote:cast', { index: 1, value: 'down' })
  const nBuddy1Ack = waitEvent<any>(nVoter1, 'buddy:picked', 5000)
  nVoter1.emit('buddy:pick', { index: 1 })
  await nBuddy1Ack

  const nRes = await nResultsP
  ok(
    'negative: downvoted memes score -990 with one buddy',
    nRes?.memes?.length === 2 &&
      nRes.memes.every(
        (m: any) =>
          m.voteScore === -1000 &&
          m.up === 0 &&
          m.down === 1 &&
          m.buddyBonus === 10 &&
          m.buddyCount === 1 &&
          m.score === -990 &&
          m.rank === 1,
      ),
    nRes?.memes,
  )
  const nBuddies: any[] = Array.isArray(nRes?.buddies) ? nRes.buddies : []
  ok(
    'negative: buddy bonus is negative (-495)',
    nBuddies.length === 2 && nBuddies.every((b: any) => b?.bonus === -495),
    nRes?.buddies,
  )
  ok(
    'negative: roundTotals include the negative bonus',
    nRes?.roundTotals?.[neg1.playerId] === -1485 && nRes?.roundTotals?.[neg2.playerId] === -1485,
    nRes?.roundTotals,
  )

  Neg1.disconnect()
  Neg2.disconnect()

  // ------------------------------------------------------------- admin API (auth + validation)
  console.log('\nAdmin API (auth + validation):')
  const packsRes = await http('/api/packs', { headers: { Cookie: adminCookie } })
  const packsBody = await readJson(packsRes)
  const packs = packsBody?.packs
  ok('packs list', packsRes.status === 200 && Array.isArray(packs), {
    status: packsRes.status,
    body: packsBody,
  })
  ok(
    'packs list contains the E2E pack with 3 templates',
    packs?.some((p: any) => p.id === pack.id && p.templateCount === 3),
    packs?.map((p: any) => `${p.name}:${p.templateCount}`),
  )

  const pubRes = await http('/api/packs/public')
  const pubBody = await readJson(pubRes)
  ok('public packs list', pubRes.status === 200 && Array.isArray(pubBody?.packs), {
    status: pubRes.status,
    body: pubBody,
  })
  ok(
    'public packs list contains the E2E pack (3 active templates)',
    pubBody?.packs?.some((p: any) => p.id === pack.id && p.templateCount === 3),
    pubBody?.packs,
  )

  // Unknown image keys are rejected by the template API (400, not a 500).
  const unknownImageRes = await http('/api/templates', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      packId: pack.id,
      name: `E2E Unknown Image ${RUN_TAG}`,
      imageKey: `definitely-missing-${RUN_TAG}.png`,
    }),
  })
  ok('template with unknown imageKey -> 400', unknownImageRes.status === 400, unknownImageRes.status)

  const nullBoxRes = await http('/api/templates', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      packId: pack.id,
      name: `E2E Null Box ${RUN_TAG}`,
      imageKey: seedKeys[0],
      boxes: [null],
    }),
  })
  ok('template boxes [null] -> 400', nullBoxRes.status === 400, nullBoxRes.status)

  const outOfRangeBoxRes = await http('/api/templates', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      packId: pack.id,
      name: `E2E Bad Box ${RUN_TAG}`,
      imageKey: seedKeys[0],
      boxes: [
        {
          id: 'b1',
          x: 5,
          y: 0.5,
          w: 0.9,
          fontSize: 0.06,
          color: '#ffffff',
          stroke: '#000000',
          font: 'Impact',
          align: 'center',
          rotation: 0,
        },
      ],
    }),
  })
  ok('template box x=5 -> 400', outOfRangeBoxRes.status === 400, outOfRangeBoxRes.status)

  // Optimistic concurrency: a stale updatedAt must not overwrite newer edits.
  const target = packTemplates[0]
  const stalePatch = await http(`/api/templates/${target.id}`, {
    method: 'PATCH',
    headers: adminHeaders(),
    body: JSON.stringify({ name: 'E2E Stale Write', updatedAt: '2000-01-01T00:00:00.000Z' }),
  })
  ok('PATCH with stale updatedAt -> 409', stalePatch.status === 409, stalePatch.status)

  const badBoxPatch = await http(`/api/templates/${target.id}`, {
    method: 'PATCH',
    headers: adminHeaders(),
    body: JSON.stringify({ boxes: [null] }),
  })
  ok('PATCH boxes [null] -> 400', badBoxPatch.status === 400, badBoxPatch.status)

  const patchRes = await http(`/api/templates/${target.id}`, {
    method: 'PATCH',
    headers: adminHeaders(),
    body: JSON.stringify({
      name: `E2E Template Renamed ${RUN_TAG}`,
      isFreeform: true,
      boxes: [],
      isActive: false,
      updatedAt: target.updatedAt,
    }),
  })
  const patched = await readJson(patchRes)
  ok(
    'PATCH with the current updatedAt -> 200',
    patchRes.status === 200 &&
      patched?.template?.name === `E2E Template Renamed ${RUN_TAG}` &&
      patched?.template?.isActive === false,
    { status: patchRes.status, body: patched },
  )

  if (uploadKey) {
    const uploadTplRes = await http('/api/templates', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        packId: pack.id,
        name: `E2E Upload Template ${RUN_TAG}`,
        imageKey: uploadKey,
      }),
    })
    const uploadTplBody = await readJson(uploadTplRes)
    const uploadTpl: any = uploadTplBody?.template
    ok('create template from uploaded image -> 201', uploadTplRes.status === 201 && !!uploadTpl?.id, {
      status: uploadTplRes.status,
      body: uploadTplBody,
    })
    if (uploadTpl?.id) {
      const delTpl = await http(`/api/templates/${uploadTpl.id}`, {
        method: 'DELETE',
        headers: { Cookie: adminCookie },
      })
      ok('delete template -> 200', delTpl.status === 200, delTpl.status)
    }
  }

  const throwawayRes = await http('/api/packs', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ name: `E2E Delete Me ${RUN_TAG}` }),
  })
  const throwawayBody = await readJson(throwawayRes)
  const throwaway: any = throwawayBody?.pack
  ok('create throwaway pack -> 201', throwawayRes.status === 201 && !!throwaway?.id, {
    status: throwawayRes.status,
    body: throwawayBody,
  })
  if (throwaway?.id) {
    const delPack = await http(`/api/packs/${throwaway.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    })
    ok('delete pack -> 200', delPack.status === 200, delPack.status)
  }

  // Logout/session invalidation on a SECOND session: the primary cookie stays
  // valid so the final cleanup can still delete the E2E pack.
  const logoutLogin = await loginAdmin(`e2e-logout-${RUN_TAG}`)
  ok(
    'second admin login for logout test',
    logoutLogin.res.status === 200 && !!logoutLogin.session,
    { status: logoutLogin.res.status, body: logoutLogin.body },
  )
  const logoutRes = await http('/api/admin/logout', {
    method: 'POST',
    headers: { Cookie: logoutLogin.session },
  })
  ok('logout -> 200', logoutRes.status === 200, logoutRes.status)
  const afterLogout = await http('/api/packs', { headers: { Cookie: logoutLogin.session } })
  ok('session invalid after logout', afterLogout.status === 401, afterLogout.status)
  const primaryStillValid = await http('/api/packs', { headers: { Cookie: adminCookie } })
  ok('the other admin session survives the logout', primaryStillValid.status === 200, primaryStillValid.status)

  // Rate limit MUST stay the last login test: after this bucket is exhausted no
  // further login is attempted. The unique x-forwarded-for keeps runs isolated.
  const rateStatuses: number[] = []
  for (let i = 0; i < 6; i++) {
    const res = await http('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `e2e-rate-${RUN_TAG}` },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: `definitely-wrong-${i}` }),
    })
    rateStatuses.push(res.status)
  }
  ok('rate limit: first five wrong logins -> 401', rateStatuses.slice(0, 5).every((s) => s === 401), rateStatuses)
  ok('rate limit: sixth wrong login -> 429', rateStatuses[5] === 429, rateStatuses)
}

async function main() {
  const globalTimer = setTimeout(() => {
    console.error(`\nE2E global timeout after ${GLOBAL_TIMEOUT_MS} ms`)
    process.exit(1)
  }, GLOBAL_TIMEOUT_MS)

  try {
    await runSuite()
  } catch (e) {
    console.error('E2E crashed:', e)
    failed++
  } finally {
    await cleanup()
    clearTimeout(globalTimer)
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main()
