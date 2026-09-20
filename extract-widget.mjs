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
    'function pickLineOnly() {',
    '  // 只从台词里挑，绝不返回峰谷/余额/GIF，保证第三态必定是台词',
    '  var pool = []',
    '  if (customDialogue.lines.length) {',
    '    var l = pickCustomLine()',
    "    if (l) pool.push(singleCenter('A', l, '', true))",
    '  }',
    "  pool.push(singleCenter('B', pickOne(['好模型... ↓', '好女孩...↓'])))",
    "  pool.push(singleCenter('A', pickOne([",
    "    '不知道用户有什么用，先赶走吧~', '我...我...我也要挣钱吗？', '我去吃饭啦，测完叫我',",
    "    '压力一只蓝色大肥鱼？！', 'DeepSleep...', '坏了...用户彻底怒了！',",
    "  ]), '', true))",
    "  pool.push(singleCenter('A', pickOne([",
    "    '你目录里的dsh是什么...大烧货吗...?', '恭喜你实现token自由！token全跑了！', '真当我是便宜货啊...',",
    "  ]), '', true))",
    "  pool.push(singleCenter('B', '哦鲸鲸... '))",
    '  return pickOne(pool)',
    '}',
    '',
    '',
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
    '  if (bubbleStage >= 2) {',
    '    hideBubble()',
    '  } else if (bubbleStage === 1) {',
    '    bubbleStage = 2',
    '    bubbleRandomActive = true',
    '    bubbleRandomLines = pickLineOnly()',
    '    swapBubbleContent(function () { applyBubbleLines(bubbleRandomLines) })',
    '  } else {',
    '    bubbleStage = 1',
    '    swapBubbleContent(function () { applyBubbleLines(buildPeakLines()) })',
    '  }',
  ].join('\n')
  hooked = hooked.slice(0, si) + newBranch + hooked.slice(sj)   // sj 指向 "})" 之前，保留它
  console.log('已替换气泡三态分支')
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

writeFileSync(OUT, hooked, 'utf8')
console.log('已生成: ' + OUT + '  (' + hooked.length + ' 字符)')

// 语法自检
try {
  new (await import('node:vm')).Script(widget)
  console.log('语法检查通过')
} catch (err) {
  console.error('语法错误: ' + String(err && err.message))
  process.exit(1)
}
