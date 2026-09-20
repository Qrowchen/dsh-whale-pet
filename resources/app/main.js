/**
 * 大肥鱼桌宠 — Electron 主进程
 *
 * 职责：
 *   1. 创建透明、无边框、置顶的桌宠窗口
 *   2. 保管 DeepSeek API Key（只存在 Node 侧，渲染层不接触）
 *   3. 直连 DeepSeek API：余额查询、流式问答、会话存储
 *
 * 设计：渲染层沿用了原 DSH 挂件的前端代码，它会请求 /dsh-whale/* 系列路径。
 * 这些请求由 preload 拦截并转到这里的 IPC 处理器，因此前端代码几乎不必改动。
 */
const { app, BrowserWindow, ipcMain, screen, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execSync } = require('node:child_process')

// ---------------------------------------------------------------------------
// 配置（API Key 等）——放在项目目录下的 config.json，只在本机使用
// ---------------------------------------------------------------------------
const PROJECT_DIR = __dirname
const CONFIG_PATH = path.join(PROJECT_DIR, 'config.json')
const CHAT_DIR = path.join(PROJECT_DIR, 'chat-data')
const ASSETS_DIR = path.join(PROJECT_DIR, 'assets')
const RENDERER_DIR = path.join(PROJECT_DIR, 'renderer')

const CHAT_API_URL = 'https://api.deepseek.com/chat/completions'
const BALANCE_URL = 'https://api.deepseek.com/user/balance'
// 实测该 Key 只支持这两个模型名（GET /models 与 400 报错均确认）。
// 注意 "deepseek-v4.1-flash" 是显示名，直接当 API 模型名会被 400 拒绝。
const CHAT_MODEL = 'deepseek-flash'
const CHAT_MODELS = ['deepseek-flash', 'deepseek-v4-pro']
const CHAT_MAX_TURNS = 20
const CHAT_MAX_TOKENS = 2048
const CHAT_TIMEOUT_MS = 180000
const BALANCE_TTL_MS = 25000
const IMG_VERSIONS = ['v1', 'v2', 'v3', 'v4']
// 音效集映射：挂件用语义名 press/release 请求，文件按音效集区分。
// 与源插件 SOUND_SETS 保持一致（duck = 小黄鸭 Ya*，fx1 = 音效1 D*）。
const SOUND_SETS = {
  duck: { press: 'Ya1.mp3', release: 'Ya2.mp3' },
  fx1: { press: 'D1.mp3', release: 'D2.mp3' },
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch (err) {
    return {}
  }
}
function getApiKey() {
  // 优先环境变量，其次 config.json
  const fromEnv = process.env.DEEPSEEK_API_KEY
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim()
  const cfg = readConfig()
  return cfg.apiKey ? String(cfg.apiKey).trim() : ''
}

// ---------------------------------------------------------------------------
// 余额
// ---------------------------------------------------------------------------
let balanceCache = null
let balanceInFlight = null

async function fetchBalanceRaw() {
  const key = getApiKey()
  if (!key) return { ok: false, code: 'NO_KEY', error: '未配置 API Key（请在 config.json 填写 apiKey）' }
  let lastErr = null
  for (let attempt = 0; attempt < 2; attempt++) {
    let res
    try {
      res = await fetch(BALANCE_URL, {
        headers: { Authorization: 'Bearer ' + key },
        signal: AbortSignal.timeout(20000),
      })
    } catch (err) {
      lastErr = err
      if (attempt === 0) await new Promise((r) => setTimeout(r, 500))
      continue
    }
    if (!res.ok) {
      lastErr = new Error('HTTP ' + res.status)
      if (res.status < 500) break
      if (attempt === 0) await new Promise((r) => setTimeout(r, 500))
      continue
    }
    let data
    try { data = await res.json() } catch (err) {
      return { ok: false, code: 'PARSE', error: '余额接口返回不是合法 JSON' }
    }
    const info = data && Array.isArray(data.balance_infos) ? data.balance_infos[0] : null
    if (!info || info.total_balance === undefined) {
      return { ok: false, code: 'SHAPE', error: '余额接口返回结构异常' }
    }
    return {
      ok: true,
      totalBalance: Number(info.total_balance),
      currency: String(info.currency || 'CNY'),
      updatedAt: new Date().toISOString(),
    }
  }
  return {
    ok: false,
    code: 'HTTP',
    transient: !(lastErr && /^HTTP 4\d\d/.test(lastErr.message)),
    error: '余额请求失败: ' + String((lastErr && lastErr.message) || lastErr).slice(0, 200),
  }
}

// 峰谷计价时段（北京时间 9-12、14-18 为高峰）
const PEAK_HOURS = [[9, 12], [14, 18]]
function isPeakNow() {
  const now = new Date()
  // 转成北京时间的小时
  const bj = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + 8 * 3600000)
  const h = bj.getHours()
  const day = bj.getDay()
  if (day === 0 || day === 6) return false   // 周末全天低峰
  for (const [s, e] of PEAK_HOURS) if (h >= s && h < e) return true
  return false
}

async function getBalance() {
  const now = Date.now()
  if (balanceCache && now - balanceCache.at < BALANCE_TTL_MS) return balanceCache.payload
  if (balanceInFlight) return balanceInFlight
  balanceInFlight = (async () => {
    const payload = await fetchBalanceRaw()
    if (payload.ok) {
      payload.isPeak = isPeakNow()
      payload.usageMode = 'ledger'
      const led = recordLedger(Number(payload.totalBalance))
      payload.todayUsage = led.todayUsage
      balanceCache = { at: Date.now(), payload }
      return payload
    }
    // 瞬时失败沿用上次成功值，避免界面上数字跳成错误
    if (payload.transient && balanceCache) return balanceCache.payload
    return payload
  })().finally(() => { balanceInFlight = null })
  return balanceInFlight
}

// 本地记账：用余额差值累计今日消耗（DeepSeek 未开放用量查询）
const LEDGER_PATH = path.join(PROJECT_DIR, 'usage-ledger.json')
function recordLedger(balance) {
  const today = new Date().toISOString().slice(0, 10)
  let led = { date: today, todayUsage: 0, lastBalance: null }
  try { led = Object.assign(led, JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'))) } catch (err) {}
  if (led.date !== today) { led = { date: today, todayUsage: 0, lastBalance: null } }
  if (isFinite(balance)) {
    if (led.lastBalance !== null && balance < led.lastBalance) {
      led.todayUsage += (led.lastBalance - balance)
    }
    led.lastBalance = balance
  }
  try { fs.writeFileSync(LEDGER_PATH, JSON.stringify(led, null, 2), 'utf8') } catch (err) {}
  return led
}

// ---------------------------------------------------------------------------
// 会话存储
// ---------------------------------------------------------------------------
function ensureDir(d) { try { fs.mkdirSync(d, { recursive: true }) } catch (err) {} return d }
const chatIndexPath = () => path.join(ensureDir(CHAT_DIR), 'index.json')
// 必须和 chatIndexPath 一样先确保目录存在：否则冷启动（目录还没建）时
// writeSession 的写入会抛错并被 catch 吞掉，表现为「会话静默丢失、历史不落盘」。
const chatSessionPath = (id) => path.join(ensureDir(CHAT_DIR), id + '.json')

function readIndex() {
  try {
    const o = JSON.parse(fs.readFileSync(chatIndexPath(), 'utf8'))
    if (o && Array.isArray(o.sessions)) return o
  } catch (err) {}
  return { sessions: [], activeId: null }
}
function writeIndex(idx) {
  try { fs.writeFileSync(chatIndexPath(), JSON.stringify(idx, null, 2), 'utf8') } catch (err) {}
}
function readSession(id) {
  try {
    const o = JSON.parse(fs.readFileSync(chatSessionPath(id), 'utf8'))
    if (o && Array.isArray(o.messages)) return o
  } catch (err) {}
  return null
}
function writeSession(s) {
  try { fs.writeFileSync(chatSessionPath(s.id), JSON.stringify(s, null, 2), 'utf8') } catch (err) {}
}
function validId(id) {
  return typeof id === 'string' && id.length > 6 && id.length <= 64 &&
    id.startsWith('whale-') && /^[A-Za-z0-9-]+$/.test(id)
}
function trimMessages(list) {
  const max = CHAT_MAX_TURNS * 2
  return list.length > max ? list.slice(list.length - max) : list
}
function titleOf(text) {
  const one = String(text || '').replace(/\s+/g, ' ').trim()
  if (!one) return '新对话'
  return one.length > 24 ? one.slice(0, 24) + '…' : one
}
function appendMessages(id, userText, assistantText) {
  const s = readSession(id)
  if (!s) return null
  s.messages.push({ role: 'user', content: userText, ts: Date.now() })
  if (assistantText) s.messages.push({ role: 'assistant', content: assistantText, ts: Date.now() })
  s.messages = trimMessages(s.messages)
  s.updatedAt = Date.now()
  if (s.title === '新对话') s.title = titleOf(userText)
  writeSession(s)
  const idx = readIndex()
  const row = idx.sessions.find((x) => x.id === id)
  if (row) {
    row.title = s.title
    row.updatedAt = s.updatedAt
    idx.sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    writeIndex(idx)
  }
  return s
}

const SYSTEM_PROMPT = [
  '你是运行在用户桌面上的常驻挂件角色，形象是一只蓝色的鲸鱼娘，社区里叫你「大肥鱼」。',
  '用户给你加装了对话窗口，你可以直接和用户聊天。',
  '',
  '回答要求：',
  '- 默认用中文回答；用户用其他语言提问时跟随用户的语言。',
  '- 语气亲切、简洁，偶尔可以带一点挂件角色的俏皮，但不要卖萌过度影响信息准确性。',
  '- 技术问题要准确、直接，代码和命令保持原样不要改写。',
  '- 不确定的事情就明说不确定，不要编造。',
  '- 回答保持精简，除非用户明确要求详细展开。',
].join('\n')

// ---------------------------------------------------------------------------
// 流式问答：通过 webContents.send 把增量推给渲染层
// ---------------------------------------------------------------------------
async function handleChatStream(payload, webContents, streamId) {
  const id = payload && typeof payload.sessionId === 'string' ? payload.sessionId : ''
  const message = payload && typeof payload.message === 'string' ? payload.message.trim() : ''
  const useHistory = !payload || payload.useHistory !== false
  const model = payload && CHAT_MODELS.includes(payload.model) ? payload.model : CHAT_MODEL

  // streamId 让渲染层能区分不同请求的增量：否则两条流并发时（比如连续发问），
  // 先注册的监听器会把后一条流的内容也收下，表现为回答串台/错位。
  const send = (obj) => {
    try {
      if (!webContents.isDestroyed()) webContents.send('chat:chunk', Object.assign({ streamId: streamId }, obj))
    } catch (err) {}
  }

  if (!validId(id)) { send({ t: 'err', error: '无效的会话 id' }); return }
  if (!message) { send({ t: 'err', error: '消息为空' }); return }
  if (message.length > 8000) { send({ t: 'err', error: '消息过长（上限 8000 字）' }); return }

  const key = getApiKey()
  if (!key) {
    send({ t: 'err', code: 'NO_KEY', error: '未配置 API Key（请在 config.json 填写 apiKey）' })
    return
  }

  const sess = readSession(id) || { id, title: '新对话', messages: [], createdAt: Date.now() }
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }]
  if (useHistory) {
    for (const m of trimMessages(sess.messages)) {
      if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
        messages.push({ role: m.role, content: m.content })
      }
    }
  }
  messages.push({ role: 'user', content: message })

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), CHAT_TIMEOUT_MS)
  let acc = ''
  try {
    const up = await fetch(CHAT_API_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, max_tokens: CHAT_MAX_TOKENS }),
      signal: ac.signal,
    })
    if (!up.ok || !up.body) {
      let detail = 'HTTP ' + up.status
      try {
        const txt = await up.text()
        try { const j = JSON.parse(txt); if (j && j.error && j.error.message) detail = String(j.error.message).slice(0, 300) } catch (e) { if (txt) detail = txt.slice(0, 300) }
      } catch (err) {}
      send({ t: 'err', error: detail })
      appendMessages(id, message, '')
      return
    }
    const reader = up.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const step = await reader.read()
      if (step.done) break
      buf += dec.decode(step.value, { stream: true })
      let nl = buf.indexOf('\n')
      while (nl !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line && line.startsWith('data:')) {
          const p = line.slice(5).trim()
          if (p && p !== '[DONE]') {
            try {
              const j = JSON.parse(p)
              const ch = j && j.choices && j.choices[0]
              const piece = ch && ch.delta && typeof ch.delta.content === 'string' ? ch.delta.content : ''
              if (piece) { acc += piece; send({ t: 'd', c: piece }) }
            } catch (err) {}
          }
        }
        nl = buf.indexOf('\n')
      }
    }
    appendMessages(id, message, acc)
    if (!acc) send({ t: 'err', error: '模型没有返回内容' })
    else send({ t: 'done' })
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || String(err.message || '').includes('abort'))
    appendMessages(id, message, acc)
    send({ t: 'err', error: aborted ? '请求超时或已取消' : ('请求失败: ' + String((err && err.message) || err).slice(0, 200)) })
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// 静态资源：把前端的 /dsh-whale/* 请求映射到本地 assets
// ---------------------------------------------------------------------------
function readFileSafe(p) {
  try { return fs.readFileSync(p) } catch (err) { return null }
}
function exprFile(name, ver) {
  const v = IMG_VERSIONS.includes(ver) ? ver : 'v2'
  if (!name || !/^[A-Za-z0-9_-]+$/.test(name)) return null
  return path.join(ASSETS_DIR, v, name + '.png')
}

async function handleAsset(url) {
  let u
  try { u = new URL(url, 'http://localhost') } catch (err) { return { status: 404 } }
  const p = u.pathname
  const ver = u.searchParams.get('ver') || 'v2'

  if (p === '/dsh-whale/image.png') {
    const b = readFileSafe(path.join(ASSETS_DIR, IMG_VERSIONS.includes(ver) ? ver : 'v2', 'DSniang1.png')) ||
      readFileSafe(path.join(ASSETS_DIR, 'DSniang1.png'))
    return b ? { status: 200, body: b, mime: 'image/png' } : { status: 404 }
  }
  if (p === '/dsh-whale/rua.gif') {
    const b = readFileSafe(path.join(ASSETS_DIR, 'rua.gif'))
    return b ? { status: 200, body: b, mime: 'image/gif' } : { status: 404 }
  }
  if (p === '/dsh-whale/expr') {
    const b = readFileSafe(exprFile(u.searchParams.get('name'), ver))
    return b ? { status: 200, body: b, mime: 'image/png' } : { status: 404 }
  }
  if (p.startsWith('/dsh-whale/sound/')) {
    // 挂件请求的是语义名（press / release）+ ?set=<音效集>，
    // 而真正的文件是按音效集区分的：duck → Ya1/Ya2，fx1 → D1/D2。
    // 直接把 press.mp3 当文件名去读会 404，音频永远是空的（表现为没有按压音效）。
    const which = p.indexOf('release') !== -1 ? 'release' : 'press'
    const setName = u.searchParams.get('set') || 'duck'
    const mapping = SOUND_SETS[setName] || SOUND_SETS.duck
    const file = mapping ? mapping[which] : null
    const b = file ? readFileSafe(path.join(ASSETS_DIR, 'sound', file)) : null
    return b ? { status: 200, body: b, mime: 'audio/mpeg' } : { status: 404 }
  }
  return { status: 404 }
}

async function handleApi(pathname, payload) {
  if (pathname === '/dsh-whale/balance.json') return getBalance()
  if (pathname === '/dsh-whale/last-turn.json') return { ok: true, seq: 0, turn: null, amount: null, tokens: null, ts: null }
  if (pathname === '/dsh-whale/size.json') {
    // 桌宠只连 DeepSeek，因此把"账号"默认设为 -1（DeepSeek 余额模式）。
    // 挂件默认 selectedAccountIdx = 0（火山引擎），而桌宠没有火山数据，
    // 会导致气泡显示「火山方舟用量--获取失败」。
    // 挂件在 size.json 回调里会执行 usageSelect.value = usageMode 来恢复该设置。
    return { ok: true, scale: 1.5, sound: true, vol: 0.9, soundSet: 'duck', usageMode: '-1', peakMode: 'default', bubbleOn: true, turnCostOn: true, turnCostCloseMs: 5000 }
  }
  if (pathname === '/dsh-whale/chat/sessions.json') {
    const idx = readIndex()
    idx.sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    return { ok: true, sessions: idx.sessions, activeId: idx.activeId }
  }
  if (pathname === '/dsh-whale/chat/messages.json') {
    const id = payload && payload.id
    const sess = validId(id) ? readSession(id) : null
    return { ok: true, session: sess }
  }
  return { ok: false, error: 'unknown api ' + pathname }
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------
let win = null
// 活动区域（CSS 像素，相对窗口左上角）：挂件形象 + 菜单 + 对话面板。
// 由渲染层上报，主进程据此决定是否让鼠标穿透到桌面。
let activeRegion = { x: 0, y: 0, w: 0, h: 0 }
let ignoreMouse = null
let cursorTimer = null
// 上一拍的窗口位置，用来识别"正在拖动"
let lastWinPos = null

function applyIgnoreMouse(next) {
  if (!win || ignoreMouse === next) return
  ignoreMouse = next
  try {
    if (next) win.setIgnoreMouseEvents(true, { forward: true })
    else win.setIgnoreMouseEvents(false)
  } catch (err) {}
}

function startCursorWatch() {
  if (cursorTimer) clearInterval(cursorTimer)
  // 用主进程轮询系统鼠标位置来判断是否悬停在挂件上。
  //
  // 为什么不在渲染层用 mousemove 判断：一旦窗口设为穿透，鼠标事件就不再进入
  // 页面，渲染层的悬停检测永远不会触发，于是永久保持穿透 —— 挂件会完全点不动。
  // 主进程的 screen.getCursorScreenPoint() 不受窗口穿透影响，因此没有这个死锁。
  //
  // 频率取 150ms：早期用 60ms 时实测主进程 CPU 持续升高（20s+/分钟），
  // 明显拖慢整机；穿透切换只在状态变化时发生，150ms 的手感已经足够跟手。
  cursorTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return
    try {
      const r = activeRegion
      if (!(r.w > 0)) return          // 区域还没上报，先不动

      const b = win.getBounds()
      // 窗口位置一变，说明用户正在拖动。
      // 拖动期间必须冻结穿透状态：此时鼠标相对窗口在移动，判定会在"内/外"之间
      // 反复翻转，每次翻转都要调用系统 API setIgnoreMouseEvents —— 拖动中高频
      // 调用会把整机拖卡（实测 CPU 20s+/25s）。
      const moved = lastWinPos && (lastWinPos.x !== b.x || lastWinPos.y !== b.y)
      lastWinPos = { x: b.x, y: b.y }
      if (moved) return

      const pt = screen.getCursorScreenPoint()
      const lx = pt.x - b.x
      const ly = pt.y - b.y
      const inside = lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h
      applyIgnoreMouse(!inside)       // 内部已做去重，状态不变时不会调用系统 API
    } catch (err) {}
  }, 150)
  if (cursorTimer.unref) cursorTimer.unref()
}
// 诊断用：记录渲染层调用过哪些 IPC，用来确认挂件真的在请求数据
const IPC_CALLS = []
function noteCall(name) {
  if (IPC_CALLS.length < 400) IPC_CALLS.push(name)
}

function createWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay()
  // 窗口 = 整个工作区（全屏）。
  //
  // 为什么必须全屏：挂件自身的拖动逻辑会把位置 clamp 到窗口范围
  //   state.left = clamp(drag.origLeft + dx, 0, drag.vp.w - drag.w)
  // 窗口只有 360x460 时，挂件就只能在右下角那一小块里挪 —— 用户要的是
  // 「屏幕任意位置都能拖」，所以窗口必须覆盖整屏，clamp 的范围才等于屏幕。
  //
  // 代价是整屏矩形都会挡住桌面点击，因此必须配合「活动区域 + 动态穿透」：
  // 只有鼠标落在挂件/菜单/面板上时才接管点击，其余全部穿透给桌面。
  const { workArea } = screen.getPrimaryDisplay()
  const W = workArea.width
  const H = workArea.height
  win = new BrowserWindow({
    width: W,
    height: H,
    x: workArea.x,
    y: workArea.y,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    webPreferences: {
      preload: path.join(PROJECT_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.loadFile(path.join(RENDERER_DIR, 'index.html'))
  // 启动鼠标位置轮询，实现"只在挂件上接管点击，其余区域穿透到桌面"
  startCursorWatch()
  win.on('closed', () => {
    if (cursorTimer) { try { clearInterval(cursorTimer) } catch (err) {} cursorTimer = null }
    win = null
  })

  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[桌宠] 页面加载失败:', code, desc)
  })
  // Electron 44 起旧的 (event, level, msg) 形参已废弃，改用事件对象
  win.webContents.on('console-message', (e) => {
    const msg = e && e.message
    if (msg && (String(msg).includes('[dsh-whale]') || e.level === 'error')) {
      console.log('[渲染层]', msg)
    }
  })

  // ---- 诊断模式：截屏后退出，用于在无人值守下确认界面真的渲染出来了 ----
  if (process.env.WHALE_DIAG) {
    const wait = Number(process.env.WHALE_DIAG_WAIT || 12000)
    console.log('[诊断] 等待 ' + wait + 'ms 后截屏...')
    setTimeout(async () => {
      // 顺序很重要：截屏在透明窗口下可能挂起（甚至超过超时保护），
      // 所以把关键的音频/交互诊断放在它前面，避免被拖住。
      // 音频播放链路诊断（关键）：区分「页面从未请求音效」和「请求到了但播不出声」
      try {
        const audio = await win.webContents.executeJavaScript(
          '(function(){try{' +
          'var res=performance.getEntriesByType("resource")' +
          '  .filter(function(e){return e.name.indexOf("/dsh-whale/sound/")>=0})' +
          '  .map(function(e){return {name:e.name.replace(/^.*\\//,""),size:e.transferSize,dur:Math.round(e.duration)}});' +
          'var a=new Audio("/dsh-whale/sound/press.mp3?set=duck");a.volume=0.9;' +
          'return new Promise(function(resolve){' +
          '  var done=false;' +
          '  function finish(extra){if(done)return;done=true;' +
          '    var st={};try{st={src:String(a.src).slice(0,44),readyState:a.readyState,dur:Math.round((a.duration||0)*100)/100,paused:a.paused,err:a.error?a.error.code:null}}catch(e){st={ex:e.message}}' +
          '    resolve(JSON.stringify({srcPatch:window.__srcPatch||null,soundResources:res,audio:st,extra:extra}))}' +
          '  a.addEventListener("loadedmetadata",function(){finish("loadedmetadata")});' +
          '  a.addEventListener("canplay",function(){finish("canplay")});' +
          '  a.addEventListener("error",function(){finish("error")});' +
          '  a.play().then(function(){finish("played")}).catch(function(e){finish("playRejected:"+(e&&e.name))});' +
          '  setTimeout(function(){finish("timeout")},2500);' +
          '})' +
          '}catch(e){return JSON.stringify({err:String(e.message)})}})()'
        )
        console.log('[诊断] 音频播放: ' + audio)
      } catch (err) {
        console.error('[诊断] 音频诊断失败: ' + String(err && err.message))
      }
      // capturePage 在透明窗口 + 受限环境里可能长时间挂起，加超时保护
      try {
        const image = await Promise.race([
          win.capturePage(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('capturePage 超时')), 4000)),
        ])
        const png = image.toPNG()
        const out = path.join(PROJECT_DIR, '_shot.png')
        fs.writeFileSync(out, png)
        console.log('[诊断] 已截屏: ' + out + ' (' + png.length + ' 字节)')
      } catch (err) {
        console.error('[诊断] 截屏失败/超时: ' + String(err && err.message))
      }
      console.log('[诊断] IPC 调用统计: ' + JSON.stringify(IPC_CALLS))
      // 拖动挂件测试：把挂件拖到别处，验证活动区域是否跟随更新。
      // 这正是「拉远后点不动」的根因所在 —— 区域不跟着更新，新位置就被判成空白。
      try {
        const dragTest = await win.webContents.executeJavaScript(
          '(function(){try{' +
          'var img=document.querySelector(".dshwv-img");if(!img)return JSON.stringify({err:"no img"});' +
          'var r=img.getBoundingClientRect();' +
          'var sx=r.left+r.width/2, sy=r.top+r.height/2;' +
          'function ev(t,x,y,b){return new PointerEvent(t,{clientX:x,clientY:y,button:0,buttons:b,pointerId:1,pointerType:"mouse",isPrimary:true,bubbles:true,cancelable:true})}' +
          'document.dispatchEvent(ev("pointerdown",sx,sy,1));' +
          'document.dispatchEvent(ev("pointermove",sx-600,sy-350,1));' +
          'document.dispatchEvent(ev("pointerup",sx-600,sy-350,0));' +
          'return new Promise(function(res){setTimeout(function(){' +
          '  var r2=img.getBoundingClientRect();' +
          '  res(JSON.stringify({before:[Math.round(r.left),Math.round(r.top)],after:[Math.round(r2.left),Math.round(r2.top)],moved:(Math.abs(r2.left-r.left)>50)}))' +
          '},800)})' +
          '}catch(e){return JSON.stringify({err:String(e.message)})}})()'
        )
        console.log('[诊断] 拖动挂件: ' + dragTest)
        await new Promise((r) => setTimeout(r, 500))
      } catch (err) {
        console.error('[诊断] 拖动测试失败: ' + String(err && err.message))
      }
      console.log('[诊断] 活动区域: ' + JSON.stringify({ region: activeRegion, ignoreMouse: ignoreMouse, cursorPolling: !!cursorTimer }))
      if (typeof win.webContents.executeJavaScript === 'function') {
        // 菜单尺寸验证：模拟点击汉堡按钮打开菜单，看窗口是否随之扩展
        try {
          const menuTest = await win.webContents.executeJavaScript(
            '(function(){try{' +
            'var btn=document.querySelector(".dshwv-menu-btn");if(!btn)return JSON.stringify({err:"no menu btn"});' +
            'btn.click();' +
            'return new Promise(function(res){setTimeout(function(){' +
            '  var m=document.querySelector(".dshwv-menu");' +
            '  var mb=m?m.getBoundingClientRect():null;' +
            '  var cs=getComputedStyle(document.documentElement).getPropertyValue("--whale-chat-bottom");' +
            '  var ch=document.querySelector(".dshwv-chat");var cr=ch?ch.getBoundingClientRect():null;' +
            '  var im=document.querySelector(".dshwv-img");var ir=im?im.getBoundingClientRect():null;' +
            '  res(JSON.stringify({' +
            '    menuTop:mb?Math.round(mb.top):null, menuBottom:mb?Math.round(mb.bottom):null, winH:window.innerHeight,' +
            '    chatBottomVar:cs?cs.trim():null,' +
            '    chatTop:cr&&cr.height?Math.round(cr.top):null, chatBottom:cr&&cr.height?Math.round(cr.bottom):null, chatH:cr?Math.round(cr.height):0,' +
            '    imgTop:ir?Math.round(ir.top):null, imgBottom:ir?Math.round(ir.bottom):null,' +
            '    overlap:(cr&&cr.height&&ir)?(cr.bottom>ir.top):null' +
            '  }))' +
            '},700)})' +
            '}catch(e){return JSON.stringify({err:String(e.message)})}})()'
          )
          console.log('[诊断] 菜单/对话框: ' + menuTest)
        } catch (err) {
          console.error('[诊断] 菜单测试失败: ' + String(err && err.message))
        }
        // 音效映射验证：挂件请求的是语义名，主进程要映射到真实文件
        try {
          const snd = {}
          for (const u of ['/dsh-whale/sound/press.mp3?set=duck', '/dsh-whale/sound/release.mp3?set=duck',
                           '/dsh-whale/sound/press.mp3?set=fx1', '/dsh-whale/sound/release.mp3?set=fx1']) {
            const r = await handleAsset(u)
            snd[u.replace('/dsh-whale/sound/', '')] = r.status + (r.body ? '/' + r.body.length + 'B' : '')
          }
          console.log('[诊断] 音效资源: ' + JSON.stringify(snd))
        } catch (err) {
          console.error('[诊断] 音效验证失败: ' + String(err && err.message))
        }
        // 对话框避让验证：菜单关闭状态下打开对话面板，量它与挂件形象是否重叠。
        // 之前的 bug 正是面板 bottom:18px 压在形象上（用户反馈"盖住大肥鱼"）。
        try {
          const chatPos = await win.webContents.executeJavaScript(
            '(function(){try{' +
            'var m=document.querySelector(".dshwv-menu");' +
            'if(m&&m.className.indexOf("dshwv-menu-open")>=0){var b=document.querySelector(".dshwv-menu-btn");if(b)b.click();}' +
            'return new Promise(function(res){setTimeout(function(){' +
            '  var c=document.querySelector(".dshwv-chat");var im=document.querySelector(".dshwv-img");' +
            '  var out={};' +
            '  if(c){c.classList.add("dshwv-chat-open");var cr=c.getBoundingClientRect();var ir=im?im.getBoundingClientRect():null;' +
            '    out.chatBottom=Math.round(cr.bottom);out.chatTop=Math.round(cr.top);out.chatH=Math.round(cr.height);' +
            '    out.imgTop=ir?Math.round(ir.top):null;out.imgBottom=ir?Math.round(ir.bottom):null;' +
            '    out.winH=window.innerHeight;' +
            '    out.overlapsImage=(ir&&cr.height>0)?(cr.bottom>ir.top):null;' +
            '    c.classList.remove("dshwv-chat-open");' +
            '  } else { out.err="no chat el" }' +
            '  res(JSON.stringify(out))' +
            '},900)})' +
            '}catch(e){return JSON.stringify({err:String(e.message)})}})()'
          )
          console.log('[诊断] 对话框避让: ' + chatPos)
        } catch (err) {
          console.error('[诊断] 对话框验证失败: ' + String(err && err.message))
        }
        try {
          // 用字符串拼接构造（避免嵌套模板字符串带来的阅读与转义风险）
          const script = '(function(){' +
            'var r=document.querySelector(".dshwv-root");' +
            'var img=document.querySelector(".dshwv-img");' +
            'var c=document.querySelector(".dshwv-chat");' +
            'var m=document.querySelector(".dshwv-menu");' +
            'var b=document.querySelector(".dshwv-bubble");' +
            'var st=document.querySelector("style");' +
            'var out={};' +
            'out.win={w:innerWidth,h:innerHeight,dpr:devicePixelRatio};' +
            'out.root=r?{cls:r.className,vis:getComputedStyle(r).visibility,disp:getComputedStyle(r).display,rect:[Math.round(r.getBoundingClientRect().left),Math.round(r.getBoundingClientRect().top),Math.round(r.getBoundingClientRect().width),Math.round(r.getBoundingClientRect().height)]}:null;' +
            'out.img=img?{natural:img.naturalWidth,src:String(img.src).slice(0,60)}:null;' +
            'out.chat=c?{cls:c.className,disp:getComputedStyle(c).display,rect:[Math.round(c.getBoundingClientRect().width),Math.round(c.getBoundingClientRect().height)]}:null;' +
            'out.menu=m?{cls:m.className,op:getComputedStyle(m).opacity,disp:getComputedStyle(m).display}:null;' +
            'out.bubble=b?{cls:b.className}:null;' +
            'var lbl=document.querySelector(".dshwv-label");var amt=document.querySelector(".dshwv-amount");var hint=document.querySelector(".dshwv-hint");' +
            'out.bubbleText={label:lbl?lbl.textContent:"",amount:amt?amt.textContent:"",hint:hint?hint.textContent:"",all:((document.querySelector(".dshwv-text")||{}).textContent||"")};' +
            'out.styleTagCount=document.querySelectorAll("style").length;' +
            'out.cssLen=st?st.textContent.length:0;' +
            'out.cssHasChatNone=st?st.textContent.indexOf(".dshwv-chat{")>=0:false;' +
            'out.bodyChildren=[];' +
            'for(var i=0;i<document.body.children.length;i++){var ch=document.body.children[i];out.bodyChildren.push(ch.className||ch.tagName)}' +
            'return JSON.stringify(out)' +
            '})()'
          const info = await win.webContents.executeJavaScript(script)
          console.log('[诊断] 页面状态: ' + info)
          // 把真实 CSS 导出来，用于确认挂件样式是否真的注入成功
          try {
            const css = await win.webContents.executeJavaScript(
              '(function(){var ss=document.querySelectorAll("style");var a=[];for(var i=0;i<ss.length;i++){a.push(String(ss[i].textContent||""))}return JSON.stringify(a)})()'
            )
            const arr = JSON.parse(css)
            const total = arr.reduce((n, s) => n + s.length, 0)
            console.log('[诊断] style 标签数=' + arr.length + ' 合计长度=' + total)
            for (let i = 0; i < arr.length; i++) {
              console.log('[诊断] style[' + i + '] 长度=' + arr[i].length + ' 开头=' + JSON.stringify(arr[i].slice(0, 150)))
            }
            fs.writeFileSync(path.join(PROJECT_DIR, '_diag-css.txt'), arr.join('\n\n/* ---- next style ---- */\n\n'), 'utf8')
          } catch (err) {
            console.error('[诊断] 导出 CSS 失败: ' + String(err && err.message))
          }
          // 命中检测与音效诊断：
          // 按压反馈（图片弹簧 + 音效）依赖 isWhaleHit()，而它要求 hitReady === true，
          // 后者来自 setupHitTest 里 probe.onload 的 drawImage。若图片是异步 blob，
          // drawImage 时图还没就绪，hitReady 永远 false，所有按压都会失效。
          try {
            const probe = await win.webContents.executeJavaScript(
              '(function(){try{' +
              'var r=document.querySelector(".dshwv-root");if(!r)return JSON.stringify({err:"no root"});' +
              'var b=r.getBoundingClientRect();' +
              // 鲸鱼图在 root 的右下 59.45%，取该区域内一点做命中测试
              'var x=b.left+b.width*0.72, y=b.top+b.height*0.72;' +
              'var el=document.elementFromPoint(x,y);' +
              'var info={point:[Math.round(x),Math.round(y)],el:el?(el.className||el.tagName):null};' +
              'if(window.__whaleDiag&&typeof window.__whaleDiag.isWhaleHit==="function"){' +
              '  info.hit=window.__whaleDiag.isWhaleHit({clientX:x,clientY:y});' +
              '}else{info.hit="no-hook"}' +
              'var as=document.querySelectorAll("audio");info.audioEls=as.length;' +
              'info.imgSrcNow=String((document.querySelector(".dshwv-img")||{}).src||"").slice(0,40);' +
              'return JSON.stringify(info)' +
              '}catch(e){return JSON.stringify({err:String(e.message)})}})()'
            )
            console.log('[诊断] 命中/音效: ' + probe)
          } catch (err) {
            console.error('[诊断] 命中检测失败: ' + String(err && err.message))
          }
          // 按压反馈实验：用 sendInputEvent 模拟真实鼠标输入（比 dispatchEvent 更接近实际），
          // 检验点击是否能真正到达页面并触发换图。
          // 必须先确保菜单关闭：挂件在 menuOpen 时会走"关菜单"分支并 return。
          try {
            const geo = await win.webContents.executeJavaScript(
              '(function(){var r=document.querySelector(".dshwv-root").getBoundingClientRect();' +
              'var m=document.querySelector(".dshwv-menu");' +
              'if(m&&m.className.indexOf("dshwv-menu-open")>=0){' +
              '  var b=document.querySelector(".dshwv-menu-btn"); if(b)b.click();' +
              '}' +
              'return JSON.stringify({' +
              'cx:Math.round(r.left+r.width*0.72), cy:Math.round(r.top+r.height*0.72),' +
              'rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)],' +
              'dpr:window.devicePixelRatio})})()'
            )
            const g = JSON.parse(geo)
            await new Promise((r) => setTimeout(r, 700))   // 等菜单关闭动画走完
            // 用合成 PointerEvent 精确控制 clientX/clientY。
            // 为什么不用 sendInputEvent：它的坐标单位在缩放环境下不确定，
            // 实测会被解释成窗口左上角附近（cx=61），点不到鲸鱼身上，
            // 于是把"我的测试点偏了"误读成"命中逻辑坏了"。
            const pressResult = await win.webContents.executeJavaScript(
              '(function(){try{' +
              'var imgEl=document.querySelector(".dshwv-img");' +
              'var ir=imgEl.getBoundingClientRect();' +
              // 鲸鱼身体放在 img 元素中部偏下
              'var px=ir.left+ir.width*0.5, py=ir.top+ir.height*0.62;' +
              'var before=String(imgEl.src||"");' +
              'var opts={bubbles:true,cancelable:true,clientX:px,clientY:py,button:0,buttons:1,pointerId:1,pointerType:"mouse",isPrimary:true};' +
              'document.dispatchEvent(new PointerEvent("pointerdown",opts));' +
              'return new Promise(function(res){setTimeout(function(){' +
              '  var during=String(imgEl.src||"");' +
              '  document.dispatchEvent(new PointerEvent("pointerup",Object.assign({},opts,{buttons:0})));' +
              '  res(JSON.stringify({' +
              '    point:[Math.round(px),Math.round(py)], imgRect:[Math.round(ir.left),Math.round(ir.top),Math.round(ir.width),Math.round(ir.height)],' +
              '    before:before.slice(0,44), during:during.slice(0,44), changed:before!==during,' +
              '    pd:window.__pd||null, hitLog:(window.__hitLog||[]).slice(-2)' +
              '  }))' +
              '},420)})' +
              '}catch(e){return JSON.stringify({err:String(e.message)})}})()'
            )
            console.log('[诊断] 按压坐标实验: ' + pressResult)
          } catch (err) {
            console.error('[诊断] 按压实验失败: ' + String(err && err.message))
          }
        } catch (err) {
          console.error('[诊断] 读取页面状态失败: ' + String(err && err.message))
        }
      }
      app.quit()
    }, wait)
  }
}

// ---------------------------------------------------------------------------
// 重启支持：再次启动时先结束上一个实例。
//
// 为什么不做成单实例锁：应用出现过卡死（鼠标轮询打满 CPU 后界面无响应），
// 那种情况下单实例锁只会让新启动的实例立刻退出，用户仍然只能去任务管理器强杀。
// 这里改成"杀旧启新"：再点一次启动器就是一个可用的后手。
// ---------------------------------------------------------------------------
const PID_FILE = path.join(PROJECT_DIR, '.whale-pid')

function killPreviousInstance() {
  let oldPid = 0
  try {
    oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10)
  } catch (err) {
    return   // 没有记录，说明上次正常退出
  }
  if (!oldPid || oldPid === process.pid) return
  // 先探测是否还活着（信号 0 只做存在性检查）
  let alive = true
  try { process.kill(oldPid, 0) } catch (err) { alive = false }
  if (!alive) return
  // Electron 有主进程 + GPU + 多个渲染进程，必须连整棵进程树一起结束，
  // 否则残留的子进程会继续占着 CPU（曾观察到 20s+/25s 的占用）。
  try {
    execSync('taskkill /F /T /PID ' + oldPid, { stdio: 'ignore', timeout: 8000 })
  } catch (err) {}
}

function writePidFile() {
  try { fs.writeFileSync(PID_FILE, String(process.pid), 'utf8') } catch (err) {}
}

function clearPidFile() {
  try {
    const cur = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10)
    if (cur === process.pid) fs.unlinkSync(PID_FILE)
  } catch (err) {}
}

killPreviousInstance()
writePidFile()
app.on('will-quit', clearPidFile)

app.whenReady().then(() => {
  ipcMain.handle('whale:getConfig', () => {
    const cfg = readConfig()
    return {
      hasApiKey: !!getApiKey(),
      scale: typeof cfg.scale === 'number' ? cfg.scale : 1.5,
      exprVer: IMG_VERSIONS.includes(cfg.exprVer) ? cfg.exprVer : 'v2',
      model: CHAT_MODELS.includes(cfg.model) ? cfg.model : CHAT_MODEL,
      soundOn: cfg.soundOn !== false,
      vol: typeof cfg.vol === 'number' ? cfg.vol : 0.9,
    }
  })
  ipcMain.handle('whale:saveConfig', (_e, patch) => {
    const cfg = readConfig()
    Object.assign(cfg, patch || {})
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8'); return { ok: true } } catch (err) {
      return { ok: false, error: String(err.message) }
    }
  })
  ipcMain.handle('whale:asset', (_e, url) => { noteCall('asset ' + String(url).slice(0, 70)); return handleAsset(url) })
  ipcMain.handle('whale:api', (_e, pathname, payload) => { noteCall('api ' + pathname); return handleApi(pathname, payload) })
  ipcMain.handle('whale:chatStream', (e, payload, streamId) => handleChatStream(payload, e.sender, streamId))
  ipcMain.handle('whale:createSession', (_e, id) => {
    if (!validId(id)) return { ok: false, error: '无效 id' }
    const exist = readSession(id)
    if (exist) return { ok: true, created: exist }
    const now = Date.now()
    const s = { id, title: '新对话', messages: [], createdAt: now, updatedAt: now }
    writeSession(s)
    const idx = readIndex()
    idx.sessions.unshift({ id, title: s.title, createdAt: now, updatedAt: now })
    idx.activeId = id
    writeIndex(idx)
    return { ok: true, created: s }
  })
  ipcMain.handle('whale:deleteSession', (_e, id) => {
    if (!validId(id)) return { ok: false }
    try { fs.unlinkSync(chatSessionPath(id)) } catch (err) {}
    const idx = readIndex()
    idx.sessions = idx.sessions.filter((s) => s.id !== id)
    if (idx.activeId === id) idx.activeId = idx.sessions.length ? idx.sessions[0].id : null
    writeIndex(idx)
    return { ok: true, activeId: idx.activeId }
  })
  ipcMain.handle('whale:setActiveRegion', (_e, r) => {
    if (r && typeof r === 'object') {
      activeRegion = {
        x: Number(r.x) || 0, y: Number(r.y) || 0,
        w: Number(r.w) || 0, h: Number(r.h) || 0,
      }
    }
    return { ok: true }
  })
  ipcMain.handle('whale:quit', () => { app.quit() })
  ipcMain.handle('whale:openExternal', (_e, url) => {
    if (/^https?:\/\//.test(String(url))) shell.openExternal(String(url))
  })
  // 窗口级拖拽：渲染层算好增量（屏幕坐标），这里直接改窗口位置
  ipcMain.handle('whale:moveWindow', (_e, dx, dy) => {
    if (!win) return { ok: false }
    const b = win.getBounds()
    win.setBounds({
      x: Math.round(b.x + Number(dx || 0)),
      y: Math.round(b.y + Number(dy || 0)),
      width: b.width,
      height: b.height,
    })
    return { ok: true }
  })
  // 鼠标穿透：平时让空白区域不挡桌面操作，悬停在挂件上时再接管点击
  ipcMain.handle('whale:setInteractive', (_e, on) => {
    if (!win) return { ok: false }
    try {
      if (on) win.setIgnoreMouseEvents(false)
      else win.setIgnoreMouseEvents(true, { forward: true })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err.message) }
    }
  })
  // 设置菜单很长（约 560px），而常驻窗口只有 460 高，底部会被裁掉。
  // 菜单/面板打开时把窗口扩大；但屏幕上方空间不足时（用户把挂件拖到屏幕上方），
  // 不能把 top 夹到 0 —— 那会把窗口压扁，导致菜单被裁、挂件被挤出可见区。
  // 因此空间不足时改为保留 top 向下扩展，最坏情况占满整个工作区高度。
  ipcMain.handle('whale:setWindowSize', (_e, w, h) => {
    if (!win) return { ok: false }
    try {
      const b = win.getBounds()
      const disp = screen.getDisplayNearestPoint({ x: b.x, y: b.y })
      const wa = disp.workArea
      const nw = Math.max(300, Math.round(Number(w) || b.width))
      let nh = Math.max(200, Math.round(Number(h) || b.height))
      const bottom = b.y + b.height
      // 优先向上扩展（底边不动，挂件位置因此不变）
      let top = bottom - nh
      if (top < wa.y) {
        // 上方放不下：改为保留 top 向下扩展
        top = b.y
        if (top + nh > wa.y + wa.height) {
          // 下方也放不下：占满工作区高度，而不是把窗口压扁
          top = wa.y
          nh = wa.height
        }
      }
      win.setBounds({ x: b.x, y: top, width: nw, height: nh })
      return { ok: true, bounds: win.getBounds(), workArea: wa }
    } catch (err) {
      return { ok: false, error: String(err.message) }
    }
  })
  // 工作区高度：渲染层据此决定菜单/面板展开时窗口该多大
  ipcMain.handle('whale:getWorkArea', () => {
    try {
      const disp = win ? screen.getDisplayNearestPoint(win.getBounds()) : screen.getPrimaryDisplay()
      return disp.workArea
    } catch (err) {
      return { x: 0, y: 0, width: 1920, height: 1080 }
    }
  })

  createWindow()

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { app.quit() })
