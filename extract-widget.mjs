/**
 * 从 DSH 插件的 lib/index.js 里抽出 WIDGET_JS，生成桌宠用的 renderer/widget.js。
 *
 * 关键：源文件里 WIDGET_JS 是模板字符串，其中的 `\\n` 在运行时会被求值成 `\n`。
 * 直接切片得到的是源码文本（带双反斜杠），必须做一次同样的还原，
 * 否则生成的脚本里会出现字面的 “\n”，CSS 的 .join('\n') 就会失效。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = process.argv[2] || join(
  process.env.USERPROFILE || '',
  '.dsh', 'profiles', 'web', 'node_modules', 'dsh-whale-widget-plus-punky', 'lib', 'index.js',
)
const OUT = join(here, 'renderer', 'widget.js')

const raw = readFileSync(SRC, 'utf8')
const marker = 'const WIDGET_JS = `'
const start = raw.indexOf(marker)
if (start === -1) { console.error('找不到 WIDGET_JS'); process.exit(1) }
const end = raw.lastIndexOf('`')
if (end <= start) { console.error('WIDGET_JS 未闭合'); process.exit(1) }

let widget = raw.slice(start + marker.length, end)

// 还原模板字符串的转义：源里写的是 \\n，求值后是 \n
const before = widget.length
widget = widget.replace(/\\\\n/g, '\\n').replace(/\\\\/g, '\\')
console.log('模板转义还原: ' + before + ' -> ' + widget.length + ' 字符')

// 完整性自检：必须以 IIFE 收尾
const tail = widget.slice(-10).replace(/\s+/g, '')
if (!tail.endsWith('})()')) {
  console.error('WIDGET_JS 疑似被截断，结尾为: ' + JSON.stringify(widget.slice(-40)))
  process.exit(1)
}
// 宿主端符号不应出现在前端脚本里
for (const bad of ['webServer', 'ctx.credentials', 'tapIndex', 'const inject', 'export {']) {
  if (widget.includes(bad)) {
    console.error('前端脚本里混入了宿主端代码: ' + bad)
    process.exit(1)
  }
}
// 关键前端函数必须在
for (const need of ['function chatSend', 'function chatRenderMd', 'function chatAddMsg', 'dshwv-chat']) {
  if (!widget.includes(need)) {
    console.error('缺少前端函数: ' + need)
    process.exit(1)
  }
}

// 注入诊断钩子：把挂件闭包内的 isWhaleHit 暴露到 window.__whaleDiag，
// 并在 onDocPointerDown 内部埋点，便于判断点击走到了哪一步。
// 钩子放在这里而不是手改 widget.js，是为了在重新抽取后依然存在。
const hookTarget = 'function isWhaleHit(e) {'
const hookIdx = widget.indexOf(hookTarget)
let hooked = widget
// 换行风格：抽出来的 widget.js 是 CRLF。所有拿多行文本做锚点的 isindex/includes
// 都必须用这个常量拼，否则永远匹配不上（这个坑踩过两次，故提到顶层）。
const RN = hooked.includes('\r\n') ? '\r\n' : '\n'
const NL = RN   // 别名，读代码时更直观
if (hookIdx === -1) {
  console.warn('警告: 未找到 isWhaleHit，跳过诊断钩子注入')
} else {
  // 只暴露一个可查询入口（命中状态 / 是否就绪），代价极小。
  // 曾经在这里做过详细的中间量埋点，用于确认"按压不响应"到底是
  // 命中逻辑坏了还是测试点偏了（结论是后者）。定位完成后移除，保持代码干净。
  hooked = widget.slice(0, hookIdx) + hookTarget + '\n' +
    '  try { window.__whaleDiag = { isWhaleHit: function (ev) { return isWhaleHit(ev) }, get hitReady() { return hitReady }, showBubble: function () { showBubble() }, get bubbleShown() { return bubbleShown }, get bubbleStage() { return bubbleStage } } } catch (e) {}\n' +
    widget.slice(hookIdx + hookTarget.length)
  console.log('已注入诊断钩子 window.__whaleDiag')
}

// ---------------------------------------------------------------------------
// 桌宠定制：重写气泡三态
//
// 原挂件有两处与预期不符：
//   1) 第一态就把「余额 + 峰谷」合在一起显示，而想要的是先余额、再峰谷
//   2) 第三态走权重随机池（峰谷权重 45、台词仅 7），约 62% 仍是峰谷
// 这里注入三个辅助函数并替换点击分支，改成：
//   余额 → 峰谷 → 台词（必定）→ 关闭
// 放在抽取脚本里而不是手改 widget.js，是为了重新抽取后改动不丢。
// ---------------------------------------------------------------------------
const helperAnchor = 'function buildGroup1() {'
if (!hooked.includes('function buildBalanceLines()') && hooked.includes(helperAnchor)) {
  const helpers = [
    '// ===== 桌宠定制：确定的三态内容（替代原权重随机池） =====',
    'function buildBalanceLines() {',
    "  var bal = '--'",
    '  try { bal = fmt(state.balance, state.currency) } catch (e) {}',
    '  var todayNum = todayCost > 0 ? todayCost : (state.todayUsage != null ? Number(state.todayUsage) : 0)',
    '  return [',
    "    { t: 'DeepSeek 余额', s: 'A', c: '' },",
    "    { t: bal, s: 'B', c: '' },",
    "    { t: '今日消耗 ¥' + todayNum.toFixed(2), s: 'C', c: '', w: true },",
    '  ]',
    '}',
    'function buildPeakLines() {',
    '  var peak = !!state.isPeak',
    "  var offText = '空闲时段', peakText = '高峰时段'",
    "  if (peakMode === 'liangwen') { offText = '梁文谷'; peakText = '梁文峰' }",
    "  else if (peakMode === 'qiangqiang') { offText = '!?谷谷?!'; peakText = '!?峰峰?!' }",
    '  return [',
    "    { t: '当前时间段', s: 'A', c: '' },",
    "    { t: peak ? peakText : offText, s: 'P', c: peak ? '#e0433f' : '#2fa24c' },",
    '  ]',
    '}',
    'var _lastLineExpr = null',
    '// 台词 -> 语义表情。各素材版本可用表情差别很大（v3 仅 2 个、v4 仅 1 个能直接对应），',
    '// 所以先落到语义，再按当前版本查具体表情名，查不到就跳过。',
    'var EXPR_BY_VER = {',
    "  proud:    { v1: 'thumbsup',  v2: 'proud',     v3: 'grace',   v4: 'signboard' },",
    "  shy:      { v1: 'shy',       v2: 'shy',       v3: 'shy',     v4: 'tremble' },",
    "  bored:    { v1: 'quiet',     v2: 'bored',     v3: 'hm',      v4: 'slacking' },",
    "  wronged:  { v1: 'sad',       v2: 'wronged',   v3: 'cry',     v4: 'sobbing' },",
    "  greet:    { v1: 'greet',     v2: 'ok',        v3: 'greet',   v4: 'signboard' },",
    "  shocked:  { v1: 'scared',    v2: 'shocked',   v3: 'insight', v4: 'tremble' },",
    "  sleepy:   { v1: 'exhausted', v2: 'exhausted', v3: 'sleepy',  v4: 'sleep' },",
    "  angry:    { v1: 'angry',     v2: 'angry',     v3: 'wall',    v4: 'nooo' },",
    "  question: { v1: 'what',      v2: 'question',  v3: 'hm',      v4: 'thinking' },",
    "  mock:     { v1: 'mock',      v2: 'wicked',    v3: 'hip',     v4: 'freeride' },",
    "  grit:     { v1: 'angry',     v2: 'grit',      v3: 'reflect', v4: 'nooo' },",
    "  happy:    { v1: 'cheer',     v2: 'happy',     v3: 'cheer',   v4: 'dancing' },",
    '}',
    'function exprExists(name) {',
    '  var list = (typeof EXPR_LISTS !== "undefined") ? EXPR_LISTS[exprVer] : null',
    '  return !!(name && list && list.indexOf(name) !== -1)',
    '}',
    'var _bubbleExprName = null',
    '// 锁住一个表情，直到气泡消失才解除。',
    '// 为什么必须是 manualExpr 而不是直接 exprSetImg：',
    '//   挂件的自动表情系统（眨眼、卖萌、空闲）会调用 exprApplyIcon() 把表情顶掉，',
    '//   眨眼间隔 3.5~8 秒、且触发后 280ms 就恢复默认 —— 这就是"表情一秒不到就没了"的原因。',
    '//   设成 manualExpr 后 exprApplyIcon() 会优先返回它，自动系统顶不掉。',
    'function applyBubbleExpr(name) {',
    '  if (!exprExists(name)) return',
    '  try {',
    '    manualExpr = name',
    '    _bubbleExprName = name',
    '    exprClearTimers()',
    '    exprCancelBlink()',
    '    exprSetImg(EXPR_URL(name))',
    '  } catch (e) {}',
    '}',
    'function releaseBubbleExpr() {',
    '  if (!_bubbleExprName) return',
    '  // 只有仍是我们锁的那个才解除，避免盖掉用户手动选的表情',
    '  if (manualExpr === _bubbleExprName) {',
    '    manualExpr = null',
    '    try { exprApplyIcon(); exprScheduleBlink(); exprScheduleCute() } catch (e) {}',
    '  }',
    '  _bubbleExprName = null',
    '}',
    'function applyLineExpr(semantic) {',
    '  var map = EXPR_BY_VER[semantic]',
    '  if (!map) return',
    '  applyBubbleExpr(map[exprVer])',
    '}',
    '// 峰谷也配表情：高峰（贵）表示压力，低峰（便宜）表示轻松',
    'var PEAK_EXPR_BY_VER = {',
    "  peak:    { v1: 'exhausted', v2: 'exhausted', v3: 'sleepy', v4: 'workhard' },",
    "  offpeak: { v1: 'cheer',     v2: 'happy',     v3: 'tea',    v4: 'boba' },",
    '}',
    'function applyPeakExpr(isPeak) {',
    '  var m = PEAK_EXPR_BY_VER[isPeak ? "peak" : "offpeak"]',
    '  if (m) applyBubbleExpr(m[exprVer])',
    '}',
    'function pickLineOnly() {',
    '  // 只从台词里挑，绝不返回峰谷/余额/GIF，保证第三态必定是台词。',
    '  // t=台词 s=样式 e=配套表情的语义（不同素材版本会自动挑对应表情）',
    '  var table = [',
    "    { t: '好模型... ↓', s: 'B', e: 'proud' },",
    "    { t: '好女孩...↓', s: 'B', e: 'shy' },",
    "    { t: '不知道用户有什么用，先赶走吧~', s: 'A', e: 'bored' },",
    "    { t: '我...我...我也要挣钱吗？', s: 'A', e: 'wronged' },",
    "    { t: '我去吃饭啦，测完叫我', s: 'A', e: 'greet' },",
    "    { t: '压力一只蓝色大肥鱼？！', s: 'A', e: 'shocked' },",
    "    { t: 'DeepSleep...', s: 'A', e: 'sleepy' },",
    "    { t: '坏了...用户彻底怒了！', s: 'A', e: 'angry' },",
    "    { t: '你目录里的dsh是什么...大烧货吗...?', s: 'A', e: 'question' },",
    "    { t: '恭喜你实现token自由！token全跑了！', s: 'A', e: 'mock' },",
    "    { t: '真当我是便宜货啊...', s: 'A', e: 'grit' },",
    "    { t: '哦鲸鲸... ', s: 'B', e: 'happy' },",
    '  ]',
    '  var cands = []',
    '  if (customDialogue.lines.length) {',
    '    var l = pickCustomLine()',
    '    if (l) cands.push({ lines: singleCenter("A", l, "", true), expr: null })',
    '  }',
    '  for (var i = 0; i < table.length; i++) {',
    '    var it = table[i]',
    '    cands.push({ lines: singleCenter(it.s, it.t, "", it.s === "A"), expr: it.e })',
    '  }',
    '  var pick = pickOne(cands)',
    '  _lastLineExpr = pick.expr',
    '  return pick.lines',
    '}',
  ].join('\n')
  hooked = hooked.replace(helperAnchor, helpers + helperAnchor)
  console.log('已注入三态辅助函数')
}

const stageStart = '  if (bubbleStage === 2) {'
const si = hooked.indexOf(stageStart)
// 注意：抽出来的 widget.js 是 CRLF 换行，结束锚点必须同时兼容 \n 与 \r\n，
// 否则 indexOf 找不到位置，替换会被静默跳过（踩过一次）。
let endIdx = -1
if (si >= 0) {
  for (const pat of ['\r\n})', '\n})']) {
    const k = hooked.indexOf(pat, si)
    if (k >= 0 && (endIdx < 0 || k < endIdx)) endIdx = k
  }
}
const sj = endIdx
if (si < 0 || sj < 0) {
  console.warn('警告: 未找到气泡点击分支，跳过三态替换 (si=' + si + ', sj=' + sj + ')')
} else {
  const newBranch = [
    '  // ===== 桌宠定制三态 =====',
    '  // 气泡打开时（showBubble -> restoreBubbleLines）显示的就是余额，',
    '  // 因此这里不再重复一次余额，改成：',
    '  //   第一次点击 -> 峰谷，第二次 -> 台词（必定），第三次 -> 关闭',
    '  // 每次点击都重置自动关闭计时：否则在 t≈4.9s 切到台词，气泡 0.1s 后就消失，',
    '  // 表情也跟着立刻解除，等于没看到。',
    '  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = setTimeout(hideBubble, BUBBLE_MS) }',
    '  if (bubbleStage >= 2) {',
    '    hideBubble()',
    '  } else if (bubbleStage === 1) {',
    '    bubbleStage = 2',
    '    bubbleRandomActive = true',
    '    bubbleRandomLines = pickLineOnly()',
    '    applyLineExpr(_lastLineExpr)   // 台词配套表情（按当前素材版本解析）',
    '    swapBubbleContent(function () { applyBubbleLines(bubbleRandomLines) })',
    '  } else {',
    '    bubbleStage = 1',
    '    swapBubbleContent(function () { applyBubbleLines(buildPeakLines()) })',
    '    applyPeakExpr(!!state.isPeak)   // 高峰/低峰配对应表情',
    '  }',
  ].join('\n')
  hooked = hooked.slice(0, si) + newBranch + hooked.slice(sj)   // sj 指向 "})" 之前，保留它
  // 顺手删掉原生那行已经过时的注释（上面写的是"额度->周月->台词->关闭"，
  // 桌宠改成三态后它就在自定义注释正上方，两句互相矛盾）
  const staleNote = '  // ===== 点击三态循环：默认额度视图 → 周/月额度 → 随机台词 → 关闭 =====' + RN
  if (hooked.includes(staleNote)) hooked = hooked.replace(staleNote, '')
  console.log('已替换气泡三态分支')
// 气泡消失时解除配的表情。
// 挂件原生 hideBubble 会把 bubbleStage 归零，那里正是"气泡没了"的时刻。
// 用三行连续赋值做锚点（单独的 bubbleStage = 0 在文件里出现多次，不唯一）。
// 三行归零在文件里出现 3 次（restoreBubbleLines / showBubble / hideBubble），
// 必须加上紧随其后的 bubbleShown = false 才能唯一锁定 hideBubble。
const hideAnchor = [
  '  bubbleStage = 0',
  '  bubbleRandomActive = false',
  '  bubbleRandomLines = null',
  '  bubbleShown = false',
].join(RN)
// 幂等标记：不能拿 "releaseBubbleExpr()" 判定，那会命中函数定义行 `function releaseBubbleExpr() {`
const EXPR_HOOK_MARK = '// __WHALE_RELEASE_EXPR_ON_HIDE__'
const alreadyHasCall = hooked.indexOf(EXPR_HOOK_MARK) !== -1
if (hooked.includes(hideAnchor) && !alreadyHasCall) {
  const injected = [
    '  ' + EXPR_HOOK_MARK,
    '  // 桌宠定制：气泡关闭时才解除台词/峰谷配的表情。',
    '  // 根因（已在 test-expr-lock.mjs 里逐帧复现）：表情必须通过 manualExpr 上锁，',
    '  // 否则挂件的自动表情系统会把它换掉 —— 眨眼一旦起手，280ms 后走的是',
    '  // exprApplyIcon()，没有锁就直接回默认图，配的表情就此永久丢失；',
    '  // 若眨眼恰好在配表情时已在途中，130ms 那帧还会把表情盖成 close_eyes。',
    '  // 所以生命周期是：配表情 = 上锁，气泡消失 = 解锁。',
    '  releaseBubbleExpr()',
  ].join(RN)
  hooked = hooked.replace(hideAnchor, injected + RN + hideAnchor)
  console.log('已在 hideBubble 中接入表情解除')
} else {
  console.warn('警告: 未找到 hideBubble 锚点，表情解除未接入')
}

}

// ---------------------------------------------------------------------------
// 桌宠定制：修掉两处导致「今日消耗一直显示 0」的问题
//   1) 气泡提示行只读 todayCost（来自 last-turn.json 的逐轮累加）。
//      桌宠没有 DSH 的会话事件，拿不到每轮消耗，todayCost 恒为 0，
//      而主进程账本其实有值 —— 加上回落到 state.todayUsage。
//   2) 用 UTC 日期做跨天判断，东八区早上 8 点会跳变并把当日累计清零。
// ---------------------------------------------------------------------------
const hintOld = "      hint = '今日消耗 ¥' + todayCost.toFixed(2)"
if (!hooked.includes('_todayNum') && hooked.includes(hintOld)) {
  const hintNew = [
    '      // 桌宠拿不到每轮消耗（没有 DSH 的会话事件），todayCost 恒为 0，',
    '      // 因此回落到主进程账本的值（随 balance.json 一起下发）。',
    '      var _todayNum = (todayCost > 0) ? todayCost : (state.todayUsage != null ? Number(state.todayUsage) : 0)',
    "      hint = '今日消耗 ¥' + _todayNum.toFixed(2)",
  ].join('\n')
  hooked = hooked.replace(hintOld, hintNew)
  console.log('已修复今日消耗的取值回落')
}

const utcPat = "new Date().toISOString().slice(0, 10)"
if (hooked.includes(utcPat)) {
  const local = "(function(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})(new Date())"
  const n = hooked.split(utcPat).length - 1
  hooked = hooked.split(utcPat).join(local)
  console.log('已将 ' + n + ' 处 UTC 日期改为本地日期')
}

// ---------------------------------------------------------------------------
// 桌宠定制：离线自测探针。
// 挂件是个 IIFE，函数全在闭包里，外面拿不到 —— 没有探针就只能靠肉眼盯屏幕，
// 而"表情是不是一秒就恢复"恰恰是肉眼最容易看错的地方（眨眼 130/280ms 的中间帧
// 会被误判成"恢复了"）。这里只挂状态与入口，不改变任何渲染行为。
// ---------------------------------------------------------------------------
const probeMark = 'window.__whaleProbe = {'
if (!hooked.includes(probeMark)) {
  const tail = RN + '})()'
  const ti = hooked.lastIndexOf(tail)
  if (ti < 0) {
    console.warn('警告: 未找到 IIFE 结尾，自测探针未注入')
  } else {
    const probe = [
      RN + '// 桌宠定制：仅用于离线自测的探针（不参与渲染逻辑）',
      'try {',
      '  window.__whaleProbe = {',
      '    applyBubbleExpr: applyBubbleExpr,',
      '    releaseBubbleExpr: releaseBubbleExpr,',
      '    applyLineExpr: applyLineExpr,',
      '    applyPeakExpr: applyPeakExpr,',
      '    exprDoBlink: exprDoBlink,',
      '    exprApplyIcon: exprApplyIcon,',
      '    pickLineOnly: pickLineOnly,',
      '    showBubble: showBubble,',
      '    hideBubble: hideBubble,',
      '    bubbleBox: bubbleBox,',
      '    get manualExpr() { return manualExpr },',
      '    get locked() { return _bubbleExprName },',
      '    get curImg() { return __curImgSrc },',
      '    get stage() { return bubbleStage },',
      '    get shown() { return bubbleShown },',
      '    get ver() { return exprVer },',
      '    setVer: function (v) { exprVer = v },',
      '    get blinkTimer() { return !!blinkTimer },',
      '    get cuteTimer() { return !!cuteTimer },',
      '  }',
      '} catch (e) {}',
    ].join(RN)
    hooked = hooked.slice(0, ti) + probe + hooked.slice(ti)
    console.log('已注入自测探针 window.__whaleProbe')
  }
}

// ---------------------------------------------------------------------------
// 桌宠定制：堵掉眨眼动画中途的 150ms 抢占窗口。
// exprDoBlink 的三段是 0ms 半闭眼 -> 130ms 全闭眼 -> 280ms exprApplyIcon() 复原。
// 它只在"开始眨眼"时检查 manualExpr，但用户点击气泡是随机的：
// 若在 0~130ms 之间点开台词，130ms 那个定时器没有 manualExpr 判断，
// 会强行把台词表情换成 close_eyes，150ms 后才被 applyIcon 拉回来 ——
// 表现为"台词表情闪了一下"。加一个判断即可，逻辑与既有的 mood/pressing 判断一致。
// ---------------------------------------------------------------------------
const blinkGuardOld = 'if (mood === \'normal\' && !pressing)'
if (hooked.includes(blinkGuardOld)) {
  const n = hooked.split(blinkGuardOld).length - 1
  hooked = hooked.split(blinkGuardOld).join('if (mood === \'normal\' && !pressing && !manualExpr)')
  console.log('已为 ' + n + ' 处眨眼中间帧加上 manualExpr 判断')
}

writeFileSync(OUT, hooked, 'utf8')
console.log('已生成: ' + OUT + '  (' + hooked.length + ' 字符)')

// 语法自检（必须校验真正写盘的 hooked，而不是注入前的 widget）
try {
  new (await import('node:vm')).Script(hooked)
  console.log('语法检查通过')
} catch (err) {
  console.error('语法错误: ' + String(err && err.message))
  process.exit(1)
}
