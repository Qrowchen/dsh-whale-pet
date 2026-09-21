// 离线自测：在 Node 里用最小 DOM 桩跑真正的 renderer/widget.js，
// 验证「台词/峰谷表情会一直保持到气泡消失」以及「自动眨眼/卖萌不会把它顶掉」。
//
// 为什么值得这么麻烦：这件事肉眼最容易看错 —— 眨眼在 0ms 切 half_closed_eyes、
// 130ms 切 close_eyes、280ms 才调 exprApplyIcon() 回来，中间那 280ms 的闭眼帧
// 看起来就像"表情一秒不到就恢复了"。只有把虚拟时钟拨进去逐帧看 __curImgSrc，
// 才能确定到底是"没锁住"还是"锁住了但被眨眼中间帧盖了一下"。
//
// 用法: node test-expr-lock.mjs

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, 'renderer', 'widget.js')
let code = readFileSync(SRC, 'utf8')

// 反向对照：把眨眼中间帧的 manualExpr 判断摘掉，用来证明本测试真的能抓到那个
// 150ms 抢占窗口（一个永远通过的测试等于没有测试）。
const NO_GUARD = process.argv.includes('--no-guard')
if (NO_GUARD) {
  const guarded = "if (mood === 'normal' && !pressing && !manualExpr)"
  const n = code.split(guarded).length - 1
  code = code.split(guarded).join("if (mood === 'normal' && !pressing)")
  console.log('[反向对照模式] 已摘掉 ' + n + ' 处 manualExpr 眨眼判断\n')
}

// ---------------------------------------------------------------------------
// 虚拟时钟：挂件只用 setTimeout/setInterval，所以可以完全确定性地推进时间
// ---------------------------------------------------------------------------
let now = 0
let seq = 0
const timers = new Map()
const realSetImmediate = setImmediate

function vSetTimeout(fn, ms) {
  const id = ++seq
  timers.set(id, { id, at: now + (Number(ms) || 0), fn, every: null, dead: false })
  return id
}
function vSetInterval(fn, ms) {
  const id = ++seq
  const every = Math.max(1, Number(ms) || 1)
  timers.set(id, { id, at: now + every, fn, every, dead: false })
  return id
}
function vClear(id) {
  const t = timers.get(id)
  if (t) t.dead = true
  timers.delete(id)
}
const flush = () => new Promise((r) => realSetImmediate(r))

async function tick(ms) {
  const target = now + ms
  for (;;) {
    let next = null
    for (const t of timers.values()) {
      if (t.dead || t.at > target) continue
      if (!next || t.at < next.at || (t.at === next.at && t.id < next.id)) next = t
    }
    if (!next) break
    now = next.at
    if (next.every != null) next.at = now + next.every
    else vClear(next.id)
    try { next.fn() } catch (err) { runtimeErrors.push(err) }
    await flush()   // 让 onload / fetch 的微任务落地
  }
  now = target
  await flush()
}

const runtimeErrors = []

// ---------------------------------------------------------------------------
// 最小 DOM 桩
// ---------------------------------------------------------------------------
const listeners = new WeakMap()

class ClassList {
  constructor(el) { this.el = el; this.set = new Set() }
  add(...c) { c.forEach((x) => x && this.set.add(x)) }
  remove(...c) { c.forEach((x) => this.set.delete(x)) }
  contains(c) { return this.set.has(c) }
  toggle(c, f) { const on = f === undefined ? !this.set.has(c) : !!f; on ? this.set.add(c) : this.set.delete(c); return on }
  get length() { return this.set.size }
}

class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase()
    this.nodeName = this.tagName
    this.style = new Proxy({ cssText: '', setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }, {
      get: (t, k) => (k in t ? t[k] : ''),
      set: (t, k, v) => { t[k] = v; return true },
    })
    this.classList = new ClassList(this)
    this.dataset = {}
    this.attributes = {}
    this.children = []
    this.childNodes = this.children
    this.parentNode = null
    this.textContent = ''
    this._html = ''
    this.width = 610
    this.height = 610
    this.clientWidth = 610
    this.clientHeight = 610
    this.offsetWidth = 610
    this.offsetHeight = 610
    this.scrollWidth = 610
    this.scrollHeight = 610
    this.naturalWidth = 610
    this.naturalHeight = 610
    this.complete = true
    this.id = ''
    this.className = ''
    this.value = ''
    this.disabled = false
    this.hidden = false
    this.src = ''
    this.href = ''
    this.onload = null
    this.onerror = null
  }
  get innerHTML() { return this._html }
  set innerHTML(v) { this._html = String(v); this.children.length = 0 }
  appendChild(c) { if (!c) return c; c.parentNode = this; this.children.push(c); return c }
  insertBefore(c, ref) { const i = this.children.indexOf(ref); this.children.splice(i < 0 ? 0 : i, 0, c); c.parentNode = this; return c }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c }
  replaceChild(n, o) { const i = this.children.indexOf(o); if (i >= 0) this.children[i] = n; return o }
  remove(arg) {
    // select.remove(0) 按下标删选项；无参时删除自身
    if (typeof arg === 'number') { const c = this.children[arg]; if (c) this.removeChild(c); return }
    if (this.parentNode) this.parentNode.removeChild(this)
  }
  get options() { return this.children }
  contains(n) { return n === this || this.children.includes(n) }
  closest(sel) {
    // 只用到 .dshwv-* 类选择器
    const cls = String(sel).replace(/^\./, '')
    let n = this
    while (n) { if (n.classList && n.classList.contains(cls)) return n; n = n.parentNode }
    return null
  }
  querySelector(sel) {
    const cls = String(sel).replace(/^\./, '')
    const walk = (n) => { for (const c of n.children) { if (c.classList && c.classList.contains(cls)) return c; const r = walk(c); if (r) return r } return null }
    return walk(this)
  }
  querySelectorAll() { return [] }
  getElementsByTagName() { return [] }
  setAttribute(k, v) { this.attributes[k] = String(v) }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null }
  removeAttribute(k) { delete this.attributes[k] }
  hasAttribute(k) { return k in this.attributes }
  addEventListener(type, fn) {
    if (!listeners.has(this)) listeners.set(this, new Map())
    const m = listeners.get(this)
    if (!m.has(type)) m.set(type, [])
    m.get(type).push(fn)
  }
  removeEventListener(type, fn) {
    const m = listeners.get(this)
    if (!m || !m.has(type)) return
    m.set(type, m.get(type).filter((f) => f !== fn))
  }
  dispatchEvent(ev) {
    const m = listeners.get(this)
    const list = m && m.get(ev.type) ? m.get(ev.type).slice() : []
    for (const fn of list) {
      try { fn.call(this, ev) } catch (err) { runtimeErrors.push(err) }
    }
    return true
  }
  // 点击辅助：冒泡到父节点（挂件在 bubbleBox 上直接监听，够用）
  click() { this.dispatchEvent(makeEvent('click', this)) }
  getBoundingClientRect() { return { left: 900, top: 400, right: 1510, bottom: 1010, width: 610, height: 610, x: 900, y: 400 } }
  getContext() {
    return {
      drawImage() {}, clearRect() {}, fillRect() {}, save() {}, restore() {}, scale() {}, translate() {},
      getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1 }),
      putImageData() {}, createImageData: () => ({ data: new Uint8ClampedArray(4) }), setTransform() {},
    }
  }
  toDataURL() { return 'data:image/png;base64,' }
  focus() {} blur() {} scrollIntoView() {} prepend(c) { this.children.unshift(c) } append(...c) { c.forEach((x) => this.appendChild(x)) }
  insertAdjacentHTML() {} cloneNode() { return new El(this.tagName) }
  animate() { return { cancel() {}, finish() {}, addEventListener() {} } }
}

function makeEvent(type, target, extra = {}) {
  return Object.assign({
    type, target, currentTarget: target, bubbles: true, cancelable: true,
    defaultPrevented: false, button: 0, pointerType: 'mouse', clientX: 0, clientY: 0,
    stopPropagation() {}, stopImmediatePropagation() {}, preventDefault() { this.defaultPrevented = true },
  }, extra)
}

const documentStub = new El('#document')
documentStub.documentElement = new El('html')
documentStub.head = new El('head')
documentStub.body = new El('body')
documentStub.readyState = 'complete'
documentStub.hidden = false
documentStub.visibilityState = 'visible'
documentStub.createElement = (t) => (t === 'canvas' ? Object.assign(new El('canvas'), { width: 610, height: 610 }) : new El(t))
documentStub.createTextNode = (t) => { const n = new El('#text'); n.nodeType = 3; n.textContent = String(t); return n }
documentStub.createElementNS = (ns, t) => new El(t)
documentStub.createDocumentFragment = () => new El('#fragment')
documentStub.getElementById = () => null
documentStub.querySelector = () => null
documentStub.querySelectorAll = () => []
documentStub.addEventListener = () => {}
documentStub.removeEventListener = () => {}

class ImageStub extends El {
  constructor(w, h) { super('img'); if (w) this.width = w; if (h) this.height = h }
  set src(v) {
    this._src = v
    // 图片"加载完成"是异步的，用虚拟时钟 0ms 模拟
    vSetTimeout(() => { if (this.onload) { try { this.onload() } catch (e) { runtimeErrors.push(e) } } }, 0)
  }
  get src() { return this._src }
}
class AudioStub {
  constructor(src) { this.src = src; this.volume = 1; this.currentTime = 0; this.paused = true }
  play() { return Promise.resolve() }
  pause() {}
  cloneNode() { return new AudioStub(this.src) }
  addEventListener() {} removeEventListener() {}
}

const store = new Map()
const storage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(String(k), String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size },
}

// balance.json / last-turn.json 的最小可用响应，让 render() 拿到真实数值
const BALANCE = {
  ok: true, available: true, currency: 'CNY',
  balance: 103.21, todayUsage: 0.35, isPeak: false,
  groups: [], mode: 'normal', updatedAt: new Date().toISOString(),
}

async function fetchStub(url) {
  const u = String(url)
  const body = u.includes('balance.json') ? BALANCE
    : u.includes('size.json') ? { scale: 1 }
      : u.includes('last-turn') ? { amount: 0 }
        : {}
  return {
    ok: true, status: 200, statusText: 'OK',
    json: async () => body, text: async () => JSON.stringify(body),
    headers: { get: () => 'application/json' }, clone() { return this },
  }
}

const sandbox = {
  console: { log() {}, warn() {}, error(...a) { runtimeErrors.push(a.map(String).join(' ')) }, info() {}, debug() {} },
  setTimeout: vSetTimeout, clearTimeout: vClear, setInterval: vSetInterval, clearInterval: vClear,
  requestAnimationFrame: (fn) => vSetTimeout(() => fn(now), 16), cancelAnimationFrame: vClear,
  fetch: fetchStub,
  Image: ImageStub, Audio: AudioStub,
  localStorage: storage, sessionStorage: storage,
  document: documentStub,
  location: { href: 'http://127.0.0.1:3080/', origin: 'http://127.0.0.1:3080', hostname: '127.0.0.1', pathname: '/', protocol: 'http:', search: '', hash: '' },
  navigator: { userAgent: 'node-test', language: 'zh-CN', platform: 'Win32' },
  performance: { now: () => now },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  MutationObserver: class { observe() {} disconnect() {} takeRecords() { return [] } },
  Uint8ClampedArray, Promise, JSON, Math, Date, Object, Array, String, Number, Boolean, Error, RegExp,
  __DSH_BOOT__: undefined,
}
sandbox.window = sandbox
sandbox.self = sandbox
sandbox.globalThis = sandbox
sandbox.window.innerWidth = 1920
sandbox.window.innerHeight = 1080
sandbox.window.devicePixelRatio = 1
sandbox.window.addEventListener = () => {}
sandbox.window.removeEventListener = () => {}
sandbox.window.dispatchEvent = () => true

// ---------------------------------------------------------------------------
// 跑起来
// ---------------------------------------------------------------------------
const ctx = vm.createContext(sandbox)
let initError = null
try {
  new vm.Script(code, { filename: 'widget.js' }).runInContext(ctx)
} catch (err) {
  initError = err
}

// ---------------------------------------------------------------------------
// 断言
// ---------------------------------------------------------------------------
// 表情图 URL 形如 /dsh-whale/expr?name=shy&ver=v2，默认图是 /dsh-whale/image.png
function imgName(u) {
  if (!u) return '(空)'
  const m = /[?&]name=([^&]+)/.exec(u)
  if (m) return decodeURIComponent(m[1])
  return String(u).split('/').pop().split('?')[0]
}

const results = []
function check(name, pass, detail) {
  results.push({ name, pass, detail })
}

async function main() {
  if (initError) {
    console.log('挂件初始化抛错: ' + initError.message)
    console.log(initError.stack)
    process.exit(1)
  }

  await tick(50)
  const probe = sandbox.__whaleProbe
  if (!probe) {
    console.log('探针未挂载 —— 说明 IIFE 没跑到结尾（初始化中途抛错或提前 return）')
    console.log('已捕获的运行时错误:', runtimeErrors.slice(0, 8).map(String))
    process.exit(1)
  }
  console.log('初始素材版本: ' + probe.ver + '，初始图: ' + imgName(probe.curImg))

  // ---- 场景 1：台词表情锁住后，跨过眨眼/卖萌窗口仍然不变 --------------------
  probe.applyBubbleExpr('shy')
  await tick(10)
  const lockedImg = probe.curImg
  check('applyBubbleExpr 后立刻生效', imgName(lockedImg) === 'shy', imgName(lockedImg))
  check('manualExpr 已上锁', probe.manualExpr === 'shy', String(probe.manualExpr))

  // 连续推进 12 秒（足够触发 1~3 次眨眼 + 可能的卖萌）
  const seen = new Set()
  for (let i = 0; i < 120; i++) {
    await tick(100)
    seen.add(imgName(probe.curImg))
  }
  const unexpected = [...seen].filter((n) => n && n !== 'shy')
  check('12 秒内表情未被眨眼/卖萌顶掉', unexpected.length === 0, unexpected.length ? '出现过: ' + unexpected.join(',') : '始终 shy')

  // ---- 场景 1b：眨眼动画播到一半时上锁，中间帧不能抢占 --------------------
  // 这是"一闪就没了"最可能的成因：0ms 半闭眼 / 130ms 全闭眼 / 280ms 复原，
  // 用户恰好在这 130ms 内点开表情，全闭眼那一帧会盖住刚上的台词表情。
  //
  // 前提：exprDoBlink 会先做 exprImgReady 检查，图没进缓存就直接 return。
  // 不预热的话下面整段是空跑 —— 一个"永远通过"的测试比没有测试更糟。
  probe.releaseBubbleExpr()
  for (const n of ['half_closed_eyes', 'close_eyes']) {
    probe.applyBubbleExpr(n)
    await tick(20)
  }
  probe.releaseBubbleExpr()
  await tick(20)

  // 先证明眨眼确实会播（否则下面的"不受影响"毫无意义）
  probe.exprDoBlink()
  await tick(140)
  const blinkMid = imgName(probe.curImg)
  await tick(200)
  check('眨眼动画确实播放（130ms 处为 close_eyes）', blinkMid === 'close_eyes', '130ms 时=' + blinkMid)

  probe.releaseBubbleExpr()
  await tick(5)
  probe.exprDoBlink()                    // 起手打一次眨眼
  probe.applyBubbleExpr('proud')         // 眨眼刚起手就上锁
  await tick(10)
  const afterLock = imgName(probe.curImg)
  await tick(140)                        // 越过 130ms 那个中间帧
  const midFrame = imgName(probe.curImg)
  await tick(200)                        // 越过 280ms 复原点
  const settled = imgName(probe.curImg)
  check('眨眼起手后上锁不被 130ms 中间帧抢走', midFrame !== 'close_eyes', '130ms 时=' + midFrame)
  check('眨眼结束后仍保持锁定表情', settled === 'proud', '280ms 后=' + settled)
  check('上锁瞬间即为目标表情', afterLock === 'proud', afterLock)

  // ---- 场景 2：气泡关闭（hideBubble）才解除锁 ------------------------------
  check('解除前仍锁定', probe.manualExpr === 'proud', String(probe.manualExpr))
  probe.showBubble()
  await tick(10)
  check('showBubble 后气泡可见', probe.shown === true, String(probe.shown))
  check('showBubble 不解除表情锁', probe.manualExpr === 'proud', String(probe.manualExpr))

  probe.hideBubble()
  await tick(10)
  check('hideBubble 解除表情锁', probe.manualExpr === null, String(probe.manualExpr))
  check('hideBubble 后气泡不可见', probe.shown === false, String(probe.shown))

  // ---- 场景 3：点击三态走满一轮，表情保持到气泡消失 ------------------------
  store.set('dsh-whale-expr-ver', 'v2')
  const box = probe.bubbleBox
  probe.applyBubbleExpr('proud')
  await tick(10)
  probe.showBubble()
  await tick(10)

  const stage0 = probe.stage
  box.click()                       // 1 击 -> 峰谷
  await tick(10)
  const stage1 = probe.stage
  const peakImg = imgName(probe.curImg)
  box.click()                       // 2 击 -> 台词
  await tick(10)
  const stage2 = probe.stage
  const lineImg = imgName(probe.curImg)
  box.click()                       // 3 击 -> 关闭
  await tick(10)

  check('三态顺序 0 -> 1 -> 2', stage0 === 0 && stage1 === 1 && stage2 === 2, `${stage0}->${stage1}->${stage2}`)
  check('第三态关闭了气泡', probe.shown === false, String(probe.shown))
  check('关闭后表情解锁', probe.manualExpr === null, String(probe.manualExpr))
  console.log('  峰谷态表情=' + peakImg + ', 台词态表情=' + lineImg + ' (ver=' + probe.ver + ')')

  // ---- 场景 4：每个素材版本的表情名都存在（不存在会静默跳过） --------------
  // 从挂件自己的 EXPR_LISTS 反推：给出语义名后必须真的换图
  const VER_SKIP = []
  for (const ver of ['v1', 'v2', 'v3', 'v4']) {
    probe.setVer(ver)
    for (const sem of ['proud', 'shy', 'bored', 'wronged', 'greet', 'shocked', 'sleepy', 'angry', 'question', 'mock', 'grit', 'happy']) {
      probe.releaseBubbleExpr()
      await tick(5)
      const before = probe.curImg
      probe.applyLineExpr(sem)
      await tick(20)
      if (probe.curImg === before) VER_SKIP.push(ver + ':' + sem)
      probe.releaseBubbleExpr()
      await tick(5)
    }
    for (const pk of [true, false]) {
      probe.releaseBubbleExpr()
      await tick(5)
      const before = probe.curImg
      probe.applyPeakExpr(pk)
      await tick(20)
      if (probe.curImg === before) VER_SKIP.push(ver + ':peak=' + pk)
      probe.releaseBubbleExpr()
      await tick(5)
    }
  }
  check('所有版本 / 所有语义表情都能落到真图', VER_SKIP.length === 0, VER_SKIP.length ? '未生效: ' + VER_SKIP.join(', ') : '全部命中')
  probe.setVer('v2')

  // ---- 场景 5：气泡自动关闭时间 --------------------------------------------
  probe.releaseBubbleExpr()
  probe.showBubble()
  await tick(4900)
  check('4.9 秒时气泡还在', probe.shown === true, String(probe.shown))
  await tick(200)
  check('5.1 秒时气泡自动关闭', probe.shown === false, String(probe.shown))

  // ---- 场景 6：点击会重置计时（切到台词后有完整的 5 秒） --------------------
  probe.showBubble()
  await tick(4800)
  probe.bubbleBox.click()          // 4.8s 时切到峰谷，应重新计时
  await tick(300)
  check('点击后计时被重置（5.1s 仍在）', probe.shown === true, String(probe.shown))
  await tick(4900)
  check('重置后 5.2s 才关闭', probe.shown === false, String(probe.shown))

  // ---- 输出 ----------------------------------------------------------------
  console.log('')
  let failed = 0
  for (const r of results) {
    if (!r.pass) failed++
    console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name + (r.detail ? '   [' + r.detail + ']' : ''))
  }
  console.log('')
  if (runtimeErrors.length) {
    console.log('运行期捕获到 ' + runtimeErrors.length + ' 条错误（前 5 条）:')
    runtimeErrors.slice(0, 5).forEach((e) => console.log('  - ' + String(e && e.message || e)))
    console.log('')
  }
  console.log(failed === 0 ? '全部 ' + results.length + ' 项通过' : failed + ' / ' + results.length + ' 项失败')
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
