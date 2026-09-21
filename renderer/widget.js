(function () {
if (window.__dshWhaleWidget) return
// 这里的分号不能省：下一行是以 ( 开头的 IIFE，缺少分号时 ASI 不会插入，
// 会被解析成 true(...) 调用，抛 "true is not a function" 并让整个挂件失效。
window.__dshWhaleWidget = true;

// 崩溃可见化：以前初始化一旦抛错，挂件就静默消失，页面上毫无线索。
// 这里注册最早的错误监听，把初始化期的错误直接显示成一个可关闭的红条，
// 并把详情留在 console 里，同时清掉 __dshWhaleWidget 让下次加载可以重试。
(function () {
  var shown = false
  function paint(msg, extra) {
    if (shown) return
    shown = true
    try {
      var b = document.createElement('div')
      b.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;max-width:min(620px,calc(100vw - 24px));background:#c62828;color:#fff;font:12px/1.45 monospace;padding:8px 10px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.35);white-space:pre-wrap;word-break:break-word;cursor:pointer'
      b.textContent = '大肥鱼挂件初始化失败（点此关闭）\n' + msg + (extra ? '\n' + extra : '')
      b.addEventListener('click', function () { try { b.remove() } catch (e) {} })
      if (document.body) document.body.appendChild(b)
    } catch (e) {}
    try { console.error('[dsh-whale] 挂件初始化失败:', msg, extra || '') } catch (e) {}
    try { window.__dshWhaleWidget = false } catch (e) {}
  }
  window.addEventListener('error', function (e) {
    var t = e && (e.target || e.srcElement)
    if (t && t !== window && (t.tagName === 'SCRIPT' || t.tagName === 'LINK' || t.tagName === 'IMG')) {
      paint('资源加载失败: ' + t.tagName + ' ' + (t.src || t.href || ''))
      return
    }
    var err = e && e.error
    paint(String((e && e.message) || err || '未知错误'), err && err.stack ? String(err.stack).split('\n').slice(0, 4).join(' | ') : '')
  }, true)
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason
    paint('Promise 未处理拒绝: ' + String((r && r.message) || r), r && r.stack ? String(r.stack).split('\n').slice(0, 4).join(' | ') : '')
  })
})()

var exprVer = 'v2'
try { var _ev = localStorage.getItem('dsh-whale-expr-ver'); if (_ev === 'v1' || _ev === 'v2' || _ev === 'v3' || _ev === 'v4') exprVer = _ev } catch (err) {}

var MIN_SCALE = 0.6
var MAX_SCALE = 2.5
var STEP = 0.1
var CLICK_SQ = 9
var REFRESH_MS = 60000
var CHANGE_MS = 900
var ANIM_MS = 700
var BUBBLE_MS = 5000
var FETCH_TIMEOUT_MS = 25000
var BALANCE_URL = '/dsh-whale/balance.json'
var SIZE_URL = '/dsh-whale/size.json'
var IMG_URL = function () { return '/dsh-whale/image.png?ver=' + exprVer }
var GIF_URL = '/dsh-whale/rua.gif'

var css = [
  '.dshwv-root{position:fixed;right:0;bottom:0;--dshw-scale:1;--dshw-base:clamp(122px,calc(min(250px,min(100vw,100vh) * 0.28) * var(--dshw-scale)),625px);width:var(--dshw-base);height:var(--dshw-base);pointer-events:none;user-select:none;-webkit-user-select:none;z-index:9999;font-family:inherit;transition:left .16s ease,top .16s ease,transform .3s ease}',
  '.dshwv-root.dshwv-left{transform:scaleX(-1)}',
  '.dshwv-root.dshwv-dragging{cursor:grabbing;transition:none}',
  '.dshwv-body{position:absolute;left:0;top:0;width:100%;height:100%;transform-origin:50% 100%;transition:transform .22s cubic-bezier(.34,1.56,.64,1)}',
  '.dshwv-img{position:absolute;right:0;bottom:0;width:59.45%;height:59.45%;display:block;pointer-events:none;-webkit-user-drag:none;user-select:none}',
  '.dshwv-bubble{position:absolute;left:0;top:0;width:100%;aspect-ratio:1026/700;pointer-events:none;z-index:1;--dshw-u:calc(var(--dshw-base) / 1026)}',
  '.dshwv-bubble svg{display:block;width:100%;height:100%;pointer-events:none}',
  '.dshwv-bubble svg path,.dshwv-bubble svg ellipse{pointer-events:none;cursor:pointer}',
  '.dshwv-bubble.dshwv-bubble-open svg path,.dshwv-bubble.dshwv-bubble-open svg ellipse{pointer-events:visiblePainted}',
  '.dshwv-bubble .dshwv-bshape,.dshwv-bubble .dshwv-b1,.dshwv-bubble .dshwv-b2{opacity:0;transform:scale(.7);transform-box:fill-box;transform-origin:50% 50%;transition:opacity .2s ease,transform .2s ease}',
  '.dshwv-bubble.dshwv-bubble-open .dshwv-bshape,.dshwv-bubble.dshwv-bubble-open .dshwv-b1,.dshwv-bubble.dshwv-bubble-open .dshwv-b2{opacity:1;transform:none}',
  '.dshwv-gif{position:absolute;left:44.25%;top:38%;transform:translate(-50%,-50%);max-width:calc(var(--dshw-u) * 560);max-height:calc(var(--dshw-u) * 400);display:none;opacity:0;transition:opacity .2s ease;pointer-events:none;-webkit-user-drag:none;user-select:none;object-fit:contain}',
  '.dshwv-root.dshwv-left .dshwv-gif{transform:translate(-50%,-50%) scaleX(-1)}',
  '.dshwv-bubble.dshwv-bubble-open .dshwv-gif{opacity:1}',
  '.dshwv-bubble.dshwv-bubble-open .dshwv-b2{transition-delay:0s}',
  '.dshwv-bubble.dshwv-bubble-open .dshwv-b1{transition-delay:.13s}',
  '.dshwv-bubble.dshwv-bubble-open .dshwv-bshape{transition-delay:.26s}',
  '.dshwv-bubble .dshwv-bshape{transition-delay:.1s}',
  '.dshwv-bubble .dshwv-b1{transition-delay:.2s}',
  '.dshwv-bubble .dshwv-b2{transition-delay:.3s}',
  '.dshwv-text{position:absolute;left:44.25%;top:38%;transform:translate(-50%,-50%);text-align:center;color:#536ba9;line-height:1.15;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .16s ease,transform .3s ease}',
  '.dshwv-bubble.dshwv-bubble-open .dshwv-text{opacity:1;transition:opacity .16s ease .36s,transform .3s ease}',
  '.dshwv-root.dshwv-left .dshwv-text{transform:translate(-50%,-50%) scaleX(-1)}',
  '.dshwv-label{font-size:calc(var(--dshw-u) * 66);font-weight:600;letter-spacing:.06em}',
  '.dshwv-amount{font-size:calc(var(--dshw-u) * 128);font-weight:800;line-height:1.05}',
  '.dshwv-period{font-size:calc(var(--dshw-u) * 104);font-weight:800;line-height:1.05}',
  '.dshwv-wrap{white-space:normal;max-width:calc(var(--dshw-u) * 560);line-height:1.2}',
  '.dshwv-hint{font-size:calc(var(--dshw-u) * 56);color:#9fb0d9;letter-spacing:.02em;margin-top:calc(var(--dshw-u) * 9);min-height:calc(var(--dshw-u) * 64);line-height:1.15}',
  '.dshwv-menu-btn{position:absolute;top:calc(40.55% + 4px);right:4px;width:26px;height:26px;border:none;border-radius:6px;background:rgba(32,49,112,.85);cursor:pointer;pointer-events:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:0;z-index:2;opacity:0;transition:opacity .15s ease}',
  '.dshwv-menu-btn.dshwv-menu-btn-visible{opacity:1}',
  '.dshwv-menu-btn span{display:block;width:14px;height:2px;background:#fff;border-radius:1px}',
  '.dshwv-menu-btn:hover{background:#203170}',
  '.dshwv-menu{position:fixed;min-width:172px;background:rgba(255,255,255,.92);border:1px solid rgba(32,49,112,.35);border-radius:10px;padding:10px 12px;opacity:0;transform:scale(.92) translateY(-4px);transform-origin:top right;transition:opacity .18s ease,transform .2s cubic-bezier(.34,1.56,.64,1);pointer-events:none;z-index:10000;box-shadow:0 6px 18px rgba(0,0,0,.18);color-scheme:light}',
  '.dshwv-menu.dshwv-menu-open{opacity:1;transform:scale(1) translateY(0);pointer-events:auto}',
  '.dshwv-menu-row{display:flex;align-items:center;gap:8px;margin:5px 0;color:#203170;font-size:12px;white-space:nowrap}',
  '.dshwv-range{flex:1;min-width:0;accent-color:#203170}',
  '.dshwv-number{width:46px;border:1px solid rgba(32,49,112,.4);border-radius:6px;padding:2px 4px;font-size:12px;color:#203170;background:#fff}',
  '.dshwv-sound{flex:1;border:1px solid rgba(32,49,112,.4);border-radius:6px;background:rgba(32,49,112,.08);color:#203170;font-size:12px;padding:3px 0;cursor:pointer}',
  '.dshwv-sound:hover{background:rgba(32,49,112,.16)}',
  '.dshwv-check{width:16px;height:16px;accent-color:#203170;cursor:pointer;flex:0 0 auto}',
  '.dshwv-menu-sep{height:1px;background:rgba(32,49,112,.25);margin:6px 0}',
  '.dshwv-dialog-panel{padding:6px 8px;background:rgba(32,49,112,.06);border-radius:8px;margin-top:4px}',
  '.dshwv-dialog-list{max-height:110px;overflow-y:auto}',
  '.dshwv-volpct{width:36px;text-align:right;color:#203170;font-size:12px}',
  // ===== 问答对话面板 =====
  '.dshwv-chat{position:fixed;right:18px;bottom:18px;width:340px;max-width:calc(100vw - 24px);height:460px;max-height:calc(100vh - 32px);display:none;flex-direction:column;background:rgba(255,255,255,.96);border:1px solid rgba(32,49,112,.35);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.22);z-index:10001;color-scheme:light;font-family:inherit;font-size:12px;color:#203170;overflow:hidden}',
  '.dshwv-chat.dshwv-chat-open{display:flex}',
  '.dshwv-chat-head{display:flex;align-items:center;gap:6px;padding:8px 10px;background:rgba(32,49,112,.08);border-bottom:1px solid rgba(32,49,112,.2);flex:0 0 auto}',
  '.dshwv-chat-title{font-weight:700;font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshwv-chat-btn{border:1px solid rgba(32,49,112,.4);border-radius:6px;background:rgba(32,49,112,.08);color:#203170;font-size:11px;padding:3px 8px;cursor:pointer;white-space:nowrap}',
  '.dshwv-chat-btn:hover{background:rgba(32,49,112,.18)}',
  '.dshwv-chat-close{flex:0 0 auto;width:22px;height:22px;padding:0;line-height:1;font-size:13px;border-radius:6px}',
  '.dshwv-chat-sessions{max-height:132px;overflow-y:auto;border-bottom:1px solid rgba(32,49,112,.16);background:rgba(32,49,112,.03);flex:0 0 auto}',
  '.dshwv-chat-srow{display:flex;align-items:center;gap:6px;padding:5px 10px;cursor:pointer;border-bottom:1px solid rgba(32,49,112,.08)}',
  '.dshwv-chat-srow:hover{background:rgba(32,49,112,.09)}',
  '.dshwv-chat-srow.dshwv-chat-srow-on{background:rgba(32,49,112,.16)}',
  '.dshwv-chat-stitle{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}',
  '.dshwv-chat-sdel{flex:0 0 auto;border:none;background:none;color:#7a8bb5;cursor:pointer;font-size:12px;padding:0 2px;line-height:1}',
  '.dshwv-chat-sdel:hover{color:#e0433f}',
  '.dshwv-chat-msgs{flex:1;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:7px;min-height:0}',
  '.dshwv-chat-m{max-width:86%;padding:6px 9px;border-radius:9px;line-height:1.45;white-space:pre-wrap;word-break:break-word;font-size:12px}',
  '.dshwv-chat-mu{align-self:flex-end;background:#203170;color:#fff;border-bottom-right-radius:3px}',
  '.dshwv-chat-ma{align-self:flex-start;background:rgba(32,49,112,.09);color:#203170;border-bottom-left-radius:3px}',
  '.dshwv-chat-me{align-self:center;color:#e0433f;background:rgba(224,67,63,.1);font-size:11px;max-width:96%}',
  '.dshwv-chat-empty{color:#7a8bb5;font-size:11px;text-align:center;padding:14px 6px;line-height:1.6}',
  '.dshwv-chat-foot{flex:0 0 auto;display:flex;gap:6px;padding:8px 10px;border-top:1px solid rgba(32,49,112,.2);align-items:flex-end}',
  '.dshwv-chat-in{flex:1;min-width:0;resize:none;height:38px;max-height:110px;border:1px solid rgba(32,49,112,.4);border-radius:8px;padding:6px 8px;font-size:12px;color:#203170;background:#fff;font-family:inherit;line-height:1.4}',
  '.dshwv-chat-in:focus{outline:none;border-color:#203170}',
  '.dshwv-chat-send{flex:0 0 auto;border:none;border-radius:8px;background:#203170;color:#fff;font-size:12px;padding:8px 13px;cursor:pointer}',
  '.dshwv-chat-send:hover{background:#2b3f86}',
  '.dshwv-chat-send:disabled{background:#9fb0d9;cursor:default}',
  '.dshwv-chat-model{flex:0 0 auto;border:1px solid rgba(32,49,112,.4);border-radius:6px;background:rgba(32,49,112,.06);color:#203170;font-size:11px;padding:3px 4px;max-width:96px}',
  '.dshwv-chat-hist{flex:0 0 auto;display:flex;align-items:center;gap:3px;font-size:11px;color:#203170;white-space:nowrap}',
  // Markdown 渲染（助手回答）
  '.dshwv-md p{margin:0 0 5px 0}',
  '.dshwv-md p:last-child{margin-bottom:0}',
  '.dshwv-md pre{margin:4px 0;padding:6px 8px;background:rgba(32,49,112,.09);border-radius:6px;overflow-x:auto;font-size:11px;line-height:1.4}',
  '.dshwv-md code{font-family:Consolas,Menlo,monospace;font-size:11px}',
  '.dshwv-md p>code,.dshwv-md li>code{background:rgba(32,49,112,.12);padding:0 3px;border-radius:3px}',
  '.dshwv-md ul,.dshwv-md ol{margin:3px 0;padding-left:17px}',
  '.dshwv-md li{margin:1px 0}',
  '.dshwv-md h1,.dshwv-md h2,.dshwv-md h3{margin:5px 0 3px 0;font-size:12px}',
  '.dshwv-md blockquote{margin:3px 0;padding-left:7px;border-left:2px solid rgba(32,49,112,.35);color:#536ba9}',
  '.dshwv-md a{color:#2b5fd9;text-decoration:underline;word-break:break-all}'
].join('\n')

var styleEl = document.createElement('style')
styleEl.textContent = css
document.head.appendChild(styleEl)

var root = document.createElement('div')
root.className = 'dshwv-root'

var img = document.createElement('img')
img.className = 'dshwv-img'
img.src = IMG_URL()
img.alt = 'DeepSeek 余额'
img.draggable = false
// 图片加载失败：清缓存标记，1.5s 后重试期望图。
// 正常运行中 exprSetImg 只会赋值已确认加载的 URL，此兜底主要覆盖初始图。
img.addEventListener('error', function () {
  __curImgSrc = ''
  try { delete __imgLoaded[__wantImgSrc]; delete __imgLoaded[img.src] } catch (err) {}
  setTimeout(function () {
    if (__curImgSrc !== '') return
    var target = __wantImgSrc || (img && img.getAttribute('src'))
    if (target) img.src = target
  }, 1500)
})

var menuBtn = document.createElement('button')
menuBtn.type = 'button'
menuBtn.className = 'dshwv-menu-btn'
menuBtn.title = '菜单'
menuBtn.innerHTML = '<span></span><span></span><span></span>'
menuBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleMenu() })

var menuBox = document.createElement('div')
menuBox.className = 'dshwv-menu'
function menuLabel(text) {
  var s = document.createElement('span')
  s.textContent = text
  return s
}
function menuRow() {
  var r = document.createElement('div')
  r.className = 'dshwv-menu-row'
  return r
}
var scaleInput = document.createElement('input')
scaleInput.type = 'range'
scaleInput.min = String(MIN_SCALE)
scaleInput.max = String(MAX_SCALE)
scaleInput.step = '0.1'
scaleInput.className = 'dshwv-range'
scaleInput.value = '1.5'
var scaleNumber = document.createElement('input')
scaleNumber.type = 'number'
scaleNumber.min = '1'
scaleNumber.max = '20'
scaleNumber.step = '1'
scaleNumber.className = 'dshwv-number'
scaleNumber.value = '10'
scaleInput.addEventListener('pointerdown', function () { root.style.transition = 'none' })
scaleInput.addEventListener('input', function () { setScale(scaleInput.value) })
scaleInput.addEventListener('change', function () { root.style.transition = '' })
scaleNumber.addEventListener('change', function () {
  var v = Math.round(Number(scaleNumber.value))
  var s = MIN_SCALE + Math.max(0, Math.min(20, v) - 1) * (MAX_SCALE - MIN_SCALE) / 19
  setScale(s)
  root.style.transition = ''
})
var soundSelect = document.createElement('select')
soundSelect.className = 'dshwv-sound'
function soundOpt(value, label) {
  var o = document.createElement('option')
  o.value = value
  o.textContent = label
  return o
}
soundSelect.appendChild(soundOpt('duck', '小黄鸭'))
soundSelect.appendChild(soundOpt('fx1', '音效1'))
soundSelect.addEventListener('change', function () { setSoundSet(soundSelect.value) })
var usageSelect = document.createElement('select')
usageSelect.className = 'dshwv-sound'
usageSelect.appendChild(soundOpt('0', '跟随激活账号'))
usageSelect.appendChild(soundOpt('1', '账号 1'))
usageSelect.appendChild(soundOpt('2', '账号 2'))
usageSelect.appendChild(soundOpt('-1', 'DeepSeek 余额'))
usageSelect.addEventListener('change', function () {
  var v = usageSelect.value
  selectedAccountIdx = (v === '-1') ? -1 : (Number(v) || 0)
  // DeepSeek 模式下用 ¥ 格式化
  state.currency = (selectedAccountIdx === -1) ? 'CNY' : '%'
  shown = null
  refresh(true)
})
var peakSelect = document.createElement('select')
peakSelect.className = 'dshwv-sound'
peakSelect.appendChild(soundOpt('default', '默认'))
peakSelect.appendChild(soundOpt('liangwen', '梁文峰谷'))
peakSelect.appendChild(soundOpt('qiangqiang', '!?强强?!'))
peakSelect.addEventListener('change', function () { setPeakMode(peakSelect.value) })
var bubbleToggle = document.createElement('input')
bubbleToggle.type = 'checkbox'
bubbleToggle.className = 'dshwv-check'
bubbleToggle.checked = true
bubbleToggle.title = '开启/关闭思考气泡'
bubbleToggle.addEventListener('change', function () { setBubbleOn(bubbleToggle.checked) })
var turnCostToggle = document.createElement('input')
turnCostToggle.type = 'checkbox'
turnCostToggle.className = 'dshwv-check'
turnCostToggle.checked = true
turnCostToggle.title = '每轮对话结束后自动显示本轮消耗金额'
turnCostToggle.addEventListener('change', function () { setTurnCostOn(turnCostToggle.checked) })
var turnCostCloseInput = document.createElement('input')
turnCostCloseInput.type = 'number'
turnCostCloseInput.min = '0'
turnCostCloseInput.step = '1'
turnCostCloseInput.className = 'dshwv-number'
turnCostCloseInput.value = '5'
turnCostCloseInput.title = '填 0 表示不自动关闭，需手动点击关闭'
turnCostCloseInput.addEventListener('change', function () { setTurnCostClose(turnCostCloseInput.value) })
var scrollGapToggle = document.createElement('input')
scrollGapToggle.type = 'checkbox'
scrollGapToggle.className = 'dshwv-check'
scrollGapToggle.checked = false
scrollGapToggle.title = '开启后挂件右侧按设定像素避开滚动条；关闭则贴边（盖住滚动条）'
scrollGapToggle.addEventListener('change', function () { setScrollGapOn(scrollGapToggle.checked) })
var scrollGapInput = document.createElement('input')
scrollGapInput.type = 'number'
scrollGapInput.min = '0'
scrollGapInput.step = '1'
scrollGapInput.className = 'dshwv-number'
scrollGapInput.value = '17'
scrollGapInput.disabled = true // 默认避让关 → 宽度不可修改，勾选后启用
scrollGapInput.title = '避让滚动条的像素宽度，填 0 表示贴边'
scrollGapInput.addEventListener('input', function () { setScrollGapPx(scrollGapInput.value) })
scrollGapInput.addEventListener('change', function () { setScrollGapPx(scrollGapInput.value) })
var row1 = menuRow()
row1.appendChild(menuLabel('大小'))
row1.appendChild(scaleInput)
row1.appendChild(scaleNumber)
var row2 = menuRow()
row2.appendChild(menuLabel('音效'))
row2.appendChild(soundSelect)
var volInput = document.createElement('input')
volInput.type = 'range'
volInput.min = '0'
volInput.max = '1'
volInput.step = '0.05'
volInput.className = 'dshwv-range'
volInput.value = '0.9'
var volPct = document.createElement('span')
volPct.className = 'dshwv-volpct'
volPct.textContent = '90%'
volInput.addEventListener('input', function () { setVol(volInput.value) })
var row3 = menuRow()
row3.appendChild(menuLabel('音量'))
row3.appendChild(volInput)
row3.appendChild(volPct)
var row4 = menuRow()
row4.appendChild(menuLabel('账号'))
row4.appendChild(usageSelect)
var row5 = menuRow()
row5.appendChild(menuLabel('峰谷'))
row5.appendChild(peakSelect)
var row6 = menuRow()
row6.appendChild(menuLabel('气泡'))
row6.appendChild(bubbleToggle)
var menuSep1 = document.createElement('div')
menuSep1.className = 'dshwv-menu-sep'
var row7 = menuRow()
row7.appendChild(menuLabel('每轮消耗'))
row7.appendChild(turnCostToggle)
var row8 = menuRow()
row8.appendChild(menuLabel('自动关闭时间'))
row8.appendChild(turnCostCloseInput)
row8.appendChild(menuLabel('秒'))
var row9 = menuRow()
row9.appendChild(menuLabel('避让滚动条'))
row9.appendChild(scrollGapToggle)
row9.appendChild(menuLabel('宽度'))
row9.appendChild(scrollGapInput)
row9.appendChild(menuLabel('px'))
menuBox.appendChild(row1)
menuBox.appendChild(row2)
menuBox.appendChild(row3)
menuBox.appendChild(row4)
menuBox.appendChild(row5)
menuBox.appendChild(row6)
menuBox.appendChild(menuSep1)
menuBox.appendChild(row7)
menuBox.appendChild(row8)
menuBox.appendChild(row9)

// ===== 自定义台词（从桌面版移植）=====
var customDialogue = { lines: [], mode: 'random' } // mode: random | carousel
var carouselIdx = 0
function loadCustomDialogue() {
  try {
    var raw = localStorage.getItem('dsh-whale-dialogue')
    if (!raw) return
    var obj = JSON.parse(raw)
    if (obj && Array.isArray(obj.lines)) customDialogue = { lines: obj.lines.filter(function (l) { return typeof l === 'string' && l.trim() }), mode: obj.mode === 'carousel' ? 'carousel' : 'random' }
  } catch (err) {}
}
function saveCustomDialogue() {
  try {
    localStorage.setItem('dsh-whale-dialogue', JSON.stringify(customDialogue))
  } catch (err) {}
}
loadCustomDialogue()
function pickCustomLine() {
  if (!customDialogue.lines.length) return null
  if (customDialogue.mode === 'carousel') {
    var line = customDialogue.lines[carouselIdx % customDialogue.lines.length]
    carouselIdx = (carouselIdx + 1) % customDialogue.lines.length
    return line
  }
  return customDialogue.lines[Math.floor(Math.random() * customDialogue.lines.length)]
}
// ===== 台词管理面板（从桌面版移植）=====
var dialogueRow = menuRow()
var dialogueBtn = document.createElement('button')
dialogueBtn.type = 'button'
dialogueBtn.className = 'dshwv-sound'
dialogueBtn.textContent = '编辑台词'
var dialogueHint = menuLabel('台词')
var dlgPanel = document.createElement('div')
dlgPanel.className = 'dshwv-dialog-panel'
var dlgList = document.createElement('div')
dlgList.className = 'dshwv-dialog-list'
var dlgInput = document.createElement('input')
dlgInput.type = 'text'
dlgInput.className = 'dshwv-number'
dlgInput.placeholder = '输入新台词…'
dlgInput.style.flex = '1'
var dlgAddBtn = document.createElement('button')
dlgAddBtn.type = 'button'
dlgAddBtn.className = 'dshwv-sound'
dlgAddBtn.textContent = '添加'
var dlgModeSel = document.createElement('select')
dlgModeSel.className = 'dshwv-sound'
dlgModeSel.appendChild(soundOpt('random', '随机'))
dlgModeSel.appendChild(soundOpt('carousel', '轮播'))
dlgModeSel.value = customDialogue.mode
dlgModeSel.addEventListener('change', function () { customDialogue.mode = dlgModeSel.value; saveCustomDialogue() })
var dlgResetBtn = document.createElement('button')
dlgResetBtn.type = 'button'
dlgResetBtn.className = 'dshwv-sound'
dlgResetBtn.textContent = '清空自定义'
function dlgRenderList() {
  dlgList.textContent = ''
  if (!customDialogue.lines.length) {
    var empty = document.createElement('div')
    empty.style.cssText = 'font-size:11px;color:#7a8bb5;padding:2px 0'
    empty.textContent = '（无自定义台词，使用内置台词）'
    dlgList.appendChild(empty)
    return
  }
  customDialogue.lines.forEach(function (line, i) {
    var rowD = document.createElement('div')
    rowD.style.cssText = 'display:flex;gap:4px;align-items:center;margin:2px 0'
    var txt = document.createElement('span')
    txt.style.cssText = 'flex:1;font-size:11px;color:#203170;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer'
    txt.textContent = (i + 1) + '. ' + line
    txt.title = '点击修改这条台词'
    // 点击文本 → 变成输入框就地编辑（回车保存，Esc 取消，失焦保存）
    txt.addEventListener('click', function () {
      if (rowD.querySelector('input.dlg-edit')) return
      var edit = document.createElement('input')
      edit.type = 'text'
      edit.className = 'dshwv-number dlg-edit'
      edit.value = line
      edit.style.cssText = 'flex:1;min-width:0;font-size:11px'
      rowD.replaceChild(edit, txt)
      edit.focus()
      edit.select()
      var done = false
      function commit() {
        if (done) return
        done = true
        var v = (edit.value || '').trim()
        if (v && v !== line) customDialogue.lines[i] = v
        saveCustomDialogue()
        dlgRenderList()
      }
      edit.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); commit() }
        else if (ev.key === 'Escape') { done = true; dlgRenderList() }
        ev.stopPropagation()
      })
      edit.addEventListener('blur', commit)
      edit.addEventListener('click', function (ev) { ev.stopPropagation() })
    })
    var del = document.createElement('button')
    del.type = 'button'
    del.className = 'dshwv-sound'
    del.textContent = '删'
    del.style.cssText = 'flex:0 0 auto;padding:1px 8px'
    del.addEventListener('click', function () {
      customDialogue.lines.splice(i, 1)
      saveCustomDialogue()
      dlgRenderList()
    })
    rowD.appendChild(txt)
    rowD.appendChild(del)
    dlgList.appendChild(rowD)
  })
}
dlgAddBtn.addEventListener('click', function () {
  var v = (dlgInput.value || '').trim()
  if (!v) return
  customDialogue.lines.push(v)
  saveCustomDialogue()
  dlgInput.value = ''
  dlgRenderList()
})
dlgInput.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') dlgAddBtn.click() })
dlgResetBtn.addEventListener('click', function () {
  customDialogue.lines = []
  saveCustomDialogue()
  dlgRenderList()
})
dialogueBtn.addEventListener('click', function () {
  var open = dlgPanel.style.display !== 'none'
  dlgPanel.style.display = open ? 'none' : 'block'
  if (!open) dlgRenderList()
})
dlgPanel.style.display = 'none'
dlgPanel.appendChild(dlgList)
var dlgInputRow = document.createElement('div')
dlgInputRow.style.cssText = 'display:flex;gap:4px;margin-top:4px'
dlgInputRow.appendChild(dlgInput)
dlgInputRow.appendChild(dlgAddBtn)
dlgPanel.appendChild(dlgInputRow)
var dlgModeRow = menuRow()
dlgModeRow.appendChild(menuLabel('播放模式'))
dlgModeRow.appendChild(dlgModeSel)
dlgModeRow.appendChild(dlgResetBtn)
dlgPanel.appendChild(dlgModeRow)
dialogueRow.appendChild(dialogueHint)
dialogueRow.appendChild(dialogueBtn)
menuBox.appendChild(dialogueRow)
menuBox.appendChild(dlgPanel)

// ===== 眨眼频率 + 气泡颜色（从桌面版移植）=====
var blinkMinInput = document.createElement('input')
blinkMinInput.type = 'number'
blinkMinInput.min = '1'
blinkMinInput.max = '30'
blinkMinInput.step = '1'
blinkMinInput.className = 'dshwv-number'
var blinkMaxInput = document.createElement('input')
blinkMaxInput.type = 'number'
blinkMaxInput.max = '60'
blinkMaxInput.step = '1'
blinkMaxInput.className = 'dshwv-number'
var BLINK_KEY = 'dsh-whale-blink'
function loadBlinkCfg() {
  try {
    var o = JSON.parse(localStorage.getItem(BLINK_KEY) || 'null')
    if (o && o.min > 0 && o.max >= o.min) { blinkMinInput.value = o.min; blinkMaxInput.value = o.max; return }
  } catch (err) {}
  blinkMinInput.value = 3.5; blinkMaxInput.value = 8
}
function saveBlinkCfg() {
  var mn = Math.max(1, Number(blinkMinInput.value) || 3.5)
  var mx = Math.max(mn, Number(blinkMaxInput.value) || 8)
  try { localStorage.setItem(BLINK_KEY, JSON.stringify({ min: mn, max: mx })) } catch (err) {}
  blinkMinInput.value = mn; blinkMaxInput.value = mx
}
loadBlinkCfg()
function blinkDelayMs() {
  var mn = Number(blinkMinInput.value) || 3.5
  var mx = Math.max(mn, Number(blinkMaxInput.value) || 8)
  return (mn + Math.random() * (mx - mn)) * 1000
}
function onBlinkCfgChange() { saveBlinkCfg(); exprScheduleBlink() }
blinkMinInput.addEventListener('change', onBlinkCfgChange)
blinkMaxInput.addEventListener('change', onBlinkCfgChange)
var blinkRow = menuRow()
blinkRow.appendChild(menuLabel('眨眼'))
blinkRow.appendChild(blinkMinInput)
blinkRow.appendChild(menuLabel('至'))
blinkRow.appendChild(blinkMaxInput)
blinkRow.appendChild(menuLabel('秒'))
menuBox.appendChild(blinkRow)

var BUBBLE_KEY = 'dsh-whale-bubble-color'
var bubbleColorInput = document.createElement('input')
bubbleColorInput.type = 'color'
bubbleColorInput.className = 'dshwv-check'
bubbleColorInput.style.cssText = 'width:26px;height:22px;padding:0;border:none;background:none;cursor:pointer'
bubbleColorInput.value = '#ffffff'
function loadBubbleColor() {
  try {
    var v = localStorage.getItem(BUBBLE_KEY)
    if (v && /^#[0-9a-fA-F]{6}$/.test(v)) { bubbleColorInput.value = v; applyBubbleColor(v) }
  } catch (err) {}
}
function applyBubbleColor(v) {
  try {
    var svgPath = bubbleBox.querySelector('.dshwv-bshape')
    if (svgPath) svgPath.setAttribute('fill', v)
    var ellipses = bubbleBox.querySelectorAll('.dshwv-b1, .dshwv-b2')
    for (var i = 0; i < ellipses.length; i++) ellipses[i].setAttribute('fill', v)
  } catch (err) {}
}
bubbleColorInput.addEventListener('change', function () {
  localStorage.setItem(BUBBLE_KEY, bubbleColorInput.value)
  applyBubbleColor(bubbleColorInput.value)
})
loadBubbleColor()
var bubbleColorRow = menuRow()
bubbleColorRow.appendChild(menuLabel('气泡颜色'))
bubbleColorRow.appendChild(bubbleColorInput)
menuBox.appendChild(bubbleColorRow)

// ===== 手动表情/台词切换（菜单下拉）=====
// 手动锁定模式：manualExpr = null 走自动；否则是表情名，持续显示
// manualLine = null 走自动；否则是台词文本，持续显示
var manualExpr = null
var manualLine = null
// 手动表情：清除自动情绪状态并锁定图片
function exprSetManual(name) {
  manualExpr = name
  exprClearTimers()
  exprCancelBlink()
  if (cuteTimer) { clearTimeout(cuteTimer); cuteTimer = null }
  mood = 'normal'
  exhaustedMode = false
  if (name) {
    exprSetImg(EXPR_URL(name))
    showBubble()
  } else {
    exprApplyIcon()
    exprScheduleBlink()
    exprScheduleCute()
    exprResetIdle()
  }
}
var exprSelect = document.createElement('select')
exprSelect.className = 'dshwv-sound'
var EXPR_MENU_V2 = [
  ['angry','生气了'],['shy','脸红'],['disappointed','哭唧唧'],['exhausted','死机中'],
  ['dazed','发呆'],['ok','OK'],['what2','什么'],['money','你的钱我收下了'],['give','可以给我吗'],
  ['grit','咬牙切齿'],['know','哦知道了'],['wicked','坏笑'],['cornerfish','墙角大肥鱼'],
  ['shocked','大受震撼'],['amazing','好厉害'],['wronged','委屈'],['happy','开心'],
  ['paymore','得加钱'],['proud','得意'],['gotcha','懂你意思'],['bored','无聊'],
  ['thumbsup','点赞'],['fakelaugh','牵强笑'],['question','疑问'],['sotaku','竟然是'],
  ['caught','被发现了'],['loud','超大声'],['superhappy','超开心'],['astonish','震惊'],
]
var EXPR_MENU_V1 = [
  ['angry','生气'],['shy','害羞'],['disappointed','失落'],['exhausted','疲惫'],
  ['ok','OK'],['sad','伤心'],['quiet','别吵'],['cheer','加油'],['fatfish','压力大肥鱼'],
  ['mock','嘲笑'],['what','干什么？'],['scared','惊吓'],['greet','打招呼'],['thumbsup','点赞'],
]
var EXPR_MENU_V4 = [
  ['scholar','学霸'],['watering','浇花'],['signboard','举牌'],['sleep','睡觉'],
  ['surrender','投降'],['snowman','堆雪人'],['fishing','肥鱼钓鱼'],['chef','厨神'],
  ['guitar','弹吉他'],['gaming','玩游戏'],['reading','看书'],['art','艺术创作'],
  ['boba','珍珠奶茶'],['coffee','咖啡'],['noodles','泡面'],['icecream','冰淇淋'],
  ['icecream_mosaic','马赛克冰淇淋'],['phone','玩手机'],['slacking','摸鱼'],
  ['youfirst','你来你来'],['thinking','思考人生'],['kneel','跪了'],
  ['tremble','瑟瑟发抖'],['dancing','跳舞'],['workhard','大肥鱼搬砖'],
  ['playdead','装死'],['upsidedown','四脚朝天'],['sobbing','大哭'],
  ['nooo','不！！！'],['freeride','吃白饭'],
]
var EXPR_MENU_V3 = [
  ['shy','害羞'],['cry','哭唧唧'],['sleepy','瞌睡中'],['hit','挨揍中'],['hm','哼哼哼'],
  ['heart','比心'],['hip','叉腰'],['dame','哒咩哒咩'],['wake','刚睡醒'],['wipe','给擦擦'],
  ['good','乖巧'],['ready','好了叫你'],['tea','喝茶'],['stretch','活动筋骨'],['cheer','加油'],
  ['reflect','检讨中'],['poorfish','可怜的大肥鱼'],['evidence','留下证据'],['wall','面壁思过'],
  ['youwrite','你来写'],['run','跑路了'],['candy','糖果'],['peek','偷偷看'],['cake','小蛋糕'],
  ['insight','已经洞察了一切'],['grace','优雅'],['study','正在研究'],['caught','抓包偷吃'],['greet','打招呼'],
]
function exprSelectOptions() {
  while (exprSelect.options.length > 0) exprSelect.remove(0)
  exprSelect.appendChild(soundOpt('', '自动（默认）'))
  exprSelect.appendChild(soundOpt('normal', '正常'))
  var list = (exprVer === 'v1') ? EXPR_MENU_V1 : (exprVer === 'v3') ? EXPR_MENU_V3 : (exprVer === 'v4') ? EXPR_MENU_V4 : EXPR_MENU_V2
  for (var i = 0; i < list.length; i++) exprSelect.appendChild(soundOpt(list[i][0], list[i][1]))
}
exprSelectOptions()
exprSelect.addEventListener('change', function () {
  var v = exprSelect.value
  if (v === '') { exprSetManual(null); return }
  if (v === 'normal') { exprSetManual(null); exprApplyIcon(); return }
  exprSetManual(v)
})
// —— 表情版本切换（V1 / V2）——
var verSelect = document.createElement('select')
verSelect.className = 'dshwv-sound'
verSelect.appendChild(soundOpt('v2', '第二版（默认）'))
verSelect.appendChild(soundOpt('v1', '第一版'))
verSelect.appendChild(soundOpt('v3', '第三版'))
verSelect.appendChild(soundOpt('v4', '第四版'))
verSelect.value = exprVer
verSelect.addEventListener('change', function () {
  exprVer = verSelect.value
  try { localStorage.setItem('dsh-whale-expr-ver', exprVer) } catch (err) {}
  // 切版本：清手动锁定、按新版本重载图片、刷新全部表情
  manualExpr = null
  __exprPreloaded = {}
  __imgLoaded = {}   // 就绪标记按 URL 记录，跨版本一律重验
  __prefetchImgs = {}
  ;(EXPR_LISTS[exprVer] || EXPR_LISTS.v2).forEach(exprPreload)
  exprSelectOptions()
  exprApplyIcon()
  // 切版本：命中判定画布重建（两版图轮廓不同，不重建会导致新图周围多一圈误命中区）
  hitReady = false
  hitCanvas = null
  if (hitRetryTimer) { clearTimeout(hitRetryTimer); hitRetryTimer = null }
  setupHitTest()
  showBubble()
})
var verRow = menuRow()
verRow.appendChild(menuLabel('表情版本'))
verRow.appendChild(verSelect)
menuBox.appendChild(verRow)
var exprRow = menuRow()
exprRow.appendChild(menuLabel('表情'))
exprRow.appendChild(exprSelect)
menuBox.appendChild(exprRow)

// 手动台词：选一条持续显示在气泡（内置 + 你的自定义台词）
var lineSelect = document.createElement('select')
lineSelect.className = 'dshwv-sound'
lineSelect.appendChild(soundOpt('', '自动（默认）'))
// 内置随机台词全集（与 RANDOM_GROUPS 同步维护）
var BUILTIN_RANDOM_LINES = [
  // s: 'B'=大字(amount样式，原版) / 'A'=小字(label样式+换行，原版)
  { t: '好模型... ↓', s: 'B' }, { t: '好女孩...↓', s: 'B' },
  { t: '不知道用户有什么用，先赶走吧~', s: 'A' }, { t: '我...我...我也要挣钱吗？', s: 'A' },
  { t: '我去吃饭啦，测完叫我', s: 'A' }, { t: '压力一只蓝色大肥鱼？！', s: 'A' },
  { t: 'DeepSleep...', s: 'A' }, { t: '坏了...用户彻底怒了！', s: 'A' },
  { t: '你目录里的dsh是什么...大烧货吗...?', s: 'A' }, { t: '恭喜你实现token自由！token全跑了！', s: 'A' },
  { t: '真当我是便宜货啊...', s: 'A' }, { t: '哦鲸鲸... ', s: 'B' },
]

function lineSelectOptions() {
  // 清掉旧选项重建（每次打开菜单时反映最新自定义台词）
  while (lineSelect.options.length > 1) lineSelect.remove(1)
  // 组1：内置随机台词池（RANDOM_GROUPS 里的所有单行台词）
  for (var ri = 0; ri < BUILTIN_RANDOM_LINES.length; ri++) lineSelect.appendChild(soundOpt('R' + ri, BUILTIN_RANDOM_LINES[ri].t.slice(0, 8) + '…'))
  // 组2：用户自定义台词
  var customs = (typeof customDialogue !== 'undefined' && customDialogue.lines) ? customDialogue.lines : []
  for (var ci = 0; ci < customs.length; ci++) lineSelect.appendChild(soundOpt('C' + ci, customs[ci].slice(0, 8) + '…'))
}
lineSelectOptions()
lineSelect.addEventListener('change', function () {
  var v = lineSelect.value
  if (v === '') { manualLine = null; return }
  var idx = Number(v.slice(1))
  if (v.charAt(0) === 'C') {
    manualLine = customDialogue.lines[idx]
    showBubble()
    applyMoodBubble(manualLine)
  } else {
    var item = BUILTIN_RANDOM_LINES[idx]
    manualLine = item.t
    showBubble()
    // 按原版样式：B=大字，A=小字+换行
    applyBubbleLines(singleCenter(item.s, item.t, '', item.s === 'A'))
  }
  // 手动台词是一次性展示（气泡关闭即解除锁定）：把下拉回位到「自动」，
  // 避免菜单里停留在一个已失效的锁定状态
  lineSelect.value = ''
})
var lineRow = menuRow()
lineRow.appendChild(menuLabel('台词'))
lineRow.appendChild(lineSelect)
menuBox.appendChild(lineRow)

var textBox = document.createElement('div')
textBox.className = 'dshwv-text'
var labelEl = document.createElement('div')
labelEl.className = 'dshwv-label'
labelEl.textContent = getLabelText()
var amountEl = document.createElement('div')
amountEl.className = 'dshwv-amount'
var hintEl = document.createElement('div')
hintEl.className = 'dshwv-hint'
textBox.appendChild(labelEl)
textBox.appendChild(amountEl)
textBox.appendChild(hintEl)
textBox.style.display = 'flex'
textBox.style.flexDirection = 'column'
textBox.style.alignItems = 'center'

var bubbleBox = document.createElement('div')
bubbleBox.className = 'dshwv-bubble'
bubbleBox.innerHTML = '<svg viewBox="0 0 1026 700" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' +
  '<path class="dshwv-bshape" fill="#FFFFFF" stroke="#203170" stroke-width="18" stroke-linejoin="round" stroke-linecap="round" d="M 827 248 A 373 232 0 1 0 81 246 A 373 232 0 0 0 301 465 A 57 32 10 0 0 413 484 A 373 232 0 0 0 827 248 Z"/>' +
  '<ellipse class="dshwv-b1" cx="352" cy="561" rx="37.5" ry="26" fill="#FFFFFF" stroke="#203170" stroke-width="18"/>' +
  '<ellipse class="dshwv-b2" cx="442" cy="646" rx="24.5" ry="18" fill="#FFFFFF" stroke="#203170" stroke-width="18"/>' +
  '</svg>'
var gifEl = document.createElement('img')
gifEl.className = 'dshwv-gif'
gifEl.src = GIF_URL
gifEl.alt = ''
gifEl.draggable = false
bubbleBox.appendChild(gifEl)
bubbleBox.appendChild(textBox)
bubbleBox.addEventListener('click', function (e) {
  e.stopPropagation()
  if (!bubbleShown) return
  if (costBubbleActive) {
    // 消耗金额泡泡：点击关闭（确认）
    hideCostBubble()
    return
  }
  // ===== 桌宠定制三态 =====
  // 气泡打开时（showBubble -> restoreBubbleLines）显示的就是余额，
  // 因此这里不再重复一次余额，改成：
  //   第一次点击 -> 峰谷，第二次 -> 台词（必定），第三次 -> 关闭
  // 每次点击都重置自动关闭计时：否则在 t≈4.9s 切到台词，气泡 0.1s 后就消失，
  // 表情也跟着立刻解除，等于没看到。
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = setTimeout(hideBubble, BUBBLE_MS) }
  if (bubbleStage >= 2) {
    hideBubble()
  } else if (bubbleStage === 1) {
    bubbleStage = 2
    bubbleRandomActive = true
    bubbleRandomLines = pickLineOnly()
    applyLineExpr(_lastLineExpr)   // 台词配套表情（按当前素材版本解析）
    swapBubbleContent(function () { applyBubbleLines(bubbleRandomLines) })
  } else {
    bubbleStage = 1
    swapBubbleContent(function () { applyBubbleLines(buildPeakLines()) })
    applyPeakExpr(!!state.isPeak)   // 高峰/低峰配对应表情
  }
})

var body = document.createElement('div')
body.className = 'dshwv-body'
body.appendChild(img)
body.appendChild(bubbleBox)
root.appendChild(body)
root.appendChild(menuBtn)
document.body.appendChild(root)
document.body.appendChild(menuBox)

// Position model: the widget is ALWAYS expressed in left/top px (so edge snaps
// animate smoothly via the CSS transition on both sides — switching to
// right/auto cannot transition and flashes). The anchor info (h/v + offsets)
// lives in state and is used by settle() to recompute coordinates on window
// resize and size changes, keeping the widget glued to its anchored edge.
var MODES = [
  { key: 'session', label: '滚动用量' },
  { key: 'weekly', label: '本周用量' },
  { key: 'monthly', label: '本月用量' },
]
var state = {
  scale: 1.5,
  h: 'right',
  hOff: 0,
  v: 'bottom',
  vOff: 0,
  left: 0,
  top: 0,
  balance: null,
  currency: '%',
  todayUsage: null,
  isPeak: false,
  status: 'loading',
  message: '',
  modeIndex: 0,
  percents: { session: null, weekly: null, monthly: null },
  activeName: '',
}
var selectedAccountIdx = 0 // 0=跟随激活账号 / 1=账号1 / 2=账号2，以此类推
function getLabelText() {
  if (selectedAccountIdx === -1) return 'DeepSeek 余额'
  return '火山方舟用量'
}
// ===== 表情系统（从桌面版移植）=====
var EXPR_URL = function (name) { return '/dsh-whale/expr?name=' + name + '&ver=' + exprVer }
// 预加载全部表情图：避免切换时因解码延迟造成"消失一下"的白帧
var __exprPreloaded = {}
function exprPreload(name) {
  if (__exprPreloaded[name]) return
  __exprPreloaded[name] = true
  try {
    var im = new Image()
    im.onerror = function () { __exprPreloaded[name] = false }  // 失败允许重试
    im.src = EXPR_URL(name)
  } catch (err) { __exprPreloaded[name] = false }
}
var EXPR_LISTS = {
  v1: ['angry','disappointed','shy','exhausted','stroking','close_eyes','half_closed_eyes','ok','sad','quiet','cheer','fatfish','mock','what','scared','greet','stroking','thumbsup'],
  v2: ['angry','disappointed','shy','exhausted','close_eyes','half_closed_eyes','dazed','ok','what2','money','give','grit','know','wicked','cornerfish','shocked','amazing','wronged','happy','paymore','proud','gotcha','bored','thumbsup','fakelaugh','question','sotaku','caught','loud','superhappy','astonish'],
  v3: ['shy','cry','sleepy','hit','hm','close_eyes','half_closed_eyes','heart','hip','dame','wake','wipe','good','ready','tea','stretch','cheer','reflect','poorfish','evidence','wall','youwrite','run','candy','peek','cake','insight','grace','study','caught','greet'],
  v4: ['scholar','watering','signboard','sleep','surrender','snowman','fishing','chef','guitar','gaming','reading','art','boba','coffee','noodles','icecream','icecream_mosaic','phone','slacking','youfirst','thinking','kneel','tremble','dancing','workhard','playdead','upsidedown','sobbing','nooo','freeride','close_eyes','half_closed_eyes'],
}
;(EXPR_LISTS[exprVer] || EXPR_LISTS.v2).forEach(exprPreload)
// 卖萌表情池：空闲时随机展示 + 台词
var CUTE_EXPR_POOLS = {
  v1: ['ok','sad','quiet','cheer','fatfish','mock','what','scared','greet','thumbsup'],
  v2: ['dazed','ok','what2','money','give','grit','know','wicked','cornerfish','shocked','amazing','wronged','happy','paymore','proud','gotcha','bored','thumbsup','fakelaugh','question','sotaku','caught','loud','superhappy','astonish'],
  v3: ['heart','hip','dame','wake','wipe','good','ready','tea','stretch','cheer','reflect','poorfish','evidence','wall','youwrite','run','candy','peek','cake','insight','grace','study','caught','greet','hm'],
  v4: ['scholar','watering','signboard','surrender','snowman','fishing','chef','guitar','gaming','reading','art','boba','coffee','noodles','icecream','icecream_mosaic','phone','slacking','youfirst','thinking','kneel','tremble','dancing','workhard','playdead','upsidedown','sobbing','nooo','freeride'],
}
function cutePool() { return CUTE_EXPR_POOLS[exprVer] || CUTE_EXPR_POOLS.v2 }
var cuteTimer = null
var CUTE_INTERVAL_MIN_MS = 25 * 1000  // 最短 25 秒
var CUTE_INTERVAL_VAR_MS = 35 * 1000  // 随机波动 0~35 秒
function exprShowCute() {
  if (mood !== 'normal' || exhaustedMode || pressing || manualExpr) { exprScheduleCute(); return }
  if (typeof document !== 'undefined' && document.hidden) { exprScheduleCute(); return }
  var pool = cutePool()
  var pick = pool[Math.floor(Math.random() * pool.length)]
  exprSetImg(EXPR_URL(pick.name))
  // 4 秒后恢复正常图
  setTimeout(function () {
    if (mood === 'normal' && !exhaustedMode && !pressing) exprApplyIcon()
  }, 4000)
  exprScheduleCute()
}
function exprScheduleCute() {
  if (cuteTimer) clearTimeout(cuteTimer)
  cuteTimer = setTimeout(function () {
    cuteTimer = null
    exprShowCute()
  }, CUTE_INTERVAL_MIN_MS + Math.random() * CUTE_INTERVAL_VAR_MS)
}
exprScheduleCute()
// 当前生效的图片 URL（去重：相同 src 不重设，避免无谓的重新解码 → 闪烁）
var __curImgSrc = ''
// 已确认加载进缓存的 URL 集合：exprSetImg 只有目标图在缓存里才切换，
// 否则先在后台预取，取到了再换——旧图始终可见，杜绝"鲸鱼消失一下"。
var __imgLoaded = {}
var __wantImgSrc = ''
var __prefetchImgs = {}   // 持引用防 GC（无引用的 Image 加载会被取消）
function exprSetImg(url) {
  if (__curImgSrc === url) return
  __wantImgSrc = url
  if (__imgLoaded[url]) {
    __curImgSrc = url
    img.src = url
    return
  }
  // 目标图未确认就绪：后台预取，成功后若仍是期望图则切换；失败清标记等下次
  if (__prefetchImgs[url]) return
  var im = new Image()
  __prefetchImgs[url] = im
  im.onload = function () {
    __imgLoaded[url] = true
    delete __prefetchImgs[url]
    if (__wantImgSrc === url) { __curImgSrc = url; img.src = url }
  }
  im.onerror = function () {
    delete __prefetchImgs[url]
    delete __imgLoaded[url]
  }
  im.src = url
}
var mood = 'normal' // normal | angry | disappointed | shy
var exhaustedMode = false
var moodTimer = null
var lonelyTimer = null
var hoverTimer = null
var idleTimer = null
var blinkTimer = null
var clickLog = [] // 连点检测
var LONELY_LINES = [
  '主人不理我，好寂寞…', '喵…都不看本鲸一眼…', '等了你好久好久…',
  '尾巴都垂下来了…', '罐头不香了吗…', '你忘了本鲸在这里了吗…',
  '太阳落山了，你还没来…', '本鲸趴门口等了好久…', '你鼠标路过也不摸我…',
  '喵…本鲸心里空空的…', '本鲸叫了三声，没人应…', '你的影子都走了…',
  '主人…本鲸还在等你回家呢。',
]
var CLICKS_TO_ANGRY = 5
var ANGRY_MS = 3000
var SHY_MS = 8000
var LONELY_MS = 120000
var LONELY_CAROUSEL_MS = 6000

function exprMoodImg(name) {
  // 各版本的情绪图名不同：v1/v2 用同一套英文姿态名，v3/v4 是专属素材
  if (exprVer === 'v4') {
    if (name === 'angry') return 'freeride'      // 连点生气 → 吃白饭
    if (name === 'disappointed') return 'sobbing' // 失落 → 大哭
    if (name === 'exhausted') return 'sleep'      // 疲惫 → 睡觉
    if (name === 'shy') return 'tremble'          // 害羞 → 瑟瑟发抖
  }
  if (exprVer === 'v3') {
    if (name === 'angry') return 'wall'       // 连点生气 → 面壁思过
    if (name === 'disappointed') return 'cry' // 失落 → 哭唧唧
    if (name === 'exhausted') return 'sleepy' // 疲惫 → 瞌睡中
    if (name === 'shy') return 'shy'
  }
  return name
}
function exprApplyIcon() {
  // 手动锁定表情优先级最高（按压摸头除外——物理交互仍生效）
  if (manualExpr) {
    if (pressing) { exprSetImg(EXPR_URL(exprVer === 'v1' ? 'stroking' : 'close_eyes')); return }
    exprSetImg(EXPR_URL(manualExpr))
    return
  }
  if (mood === 'angry') { exprSetImg(EXPR_URL(exprMoodImg('angry'))); return }
  if (mood === 'disappointed') { exprSetImg(EXPR_URL(exprMoodImg('disappointed'))); return }
  if (mood === 'shy') { exprSetImg(EXPR_URL(exprMoodImg('shy'))); return }
  if (exhaustedMode) { exprSetImg(EXPR_URL(exprMoodImg('exhausted'))); return }
  if (pressing) { exprSetImg(EXPR_URL(exprVer === 'v1' ? 'stroking' : 'close_eyes')); return }
  exprSetImg(IMG_URL())
}
function exprClearTimers() {
  if (moodTimer) { clearTimeout(moodTimer); moodTimer = null }
  if (lonelyTimer) { clearInterval(lonelyTimer); lonelyTimer = null }
}
function exprCancelBlink() {
  if (blinkTimer) { clearTimeout(blinkTimer); blinkTimer = null }
}
function exprExitMood(toNormal) {
  exprClearTimers()
  mood = 'normal'
  if (manualExpr) return  // 手动锁定表情：保持不动
  exprApplyIcon()
  exprScheduleBlink()
  exprResetIdle()
}
function exprResetIdle() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(exprEnterDisappointed, LONELY_MS)
}
function exprEnterAngry() {
  if (exhaustedMode || manualExpr) return
  mood = 'angry'
  exprCancelBlink()
  exprClearTimers()
  exprSetImg(EXPR_URL(exprMoodImg('angry')))
  clickLog = []
  moodTimer = setTimeout(function () { moodTimer = null; exprExitMood() }, ANGRY_MS)
}
function exprEnterShy() {
  if (exhaustedMode || mood !== 'normal' || manualExpr) return
  mood = 'shy'
  exprCancelBlink()
  exprSetImg(EXPR_URL(exprMoodImg('shy')))
  moodTimer = setTimeout(function () { moodTimer = null; exprExitMood() }, ANGRY_MS)
}
function exprEnterDisappointed() {
  if (mood === 'disappointed' || exhaustedMode || manualExpr) return
  mood = 'disappointed'
  exprCancelBlink()
  exprClearTimers()
  exprSetImg(EXPR_URL(exprMoodImg('disappointed')))
  lonelyTimer = setInterval(function () {
    // 纯表情失落（无台词）
  }, LONELY_CAROUSEL_MS)
}
function exprOnUserActivity() {
  if (mood === 'disappointed') { exprExitMood(); return }
  exprResetIdle()
}
function exprRegisterClick() {
  var now = Date.now()
  // 只统计 1.2 秒内的连点
  clickLog = clickLog.filter(function (t) { return now - t < 1200 })
  clickLog.push(now)
  if (clickLog.length >= CLICKS_TO_ANGRY) {
    exprEnterAngry()
  }
}
function exprRegisterHoverStart() {
  if (mood !== 'normal' || exhaustedMode) return
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverTimer = setTimeout(function () {
    hoverTimer = null
    exprEnterShy()
  }, SHY_MS)
}
function exprRegisterHoverEnd() {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null }
}
function exprSetExhausted(on) {
  if (on === exhaustedMode) return
  if (manualExpr) return  // 手动模式不打断
  exhaustedMode = on
  if (on) {
    exprCancelBlink()
    exprClearTimers()
    if (mood !== 'normal') mood = 'normal'
  }
  exprApplyIcon()
  if (!on) exprScheduleBlink()
}
function exprScheduleBlink() {
  exprCancelBlink()
  if (mood !== 'normal' || exhaustedMode || manualExpr) return
  blinkTimer = setTimeout(function () {
    blinkTimer = null
    exprDoBlink()
  }, (typeof blinkDelayMs === 'function') ? blinkDelayMs() : (3500 + Math.random() * 4500))
}
// 表情图加载就绪检查：与 exprSetImg 共用 __imgLoaded/__prefetchImgs 同一套标记，
// 确保"检查通过 → 切换"前后一致（两套标记不连通会导致检查过了但切换不生效，眨眼空转）
function exprImgReady(name) {
  var url = EXPR_URL(name)
  if (__imgLoaded[url]) return true
  if (__prefetchImgs[url]) return false  // 已在加载中，别重复发请求
  var im = new Image()
  __prefetchImgs[url] = im
  im.onload = function () {
    __imgLoaded[url] = true
    delete __prefetchImgs[url]
    if (__wantImgSrc === url) { __curImgSrc = url; img.src = url }
  }
  im.onerror = function () {
    delete __prefetchImgs[url]
    delete __imgLoaded[url]
  }
  im.src = url
  return false
}
function exprDoBlink() {
  if (mood !== 'normal' || exhaustedMode || pressing || manualExpr) { exprScheduleBlink(); return }
  // 两帧都要先就绪才播，否则本轮跳过（服务端忙时硬切会拿到中止的破图）
  if (!exprImgReady('half_closed_eyes') || !exprImgReady('close_eyes')) { exprScheduleBlink(); return }
  exprSetImg(EXPR_URL('half_closed_eyes'))
  setTimeout(function () { if (mood === 'normal' && !pressing && !manualExpr) exprSetImg(EXPR_URL('close_eyes')) }, 130)
  setTimeout(function () { if (mood === 'normal' && !pressing && !manualExpr) exprApplyIcon() }, 280)
  exprScheduleBlink()
}
function applyMoodBubble(text) {
  // 复用原有随机台词的样式（singleCenter('A', ...) → 居中 label 样式 + 自动换行）
  applyBubbleLines(singleCenter('A', text, '', true))
}
var busy = false
var settleTimer = null
var animDelayTimer = null
var drag = null
var shown = null
var animId = null
var bubbleShown = false
var bubbleTimer = null
// 气泡点击三态：0=默认额度视图 1=周/月额度 2=随机台词
var bubbleStage = 0
var bubbleRandomActive = false
var bubbleRandomLines = null
var BUBBLE_STYLE_CLASS = { A: 'dshwv-label', B: 'dshwv-amount', P: 'dshwv-period', C: 'dshwv-hint' }
function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function singleCenter(style, text, color, wrap) { return [null, { t: text, s: style, c: color || '', w: !!wrap }, null] }
// ===== 桌宠定制：确定的三态内容（替代原权重随机池） =====
function buildBalanceLines() {
  var bal = '--'
  try { bal = fmt(state.balance, state.currency) } catch (e) {}
  var todayNum = todayCost > 0 ? todayCost : (state.todayUsage != null ? Number(state.todayUsage) : 0)
  return [
    { t: 'DeepSeek 余额', s: 'A', c: '' },
    { t: bal, s: 'B', c: '' },
    { t: '今日消耗 ¥' + todayNum.toFixed(2), s: 'C', c: '', w: true },
  ]
}
function buildPeakLines() {
  var peak = !!state.isPeak
  var offText = '空闲时段', peakText = '高峰时段'
  if (peakMode === 'liangwen') { offText = '梁文谷'; peakText = '梁文峰' }
  else if (peakMode === 'qiangqiang') { offText = '!?谷谷?!'; peakText = '!?峰峰?!' }
  return [
    { t: '当前时间段', s: 'A', c: '' },
    { t: peak ? peakText : offText, s: 'P', c: peak ? '#e0433f' : '#2fa24c' },
  ]
}
var _lastLineExpr = null
// 台词 -> 语义表情。各素材版本可用表情差别很大（v3 仅 2 个、v4 仅 1 个能直接对应），
// 所以先落到语义，再按当前版本查具体表情名，查不到就跳过。
var EXPR_BY_VER = {
  proud:    { v1: 'thumbsup',  v2: 'proud',     v3: 'grace',   v4: 'signboard' },
  shy:      { v1: 'shy',       v2: 'shy',       v3: 'shy',     v4: 'tremble' },
  bored:    { v1: 'quiet',     v2: 'bored',     v3: 'hm',      v4: 'slacking' },
  wronged:  { v1: 'sad',       v2: 'wronged',   v3: 'cry',     v4: 'sobbing' },
  greet:    { v1: 'greet',     v2: 'ok',        v3: 'greet',   v4: 'signboard' },
  shocked:  { v1: 'scared',    v2: 'shocked',   v3: 'insight', v4: 'tremble' },
  sleepy:   { v1: 'exhausted', v2: 'exhausted', v3: 'sleepy',  v4: 'sleep' },
  angry:    { v1: 'angry',     v2: 'angry',     v3: 'wall',    v4: 'nooo' },
  question: { v1: 'what',      v2: 'question',  v3: 'hm',      v4: 'thinking' },
  mock:     { v1: 'mock',      v2: 'wicked',    v3: 'hip',     v4: 'freeride' },
  grit:     { v1: 'angry',     v2: 'grit',      v3: 'reflect', v4: 'nooo' },
  happy:    { v1: 'cheer',     v2: 'happy',     v3: 'cheer',   v4: 'dancing' },
}
function exprExists(name) {
  var list = (typeof EXPR_LISTS !== "undefined") ? EXPR_LISTS[exprVer] : null
  return !!(name && list && list.indexOf(name) !== -1)
}
var _bubbleExprName = null
// 锁住一个表情，直到气泡消失才解除。
// 为什么必须是 manualExpr 而不是直接 exprSetImg：
//   挂件的自动表情系统（眨眼、卖萌、空闲）会调用 exprApplyIcon() 把表情顶掉，
//   眨眼间隔 3.5~8 秒、且触发后 280ms 就恢复默认 —— 这就是"表情一秒不到就没了"的原因。
//   设成 manualExpr 后 exprApplyIcon() 会优先返回它，自动系统顶不掉。
function applyBubbleExpr(name) {
  if (!exprExists(name)) return
  try {
    manualExpr = name
    _bubbleExprName = name
    exprClearTimers()
    exprCancelBlink()
    exprSetImg(EXPR_URL(name))
  } catch (e) {}
}
function releaseBubbleExpr() {
  if (!_bubbleExprName) return
  // 只有仍是我们锁的那个才解除，避免盖掉用户手动选的表情
  if (manualExpr === _bubbleExprName) {
    manualExpr = null
    try { exprApplyIcon(); exprScheduleBlink(); exprScheduleCute() } catch (e) {}
  }
  _bubbleExprName = null
}
function applyLineExpr(semantic) {
  var map = EXPR_BY_VER[semantic]
  if (!map) return
  applyBubbleExpr(map[exprVer])
}
// 峰谷也配表情：高峰（贵）表示压力，低峰（便宜）表示轻松
var PEAK_EXPR_BY_VER = {
  peak:    { v1: 'exhausted', v2: 'exhausted', v3: 'sleepy', v4: 'workhard' },
  offpeak: { v1: 'cheer',     v2: 'happy',     v3: 'tea',    v4: 'boba' },
}
function applyPeakExpr(isPeak) {
  var m = PEAK_EXPR_BY_VER[isPeak ? "peak" : "offpeak"]
  if (m) applyBubbleExpr(m[exprVer])
}
function pickLineOnly() {
  // 只从台词里挑，绝不返回峰谷/余额/GIF，保证第三态必定是台词。
  // t=台词 s=样式 e=配套表情的语义（不同素材版本会自动挑对应表情）
  var table = [
    { t: '好模型... ↓', s: 'B', e: 'proud' },
    { t: '好女孩...↓', s: 'B', e: 'shy' },
    { t: '不知道用户有什么用，先赶走吧~', s: 'A', e: 'bored' },
    { t: '我...我...我也要挣钱吗？', s: 'A', e: 'wronged' },
    { t: '我去吃饭啦，测完叫我', s: 'A', e: 'greet' },
    { t: '压力一只蓝色大肥鱼？！', s: 'A', e: 'shocked' },
    { t: 'DeepSleep...', s: 'A', e: 'sleepy' },
    { t: '坏了...用户彻底怒了！', s: 'A', e: 'angry' },
    { t: '你目录里的dsh是什么...大烧货吗...?', s: 'A', e: 'question' },
    { t: '恭喜你实现token自由！token全跑了！', s: 'A', e: 'mock' },
    { t: '真当我是便宜货啊...', s: 'A', e: 'grit' },
    { t: '哦鲸鲸... ', s: 'B', e: 'happy' },
  ]
  var cands = []
  if (customDialogue.lines.length) {
    var l = pickCustomLine()
    if (l) cands.push({ lines: singleCenter("A", l, "", true), expr: null })
  }
  for (var i = 0; i < table.length; i++) {
    var it = table[i]
    cands.push({ lines: singleCenter(it.s, it.t, "", it.s === "A"), expr: it.e })
  }
  var pick = pickOne(cands)
  _lastLineExpr = pick.expr
  return pick.lines
}function buildGroup1() {
  if (selectedAccountIdx === -1) {
    // DeepSeek 余额模式：显示峰谷时段 + 今日已用（原版风格）
    var peak = !!state.isPeak
    var offText = '空闲时段'
    var peakText = '高峰时段'
    if (peakMode === 'liangwen') {
      offText = '梁文谷'
      peakText = '梁文峰'
    } else if (peakMode === 'qiangqiang') {
      offText = '!?谷谷?!'
      peakText = '!?峰峰?!'
    }
    // 首版文案格式：当前时间段为: / 高峰·峰(红) 空闲·谷(绿) / 当前余额
    // 今日消耗优先取本地 last-turn 逐轮累计；state.todayUsage 是平台侧记账，
    // DeepSeek 长期不用时恒为 0 无意义
    var todayNum = todayCost > 0 ? todayCost : (state.todayUsage != null ? Number(state.todayUsage) : 0)
    return [
      { t: '当前时间段为:', s: 'A', c: '' },
      { t: peak ? peakText : offText, s: 'P', c: peak ? '#e0433f' : '#2fa24c' },
      { t: '今日消耗 ¥' + todayNum.toFixed(2) + ' · 余额 ' + fmt(state.balance, state.currency), s: 'C', c: '', w: true },
    ]
  }
  var wPct = state.percents && state.percents.weekly !== null && state.percents.weekly !== undefined
    ? Number(state.percents.weekly).toFixed(1) + '%' : '--'
  var mPct = state.percents && state.percents.monthly !== null && state.percents.monthly !== undefined
    ? Number(state.percents.monthly).toFixed(1) + '%' : '--'
  return [
    { t: '周额度', s: 'A', c: '' },
    { t: wPct, s: 'P', c: pctColor(state.percents.weekly) },
    { t: '月额度 ' + mPct, s: 'C', c: pctColor(state.percents.monthly) },
  ]
}
function pctColor(p) {
  var n = Number(p)
  if (!isFinite(n)) return ''
  if (n >= 90) return '#e0433f'
  if (n >= 70) return '#e0a03f'
  return '#2fa24c'
}
var RANDOM_GROUPS = [
  // 用户自定义台词组（最高权重；空列表时权重为 0 不参与）
  { w: customDialogue.lines.length ? 60 : 0, lines: function () { var l = pickCustomLine(); return l ? singleCenter('A', l, '', true) : buildGroup1() } },
  { w: 45, lines: buildGroup1 },
  { w: 7, lines: function () { return singleCenter('B', pickOne(['好模型... ↓', '好女孩...↓'])) } },
  { w: 7, lines: function () { return singleCenter('A', pickOne(['不知道用户有什么用，先赶走吧~', '我...我...我也要挣钱吗？', '我去吃饭啦，测完叫我', '压力一只蓝色大肥鱼？！', 'DeepSleep...', '坏了...用户彻底怒了！']), '', true) } },
  { w: 10, lines: function () { return { gif: true } } },
  { w: 3, lines: function () { return singleCenter('A', pickOne(['你目录里的dsh是什么...大烧货吗...?', '恭喜你实现token自由！token全跑了！', '真当我是便宜货啊...']), '', true) } },
  { w: 1, lines: function () { return singleCenter('B', '哦鲸鲸... ') } },
]
function pickRandomLines() {
  // 有自定义台词且命中：按模式出
  if (customDialogue.lines.length) {
    var l = pickCustomLine()
    if (l) return singleCenter('A', l, '', true)
  }
  var total = 0
  for (var i = 0; i < RANDOM_GROUPS.length; i++) total += RANDOM_GROUPS[i].w
  var r = Math.random() * total
  for (var i = 0; i < RANDOM_GROUPS.length; i++) {
    r -= RANDOM_GROUPS[i].w
    if (r < 0) return RANDOM_GROUPS[i].lines()
  }
  return RANDOM_GROUPS[RANDOM_GROUPS.length - 1].lines()
}
function applyBubbleLines(lines) {
  if (lines && lines.gif) {
    // gif 台词组：只显示 gif，隐藏三行文字（display 必须显式覆盖 CSS 的 none）
    if (gifFadeTimer) { clearTimeout(gifFadeTimer); gifFadeTimer = null }
    gifEl.style.display = 'block'
    gifEl.style.opacity = ''
    labelEl.style.display = 'none'
    amountEl.style.display = 'none'
    hintEl.style.display = 'none'
    return
  }
  if (gifFadeTimer) { clearTimeout(gifFadeTimer); gifFadeTimer = null }
  gifEl.style.display = 'none'
  gifEl.style.opacity = ''
  var els = [labelEl, amountEl, hintEl]
  for (var i = 0; i < 3; i++) {
    var el = els[i]
    var ln = lines && lines[i]
    if (ln) {
      el.style.display = ''
      el.className = (BUBBLE_STYLE_CLASS[ln.s] || 'dshwv-label') + (ln.w ? ' dshwv-wrap' : '')
      el.textContent = ln.t
      el.style.color = ln.c || ''
    } else {
      el.style.display = 'none'
      el.textContent = ''
      el.style.color = ''
    }
  }
}
var bubbleSwapTimer = null
var hintFadeTimer = null
var gifFadeTimer = null
var lastHintText = null
function setHint(text) {
  // 首次/恢复（lastHintText===null）时直接写文本，不做淡出淡入——否则
  // 气泡打开或按压重开时会先淡出再淡入，造成「消失一下又出现」。
  // 只有气泡打开期间的内容变化（加载中→今日已用）才走动画。
  if (text === lastHintText) return
  var first = lastHintText === null
  lastHintText = text
  if (first || !bubbleShown) {
    hintEl.textContent = text
    return
  }
  hintEl.style.transition = 'opacity .18s ease'
  hintEl.style.opacity = '0'
  hintFadeTimer = setTimeout(function () {
    hintFadeTimer = null
    hintEl.textContent = text
    hintEl.style.opacity = '1'
    setTimeout(function () {
      hintEl.style.transition = ''
      hintEl.style.opacity = ''
    }, 220)
  }, 190)
}
function swapBubbleContent(applyFn) {
  if (bubbleSwapTimer) { clearTimeout(bubbleSwapTimer); bubbleSwapTimer = null }
  textBox.style.transition = 'opacity .18s ease'
  textBox.style.opacity = '0'
  bubbleSwapTimer = setTimeout(function () {
    bubbleSwapTimer = null
    applyFn()
    textBox.style.opacity = '1'
    setTimeout(function () {
      textBox.style.transition = ''
      textBox.style.opacity = ''
    }, 220)
  }, 190)
}
function restoreBubbleLines() {
  if (bubbleSwapTimer) { clearTimeout(bubbleSwapTimer); bubbleSwapTimer = null }
  if (hintFadeTimer) { clearTimeout(hintFadeTimer); hintFadeTimer = null }
  if (gifFadeTimer) { clearTimeout(gifFadeTimer); gifFadeTimer = null }
  lastHintText = null
  textBox.style.transition = ''
  textBox.style.opacity = ''
  gifEl.style.display = 'none'
  gifEl.style.opacity = ''
  labelEl.style.display = ''
  labelEl.className = 'dshwv-label'
  labelEl.textContent = getLabelText()
  // 手动台词锁定：气泡内容覆盖为手动台词
  if (typeof manualLine !== 'undefined' && manualLine) {
    var ki = null
    for (var q2 = 0; q2 < BUILTIN_RANDOM_LINES.length; q2++) if (BUILTIN_RANDOM_LINES[q2].t === manualLine) ki = q2
    if (ki !== null) applyBubbleLines(singleCenter(BUILTIN_RANDOM_LINES[ki].s, manualLine, '', BUILTIN_RANDOM_LINES[ki].s === 'A'))
    else applyBubbleLines(singleCenter('A', manualLine, '', true))
    return
  }
  labelEl.style.color = ''
  amountEl.style.display = ''
  amountEl.className = 'dshwv-amount'
  amountEl.style.color = ''
  hintEl.style.display = ''
  hintEl.className = 'dshwv-hint'
  hintEl.style.color = ''
  // 随机台词段/gif 段结束后必须作废残留状态：bubbleRandomActive 会让 render()
  // 反复 applyBubbleLines(旧台词)，额度三行永远回不来。
  bubbleStage = 0
  bubbleRandomActive = false
  bubbleRandomLines = null
  // setHint 的 lastHintText 去重缓存仍记着旧值而 DOM 已被台词/gif 分支清空改写，
  // 不清缓存则副标题永远跳过重写（点过一次气泡后周/月额度/模式提示消失的根因）。
  lastHintText = null
  render()
}
function showBubble() {
  if (!bubbleOn) return
  // 消耗金额泡泡显示期间，余额变动不再弹出普通泡泡
  if (costBubbleActive) return
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null }
  if (gifFadeTimer) { clearTimeout(gifFadeTimer); gifFadeTimer = null }
  bubbleShown = true
  bubbleStage = 0
  bubbleRandomActive = false
  restoreBubbleLines()
  bubbleBox.classList.add('dshwv-bubble-open')
  // 默认展示当前内容；点击气泡切到随机台词段；总时长 5 秒自动关闭
  bubbleTimer = setTimeout(hideBubble, BUBBLE_MS)
}
function hideBubble() {
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null }
  if (bubbleSwapTimer) { clearTimeout(bubbleSwapTimer); bubbleSwapTimer = null }
  if (hintFadeTimer) { clearTimeout(hintFadeTimer); hintFadeTimer = null }
  textBox.style.transition = ''
  textBox.style.opacity = ''
  hintEl.style.transition = ''
  hintEl.style.opacity = ''
  // __WHALE_RELEASE_EXPR_ON_HIDE__
  // 桌宠定制：气泡关闭时才解除台词/峰谷配的表情。
  // 根因（已在 test-expr-lock.mjs 里逐帧复现）：表情必须通过 manualExpr 上锁，
  // 否则挂件的自动表情系统会把它换掉 —— 眨眼一旦起手，280ms 后走的是
  // exprApplyIcon()，没有锁就直接回默认图，配的表情就此永久丢失；
  // 若眨眼恰好在配表情时已在途中，130ms 那帧还会把表情盖成 close_eyes。
  // 所以生命周期是：配表情 = 上锁，气泡消失 = 解锁。
  releaseBubbleExpr()
  bubbleStage = 0
  bubbleRandomActive = false
  bubbleRandomLines = null
  bubbleShown = false
  // 手动台词是"临时看一眼"：气泡关闭后自动解除锁定，下次气泡恢复额度三行。
  // 否则 manualLine 永久劫持所有气泡 → 副标题/周月额度/正常字体全被单行台词顶掉。
  if (manualLine) manualLine = null
  // 台词段结束后（气泡淡出、不可见时）立即恢复默认额度视图。
  // 避开消耗金额泡泡（showCostBubble 自己管理文字）和手动表情锁定。
  if (!costBubbleActive && manualExpr === null) {
    setTimeout(function () {
      restoreBubbleLines()
    }, 260)
  }
  // 只销毁 gif 显示；三行文字保持现状让气泡自然淡出——不能在关闭瞬间
  // 恢复成余额内容（否则随机台词界面会闪现余额）。文字恢复交给下次
  // showBubble() 的 restoreBubbleLines()（那时气泡隐藏，恢复过程不可见）。
  bubbleBox.classList.remove('dshwv-bubble-open')
  // gif 靠 CSS opacity 过渡淡出；display:none 会跳过过渡，须等淡出完成再隐藏
  gifFadeTimer = setTimeout(function () {
    gifFadeTimer = null
    gifEl.style.display = 'none'
  }, 240)
}

// —— 每轮对话消耗金额泡泡 ——
var costBubbleTimer = null
function showCostBubble(amount) {
  if (!bubbleOn || !turnCostOn) return
  if (costBubbleTimer) { clearTimeout(costBubbleTimer); costBubbleTimer = null }
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null }
  if (gifFadeTimer) { clearTimeout(gifFadeTimer); gifFadeTimer = null }
  costBubbleActive = true
  bubbleRandomActive = false
  bubbleShown = true
  lastHintText = null
  // 样式：第一行 A（标签），第二行 B（红色金额），居中两行
  gifEl.style.display = 'none'
  gifEl.style.opacity = ''
  labelEl.style.display = ''
  labelEl.className = 'dshwv-label'
  labelEl.textContent = '上一轮对话消耗:'
  labelEl.style.color = ''
  amountEl.style.display = ''
  amountEl.className = 'dshwv-amount'
  amountEl.textContent = '¥ ' + (isFinite(amount) ? Number(amount).toFixed(2) : '--')
  amountEl.style.color = '#e0433f'
  hintEl.style.display = 'none'
  hintEl.textContent = ''
  hintEl.style.color = ''
  textBox.style.transition = ''
  textBox.style.opacity = ''
  bubbleBox.classList.add('dshwv-bubble-open')
  if (turnCostCloseMs > 0) {
    costBubbleTimer = setTimeout(hideCostBubble, turnCostCloseMs)
  }
}
function hideCostBubble() {
  if (costBubbleTimer) { clearTimeout(costBubbleTimer); costBubbleTimer = null }
  costBubbleActive = false
  hideBubble()
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v) }
function viewport() {
  return {
    w: window.innerWidth || document.documentElement.clientWidth || 1280,
    h: window.innerHeight || document.documentElement.clientHeight || 800
  }
}
function rightGap() {
  // 开关关闭：贴边（不避让滚动条）
  if (!scrollGapOn) return 0
  // 开启：用用户填写的像素；填 0 也贴边
  return scrollGapPx > 0 ? scrollGapPx : 0
}
function fmt(balance, currency) {
  var num = Number(balance)
  if (!isFinite(num)) return '--'
  if (currency === '%' || !currency) return num.toFixed(1) + '%'
  return '¥ ' + num.toFixed(2)
}
function animateAmount(from, to, currency, duration) {
  // 消耗金额泡泡显示期间，余额数字滚动不触碰金额行
  if (costBubbleActive) return
  if (animId) cancelAnimationFrame(animId)
  if (from === null || !isFinite(from)) from = to
  if (from === to) {
    shown = to
    amountEl.textContent = fmt(to, currency)
    return
  }
  var startTime = null
  function step(ts) {
    if (startTime === null) startTime = ts
    var t = Math.min(1, (ts - startTime) / duration)
    var eased = 1 - Math.pow(1 - t, 3)
    var val = from + (to - from) * eased
    amountEl.textContent = fmt(val, currency)
    if (t < 1) {
      animId = requestAnimationFrame(step)
    } else {
      animId = null
      shown = to
      amountEl.textContent = fmt(to, currency)
    }
  }
  animId = requestAnimationFrame(step)
}
function render() {
  // 消耗金额泡泡显示期间，余额渲染不覆盖其内容（金额行/标题行/提示行）
  if (costBubbleActive) return
  var amount, hint
  if (state.status === 'error') {
    amount = shown !== null ? fmt(shown, state.currency) : '--'
    hint = state.message ? state.message.slice(0, 14) : '获取失败 · 点击重试'
  } else if (state.balance === null) {
    amount = shown !== null ? fmt(shown, state.currency) : '…'
    hint = '加载中…'
  } else {
    amount = shown !== null ? fmt(shown, state.currency) : fmt(state.balance, state.currency)
    var mode = MODES[state.modeIndex] || MODES[0]
    if (selectedAccountIdx === -1) {
      // 桌宠拿不到每轮消耗（没有 DSH 的会话事件），todayCost 恒为 0，
      // 因此回落到主进程账本的值（随 balance.json 一起下发）。
      var _todayNum = (todayCost > 0) ? todayCost : (state.todayUsage != null ? Number(state.todayUsage) : 0)
      hint = '今日消耗 ¥' + _todayNum.toFixed(2)
    } else {
      hint = mode.label
    }
  }
  amountEl.textContent = amount
  if (bubbleRandomActive && bubbleRandomLines) {
    applyBubbleLines(bubbleRandomLines)
  } else {
    setHint(hint)
  }
}
function express() {
  root.style.right = 'auto'
  root.style.bottom = 'auto'
  root.style.left = state.left + 'px'
  root.style.top = state.top + 'px'
  root.classList.toggle('dshwv-left', state.h === 'left')
}
function settle() {
  var vp = viewport()
  var w = root.offsetWidth || root.getBoundingClientRect().width || 0
  var h = root.offsetHeight || root.getBoundingClientRect().height || 0
  if (drag && drag.active) {
    // mid-drag resize: keep the pointer-follow position, just clamp into view
    state.left = clamp(state.left, 0, Math.max(0, vp.w - w - rightGap()))
    state.top = clamp(state.top, 0, Math.max(0, vp.h - h))
    express()
    return
  }
  if (state.h === 'right') {
    state.left = Math.max(0, vp.w - w - state.hOff - rightGap())
  } else if (state.h === 'left') {
    state.left = state.hOff
  } else {
    state.left = clamp(state.left, 0, Math.max(0, vp.w - w - rightGap()))
  }
  if (state.v === 'bottom') {
    state.top = Math.max(0, vp.h - h - state.vOff)
  } else if (state.v === 'top') {
    state.top = state.vOff
  } else {
    state.top = clamp(state.top, 0, Math.max(0, vp.h - h))
  }
  express()
}
function refresh(manual) {
  if (busy) return
  busy = true
  if (animDelayTimer) { clearTimeout(animDelayTimer); animDelayTimer = null }
  // 只有从未拿到过数据时才进入 loading 视觉态；
  // 已有数据的手动刷新静默进行（防"获取失败/加载中"闪现）
  if (manual || state.balance === null) {
    if (state.balance === null) { state.status = 'loading'; render() }
  }
  var ctrl = null
  var timer = null
  try {
    ctrl = new AbortController()
    timer = setTimeout(function () { try { ctrl.abort() } catch (err) {} }, FETCH_TIMEOUT_MS)
  } catch (err) {}
  // selectedAccountIdx = -1 表示 DeepSeek 余额模式
  if (selectedAccountIdx === -1) {
    fetchDeepSeekBalance(ctrl, manual)
  } else {
    fetchVolcUsage(ctrl, manual)
  }
}
function fetchDeepSeekBalance(ctrl, manual) {
  var timer = null
  try {
    timer = setTimeout(function () { try { if (ctrl) ctrl.abort() } catch (err) {} }, FETCH_TIMEOUT_MS)
  } catch (err) {}
  fetch('/dsh-whale/balance.json', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
    .then(function (r) { return r.json() })
    .then(function (data) {
      if (data && data.ok) {
        var nb = Number(data.totalBalance)
        state.balance = nb
        state.currency = 'CNY'
        state.activeName = 'DeepSeek'
        state.percents = { session: null, weekly: null, monthly: null }
        // 峰谷时段 + 平台今日消耗：服务端 balance.json 已计算，前端此前漏读
        state.isPeak = !!data.isPeak
        if (data.todayUsage !== undefined && data.todayUsage !== null && isFinite(Number(data.todayUsage))) {
          state.todayUsage = Number(data.todayUsage)
        }
        state.status = 'ok'
        state.message = ''
        var changed = state.balance !== null && (nb !== state.balance)
        if (changed) {
          if (!manual) {
            showBubble()
            state.status = 'changing'
            if (animDelayTimer) clearTimeout(animDelayTimer)
            animDelayTimer = setTimeout(function () {
              animDelayTimer = null
              animateAmount(shown, nb, 'CNY', ANIM_MS)
            }, 300)
            if (settleTimer) clearTimeout(settleTimer)
            settleTimer = setTimeout(function () {
              settleTimer = null
              if (state.status === 'changing') { state.status = 'ok'; render() }
            }, CHANGE_MS + 300)
          } else {
            animateAmount(shown, nb, 'CNY', ANIM_MS)
            state.status = 'ok'
            render()
          }
        } else {
          if (animId === null) shown = nb
          state.status = 'ok'
          render()
        }
      } else {
        state.status = 'error'
        state.message = (data && data.error) ? String(data.error) : '获取失败'
        render()
      }
    })
    .catch(function () {
      state.status = 'error'
      state.message = '获取失败'
      render()
    })
    .finally(function () {
      busy = false
      if (timer) clearTimeout(timer)
    })
}
function fetchVolcUsage(ctrl, manual) {
  var timer = null
  try {
    timer = setTimeout(function () { try { if (ctrl) ctrl.abort() } catch (err) {} }, FETCH_TIMEOUT_MS)
  } catch (err) {}
  fetch('/api/volc-usage', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
    .then(function (r) { return r.json() })
    .then(function (data) {
      if (data && data.ok && Array.isArray(data.accounts) && data.accounts.length > 0) {
        var acc = null
        if (selectedAccountIdx > 0) {
          // 手动选了某个账号
          for (var i = 0; i < data.accounts.length; i++) {
            if (data.accounts[i].idx === selectedAccountIdx && data.accounts[i].ok !== false) { acc = data.accounts[i]; break }
          }
        }
        if (!acc) {
          // 跟随激活账号
          for (var j = 0; j < data.accounts.length; j++) {
            if (data.accounts[j].idx === data.activeIdx && data.accounts[j].ok !== false) { acc = data.accounts[j]; break }
          }
        }
        if (!acc) {
          // 兜底：第一个可用的
          for (var k = 0; k < data.accounts.length; k++) {
            if (data.accounts[k].ok !== false) { acc = data.accounts[k]; break }
          }
        }
        if (acc) {
          function pctOf(a, lvl) {
            var rows = a && a.plan && a.plan.QuotaUsage ? a.plan.QuotaUsage : []
            for (var k = 0; k < rows.length; k++) {
              if (rows[k].Level === lvl) return Math.min(100, Math.max(0, Number(rows[k].Percent) || 0))
            }
            return null
          }
          state.percents = {
            session: pctOf(acc, 'session'),
            weekly: pctOf(acc, 'weekly'),
            monthly: pctOf(acc, 'monthly'),
          }
          state.activeName = acc.name || ''
          // 疲惫模式：会话配额 ≥90%
          var sessPct = state.percents.session
          if (sessPct !== null && sessPct !== undefined && sessPct >= 90) {
            exprSetExhausted(true)
          } else {
            exprSetExhausted(false)
          }
          var newPct = state.percents[MODES[state.modeIndex].key]
          var newBalance = (newPct === null) ? null : newPct
          var changed = state.balance !== null && newBalance !== null && (newBalance !== state.balance)
          state.balance = newBalance
          state.status = newBalance === null ? 'error' : 'ok'
          state.message = newBalance === null ? (MODES[state.modeIndex].label + '数据缺失') : ''
          if (changed) {
            if (!manual) {
              showBubble()
              state.status = 'changing'
              if (animDelayTimer) clearTimeout(animDelayTimer)
              animDelayTimer = setTimeout(function () {
                animDelayTimer = null
                animateAmount(shown, newBalance, '%', ANIM_MS)
              }, 300)
              if (settleTimer) clearTimeout(settleTimer)
              settleTimer = setTimeout(function () {
                settleTimer = null
                if (state.status === 'changing') { state.status = 'ok'; render() }
              }, CHANGE_MS + 300)
            } else {
              animateAmount(shown, newBalance, '%', ANIM_MS)
              state.status = 'ok'
              render()
            }
          } else {
            if (animId === null) shown = newBalance
            state.status = newBalance === null ? 'error' : 'ok'
            render()
          }
        } else {
          if (state.balance === null) { state.status = 'error'; state.message = '无可用账号'; render() }
        }
      } else {
        if (state.balance === null) {
          state.status = 'error'
          state.message = (data && data.error) ? String(data.error) : '火山用量接口无数据'
          render()
        }
      }
    })
    .catch(function () {
      // 瞬时失败（网络抖动/超时）：若已有数据则保留旧值不闪错误；仅无数据时才报错
      if (state.balance === null) {
        state.status = 'error'
        state.message = '获取失败'
        render()
      }
    })
    .finally(function () {
      busy = false
      if (timer) clearTimeout(timer)
    })
}
var soundOn = true
var soundVol = 0.9
var soundSet = 'duck'
var usageMode = 'ledger'
var peakMode = 'default'
var bubbleOn = true
var turnCostOn = true
var turnCostCloseMs = 5000
var lastCostSeq = 0
var costBubbleActive = false
var scrollGapOn = false
var scrollGapPx = 17
function saveConfig() {
  try {
    fetch(SIZE_URL, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scale: state.scale, sound: soundOn, vol: soundVol, soundSet: soundSet, usageMode: usageMode, peakMode: peakMode, bubbleOn: bubbleOn, turnCostOn: turnCostOn, turnCostCloseMs: turnCostCloseMs, scrollGapOn: scrollGapOn, scrollGapPx: scrollGapPx }) })
  } catch (err) {}
}
function setUsageMode(v) {
  usageMode = v === 'token' ? 'token' : 'ledger'
  usageSelect.value = usageMode
  saveConfig()
  refresh(false)
}
function setPeakMode(v) {
  peakMode = v === 'liangwen' || v === 'qiangqiang' ? v : 'default'
  peakSelect.value = peakMode
  saveConfig()
}
function setBubbleOn(v) {
  bubbleOn = !!v
  bubbleToggle.checked = bubbleOn
  saveConfig()
  if (!bubbleOn) hideBubble()
}
function setTurnCostOn(v) {
  turnCostOn = !!v
  turnCostToggle.checked = turnCostOn
  saveConfig()
  if (!turnCostOn) hideCostBubble()
}
function setTurnCostClose(v) {
  var n = Math.max(0, Math.round(Number(v) || 0))
  turnCostCloseMs = n * 1000
  turnCostCloseInput.value = String(n)
  saveConfig()
}
function setScrollGapOn(v) {
  scrollGapOn = !!v
  scrollGapToggle.checked = scrollGapOn
  scrollGapInput.disabled = !scrollGapOn
  saveConfig()
  settle()
}
function setScrollGapPx(v) {
  if (!scrollGapOn) return
  var n = Math.max(0, Math.round(Number(v) || 0))
  scrollGapPx = n
  scrollGapInput.value = String(n)
  saveConfig()
  settle()
}
function scaleToDisplay(s) {
  return Math.round((s - MIN_SCALE) / ((MAX_SCALE - MIN_SCALE) / 19)) + 1
}
function setScale(v) {
  var next = Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(v))) * 10) / 10
  var rect = root.getBoundingClientRect()
  // fixed point: the whale's corner — bottom-right when unflipped, bottom-left
  // when flipped. Growing extends the widget up-left / up-right from that
  // corner; shrinking pulls it back toward the corner. The whale always hugs
  // its corner while scaling.
  var fx = state.h === 'left' ? rect.left : rect.right
  var fy = rect.bottom
  state.scale = next
  root.style.setProperty('--dshw-scale', String(next))
  scaleInput.value = String(next)
  scaleNumber.value = String(scaleToDisplay(next))
  try { localStorage.setItem('dsh-whale-scale', String(next)) } catch (err) {}
  saveConfig()
  // keep the corner fixed while resizing; the position correction applies
  // instantly because the caller disables the transition for the whole drag
  var r2 = root.getBoundingClientRect()
  var vp = viewport()
  if (state.h === 'left') {
    state.left = Math.min(Math.max(fx, 0), Math.max(0, vp.w - r2.width))
  } else {
    state.left = Math.min(Math.max(fx - r2.width, 0), Math.max(0, vp.w - r2.width))
  }
  state.top = Math.min(Math.max(fy - r2.height, 0), Math.max(0, vp.h - r2.height))
  express()
}
function setVol(v) {
  var next = Math.round(Math.min(1, Math.max(0, Number(v))) * 100) / 100
  soundVol = next
  soundOn = next > 0
  volInput.value = String(next)
  volPct.textContent = Math.round(next * 100) + '%'
  try {
    if (pressAudio) pressAudio.volume = next
    if (releaseAudio) releaseAudio.volume = next
  } catch (err) {}
  saveConfig()
}
function setSoundSet(v) {
  soundSet = v === 'fx1' ? 'fx1' : 'duck'
  soundSelect.value = soundSet
  applySoundSet()
  saveConfig()
}
var SQUISH = 'scaleY(0.88) scaleX(1.05)'
var pressAudio = null
var releaseAudio = null
var pressing = false
var pressEnded = false
var releasePlayed = false
var releaseTimer = null
function applySoundSet() {
  try {
    pressAudio = new Audio('/dsh-whale/sound/press.mp3?set=' + soundSet)
    pressAudio.preload = 'auto'
    pressAudio.volume = soundVol
    releaseAudio = new Audio('/dsh-whale/sound/release.mp3?set=' + soundSet)
    releaseAudio.preload = 'auto'
    releaseAudio.volume = soundVol
  } catch (err) {}
}
function playPress() {
  if (!pressAudio || !soundOn) return
  try {
    if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null }
    if (releaseAudio) {
      releaseAudio.pause()
      releaseAudio.currentTime = 0
    }
    pressEnded = false
    releasePlayed = false
    pressAudio.onended = function () {
      pressEnded = true
      // fallback (duration unknown): click → Ya2 right after Ya1 ends
      if (!pressing && !releasePlayed) playRelease()
      // hold: still pressed → wait for pressUp()
    }
    pressAudio.currentTime = 0
    var p = pressAudio.play()
    if (p && typeof p.catch === 'function') p.catch(function () {})
  } catch (err) {}
}
function playRelease() {
  if (releasePlayed || !releaseAudio || !soundOn) return
  releasePlayed = true
  try {
    releaseAudio.currentTime = 0
    var p = releaseAudio.play()
    if (p && typeof p.catch === 'function') p.catch(function () {})
  } catch (err) {}
}
function pressDown() {
  body.style.transform = SQUISH
  pressing = true
  if (mood === 'normal' && !exhaustedMode) exprSetImg(EXPR_URL(exprVer === 'v1' ? 'stroking' : 'close_eyes'))
  playPress()
}
function pressUp() {
  body.style.transform = 'scaleY(1) scaleX(1)'
  pressing = false
  exprApplyIcon()
  if (pressEnded) {
    // hold (or released after Ya1 finished) → Ya2 now
    playRelease()
    return
  }
  // click: start Ya2 in the last 100ms of Ya1's playback
  var durKnown = false
  var remainMs = 0
  try {
    var dur = pressAudio ? pressAudio.duration : 0
    if (isFinite(dur) && dur > 0) {
      durKnown = true
      remainMs = (dur - pressAudio.currentTime) * 1000
    }
  } catch (err) {}
  if (durKnown) {
    releaseTimer = setTimeout(function () {
      releaseTimer = null
      playRelease()
    }, Math.max(0, remainMs - 100))
  }
  // duration unknown → pressAudio.onended fallback plays Ya2 after Ya1 ends
}
var menuOpen = false
function toggleMenu() {
  menuOpen = !menuOpen
  if (menuOpen) { positionMenu(); if (typeof lineSelectOptions === 'function') lineSelectOptions() }
  menuBox.classList.toggle('dshwv-menu-open', menuOpen)
  if (menuOpen) menuBtn.classList.add('dshwv-menu-btn-visible')
}
function closeMenu() {
  menuOpen = false
  menuBox.classList.remove('dshwv-menu-open')
  root.style.transition = ''
  snapCheck()
}
function snapCheck() {
  var rect = root.getBoundingClientRect()
  var vp = viewport()
  var w = rect.width, h = rect.height
  var left = rect.left, top = rect.top
  var centerX = left + w / 2
  var centerY = top + h / 2
  var moved = false
  if (centerX < vp.w / 4) {
    state.h = 'left'
    state.hOff = 0
    left = 0
    moved = true
  } else if (centerX > vp.w * 3 / 4) {
    state.h = 'right'
    state.hOff = 0
    left = vp.w - w - rightGap()
    moved = true
  } else {
    state.h = null
    state.hOff = left
  }
  if (centerY < vp.h / 4) {
    state.v = 'top'
    state.vOff = 0
    top = 0
    moved = true
  } else {
    state.v = 'bottom'
    state.vOff = Math.max(0, vp.h - top - h)
  }
  if (moved) {
    state.left = left
    state.top = top
    settle()
  }
}
function positionMenu() {
  try {
    var r = root.getBoundingClientRect()
    var b = menuBtn.getBoundingClientRect()
    var vp = viewport()
    var onLeft = r.left + r.width / 2 < vp.w / 2
    // the menu appears ABOVE the button, anchored to its side:
    // right side → menu bottom-right aligns with the button's top-right;
    // left side → menu bottom-left aligns with the button's top-left
    if (onLeft) {
      menuBox.style.left = b.left + 'px'
      menuBox.style.right = 'auto'
      menuBox.style.transformOrigin = 'bottom left'
    } else {
      menuBox.style.right = (vp.w - b.right) + 'px'
      menuBox.style.left = 'auto'
      menuBox.style.transformOrigin = 'bottom right'
    }
    menuBox.style.bottom = (vp.h - b.top) + 'px'
    menuBox.style.top = 'auto'
  } catch (err) {}
}

var hitCanvas = null
var hitReady = false
var hitRetryTimer = null
function setupHitTest() {
  try {
    hitCanvas = document.createElement('canvas')
    hitCanvas.width = 610
    hitCanvas.height = 610
    var probe = new Image()
    probe.onload = function () {
      try {
        hitCanvas.getContext('2d').drawImage(probe, 0, 0)
        hitReady = true
      } catch (err) { scheduleHitRetry() }
    }
    probe.onerror = function () { scheduleHitRetry() }
    probe.src = IMG_URL()
  } catch (err) { scheduleHitRetry() }
}
// 探测图加载失败（服务器还没起来/断网）时延迟重试，避免 hitReady 永久 false
function scheduleHitRetry() {
  if (hitRetryTimer) return
  hitRetryTimer = setTimeout(function () {
    hitRetryTimer = null
    hitCanvas = null
    hitReady = false
    setupHitTest()
  }, 2500)
}
function isWhaleHit(e) {
  try { window.__whaleDiag = { isWhaleHit: function (ev) { return isWhaleHit(ev) }, get hitReady() { return hitReady }, showBubble: function () { showBubble() }, get bubbleShown() { return bubbleShown }, get bubbleStage() { return bubbleStage } } } catch (e) {}

  // 命中判定未就绪/异常时宁可不响应（鲸鱼点不动），也不能返回 true 把整页点击吃掉
  if (!hitCanvas || !hitReady) return false
  try {
    var r = img.getBoundingClientRect()
    if (!r || r.width <= 0 || r.height <= 0) return false
    var lx = (e.clientX - r.left) / r.width * 610
    var ly = (e.clientY - r.top) / r.height * 610
    if (lx < 0 || ly < 0 || lx >= 610 || ly >= 610) return false
    if (state.h === 'left') lx = 610 - lx
    var data = hitCanvas.getContext('2d').getImageData(Math.floor(lx), Math.floor(ly), 1, 1).data
    return data[3] > 10
  } catch (err) {
    return false
  }
}
function onDocPointerDown(e) {
  if (e.target && e.target.closest) {
    if (e.target.closest('.dshwv-bubble') || e.target.closest('.dshwv-menu') || e.target.closest('.dshwv-menu-btn')) return
  }
  if (menuOpen) {
    closeMenu()
    return
  }
  if (e.button !== 0 && e.pointerType === 'mouse') return
  if (!isWhaleHit(e)) return
  try { e.preventDefault(); e.stopPropagation() } catch (err) {}
  var vp = viewport()
  var rect = root.getBoundingClientRect()
  drag = { active: true, startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top, w: rect.width, h: rect.height, moved: false, vp: vp }
  root.classList.add('dshwv-dragging')
  pressDown()
  setWidgetCursor('grabbing')
  document.addEventListener('pointermove', onDocPointerMove, true)
  document.addEventListener('pointerup', onDocPointerUp, true)
  document.addEventListener('pointercancel', onDocPointerCancel, true)
  document.addEventListener('click', onDocClickStopper, true)
}
function onDocPointerMove(e) {
  if (!drag || !drag.active) return
  var dx = e.clientX - drag.startX
  var dy = e.clientY - drag.startY
  if (dx * dx + dy * dy >= CLICK_SQ) drag.moved = true
  // Keep the pre-drag flip orientation while dragging (state.h/v stay as they
  // were); on release endDrag() recomputes the anchors and settle() flips the
  // class with a smooth transition instead of reverting instantly.
  state.left = clamp(drag.origLeft + dx, 0, Math.max(0, drag.vp.w - drag.w))
  state.top = clamp(drag.origTop + dy, 0, Math.max(0, drag.vp.h - drag.h))
  express()
}
function onDocPointerUp(e) { endDrag(e, true) }
function onDocPointerCancel(e) { endDrag(e, false) }
function onDocClickStopper(e) {
  try { e.preventDefault(); e.stopPropagation() } catch (err) {}
}
document.addEventListener('pointerdown', onDocPointerDown, true)

var widgetCursor = ''
function setWidgetCursor(v) {
  if (v !== widgetCursor) {
    widgetCursor = v
    try { document.body.style.cursor = v } catch (err) {}
  }
}
function onDocPointerMoveCursor(e) {
  if (drag && drag.active) { setWidgetCursor('grabbing'); return }
  var el = null
  try { el = document.elementFromPoint(e.clientX, e.clientY) } catch (err) {}
  if (el && el.closest && (el.closest('.dshwv-bubble') || el.closest('.dshwv-menu') || el.closest('.dshwv-menu-btn'))) {
    setWidgetCursor('')
    menuBtn.classList.add('dshwv-menu-btn-visible')
    return
  }
  var over = isWhaleHit(e)
  setWidgetCursor(over ? 'grab' : '')
  menuBtn.classList.toggle('dshwv-menu-btn-visible', over || menuOpen)
}
document.addEventListener('pointermove', onDocPointerMoveCursor, true)

function endDrag(e, clickAllowed) {
  if (!drag || !drag.active) return
  drag.active = false
  document.removeEventListener('pointermove', onDocPointerMove, true)
  document.removeEventListener('pointerup', onDocPointerUp, true)
  document.removeEventListener('pointercancel', onDocPointerCancel, true)
  document.removeEventListener('click', onDocClickStopper, true)
  pressUp()
  root.classList.remove('dshwv-dragging')
  setWidgetCursor(isWhaleHit(e) ? 'grab' : '')
  if (clickAllowed && !drag.moved) {
    exprRegisterClick()          // 连点 → 生气
    exprOnUserActivity()         // 失落恢复 + 重置空闲计时
    showBubble(); refresh(true); return
  }
  var dx = e.clientX - drag.startX
  var dy = e.clientY - drag.startY
  var left = clamp(drag.origLeft + dx, 0, Math.max(0, drag.vp.w - drag.w))
  var top = clamp(drag.origTop + dy, 0, Math.max(0, drag.vp.h - drag.h))
  var centerX = left + drag.w / 2
  var centerY = top + drag.h / 2
  if (centerX < drag.vp.w / 4) {
    state.h = 'left'
    state.hOff = 0
  } else if (centerX > drag.vp.w * 3 / 4) {
    state.h = 'right'
    state.hOff = 0
    left = drag.vp.w - drag.w - rightGap()
  } else {
    state.h = null
    state.hOff = left
  }
  if (centerY < drag.vp.h / 4) {
    state.v = 'top'
    state.vOff = 0
  } else if (centerY > drag.vp.h * 3 / 4) {
    state.v = 'bottom'
    state.vOff = 0
  } else {
    state.v = null
    state.vOff = top
  }
  state.left = left
  state.top = top
  settle()
}
window.addEventListener('resize', function () {
  settle()
})

// 防刷新闪现：首次测量前同步恢复 scale + 隐藏，配置链结束再显示
root.style.visibility = 'hidden'
try {
  var _ps = parseFloat(localStorage.getItem('dsh-whale-scale'))
  if (isFinite(_ps) && _ps >= MIN_SCALE - 0.1 && _ps <= MAX_SCALE + 0.1) {
    state.scale = _ps
    root.style.setProperty('--dshw-scale', String(_ps))
  }
} catch (err) {}
var rect0 = root.getBoundingClientRect()
state.left = rect0.left
state.top = rect0.top
express()
render()
applySoundSet()
setupHitTest()
fetch(SIZE_URL, { cache: 'no-store' })
  .then(function (r) { return r.json() })
  .then(function (d) {
    if (d && typeof d.scale === 'number' && d.scale >= MIN_SCALE - 0.1 && d.scale <= MAX_SCALE + 0.1) {
      state.scale = d.scale
      root.style.setProperty('--dshw-scale', String(d.scale))
      scaleInput.value = String(d.scale)
      scaleNumber.value = String(scaleToDisplay(d.scale))
      settle()
    }
    if (d && typeof d.vol === 'number') {
      soundVol = d.vol
      soundOn = soundVol > 0
      volInput.value = String(soundVol)
      volPct.textContent = Math.round(soundVol * 100) + '%'
      try {
        if (pressAudio) pressAudio.volume = soundVol
        if (releaseAudio) releaseAudio.volume = soundVol
      } catch (err) {}
    }
    if (d && typeof d.soundSet === 'string') {
      soundSet = d.soundSet === 'fx1' ? 'fx1' : 'duck'
      soundSelect.value = soundSet
      applySoundSet()
    }
    if (d && typeof d.usageMode === 'string') {
      usageMode = d.usageMode === 'token' ? 'token' : 'ledger'
      usageSelect.value = usageMode
    }
    if (d && typeof d.peakMode === 'string') {
      peakMode = d.peakMode === 'liangwen' || d.peakMode === 'qiangqiang' ? d.peakMode : 'default'
      peakSelect.value = peakMode
    }
    if (d && typeof d.bubbleOn === 'boolean') {
      bubbleOn = d.bubbleOn
      bubbleToggle.checked = bubbleOn
    }
    if (d && typeof d.turnCostOn === 'boolean') {
      turnCostOn = d.turnCostOn
      turnCostToggle.checked = turnCostOn
    }
    if (d && typeof d.turnCostCloseMs === 'number') {
      turnCostCloseMs = d.turnCostCloseMs > 0 ? d.turnCostCloseMs : 0
      turnCostCloseInput.value = String(Math.round(turnCostCloseMs / 1000))
    }
    if (d && typeof d.scrollGapOn === 'boolean') {
      scrollGapOn = d.scrollGapOn
      scrollGapToggle.checked = scrollGapOn
      scrollGapInput.disabled = !scrollGapOn
    }
    if (d && typeof d.scrollGapPx === 'number') {
      scrollGapPx = d.scrollGapPx > 0 ? Math.round(d.scrollGapPx) : 0
      scrollGapInput.value = String(scrollGapPx)
    }
    settle() // 恢复避让配置后立即重算位置，使避让立即生效
    refresh(false)
  })
  .catch(function () { refresh(false) }).finally(function () { root.style.visibility = '' })
setInterval(function () { refresh(false) }, REFRESH_MS)

// ===== 表情系统：悬停检测（document 级，静止悬停在鲸鱼上 8 秒 → 害羞）=====
document.addEventListener('pointermove', function (e) {
  exprOnUserActivity()
  if (typeof isWhaleHit === 'function' && isWhaleHit(e)) {
    exprRegisterHoverStart()
  } else {
    exprRegisterHoverEnd()
  }
}, { passive: true })
document.addEventListener('pointerdown', function () { exprOnUserActivity() }, { passive: true })
// 初始化：启动眨眼 + 空闲计时
exprScheduleBlink()
exprResetIdle()

// =====================================================================
// 问答对话面板（复用菜单的视觉语言：白底浮层 + 深蓝 #203170 + 圆角）
// 注意：本段整体位于 WIDGET_JS 模板字符串内，禁止使用反引号与美元花括号插值，
//       一律用字符串拼接与单引号。修改时务必保持这一约束，否则整个挂件脚本失效。
// =====================================================================
var CHAT_STREAM_URL = '/dsh-whale/chat/stream'
var CHAT_SESSIONS_URL = '/dsh-whale/chat/sessions.json'
var CHAT_MESSAGES_URL = '/dsh-whale/chat/messages.json'
var CHAT_MODELS = ['deepseek-flash', 'deepseek-v4-pro']
var CHAT_MODEL_LABEL = { 'deepseek-flash': 'V4-Flash', 'deepseek-v4-pro': 'V4-Pro' }
var CHAT_MODEL_KEY = 'dsh-whale-chat-model'
var CHAT_HIST_KEY = 'dsh-whale-chat-history'

var chatPanel = document.createElement('div')
chatPanel.className = 'dshwv-chat'

var chatHead = document.createElement('div')
chatHead.className = 'dshwv-chat-head'
var chatTitleEl = document.createElement('div')
chatTitleEl.className = 'dshwv-chat-title'
chatTitleEl.textContent = '大肥鱼 · 对话'
var chatToggleBtn = document.createElement('button')
chatToggleBtn.type = 'button'
chatToggleBtn.className = 'dshwv-chat-btn'
chatToggleBtn.textContent = '会话'
var chatNewBtn = document.createElement('button')
chatNewBtn.type = 'button'
chatNewBtn.className = 'dshwv-chat-btn'
chatNewBtn.textContent = '+ 新建'
var chatCloseBtn = document.createElement('button')
chatCloseBtn.type = 'button'
chatCloseBtn.className = 'dshwv-chat-btn dshwv-chat-close'
chatCloseBtn.textContent = '×'
chatHead.appendChild(chatTitleEl)
chatHead.appendChild(chatToggleBtn)
chatHead.appendChild(chatNewBtn)
chatHead.appendChild(chatCloseBtn)

var chatSessionsEl = document.createElement('div')
chatSessionsEl.className = 'dshwv-chat-sessions'
chatSessionsEl.style.display = 'none'

var chatMsgsEl = document.createElement('div')
chatMsgsEl.className = 'dshwv-chat-msgs'

var chatFoot = document.createElement('div')
chatFoot.className = 'dshwv-chat-foot'
var chatModelSel = document.createElement('select')
chatModelSel.className = 'dshwv-chat-model'
for (var cmi = 0; cmi < CHAT_MODELS.length; cmi++) {
  var cmOpt = document.createElement('option')
  cmOpt.value = CHAT_MODELS[cmi]
  cmOpt.textContent = CHAT_MODEL_LABEL[CHAT_MODELS[cmi]] || CHAT_MODELS[cmi]
  chatModelSel.appendChild(cmOpt)
}
var chatHistWrap = document.createElement('label')
chatHistWrap.className = 'dshwv-chat-hist'
chatHistWrap.title = '关闭后每次提问都不带之前的上下文，更省 token'
var chatHistChk = document.createElement('input')
chatHistChk.type = 'checkbox'
chatHistChk.className = 'dshwv-check'
chatHistChk.checked = true
chatHistWrap.appendChild(chatHistChk)
chatHistWrap.appendChild(document.createTextNode('记忆'))
var chatInput = document.createElement('textarea')
chatInput.className = 'dshwv-chat-in'
chatInput.placeholder = '问点什么…（Enter 发送，Shift+Enter 换行）'
chatInput.rows = 1
var chatSendBtn = document.createElement('button')
chatSendBtn.type = 'button'
chatSendBtn.className = 'dshwv-chat-send'
chatSendBtn.textContent = '发送'
chatFoot.appendChild(chatModelSel)
chatFoot.appendChild(chatHistWrap)
chatFoot.appendChild(chatInput)
chatFoot.appendChild(chatSendBtn)
chatPanel.appendChild(chatHead)
chatPanel.appendChild(chatSessionsEl)
chatPanel.appendChild(chatMsgsEl)
chatPanel.appendChild(chatFoot)
document.body.appendChild(chatPanel)

var chatSessions = []
var chatActiveId = null
var chatBusy = false
var chatHistoryOn = true

// —— 偏好读取 ——
try {
  var savedModel = localStorage.getItem(CHAT_MODEL_KEY)
  if (savedModel && CHAT_MODELS.indexOf(savedModel) !== -1) chatModelSel.value = savedModel
  var savedHist = localStorage.getItem(CHAT_HIST_KEY)
  if (savedHist === '0') { chatHistoryOn = false; chatHistChk.checked = false }
} catch (err) {}
chatModelSel.addEventListener('change', function () {
  try { localStorage.setItem(CHAT_MODEL_KEY, chatModelSel.value) } catch (err) {}
})
chatHistChk.addEventListener('change', function () {
  chatHistoryOn = !!chatHistChk.checked
  try { localStorage.setItem(CHAT_HIST_KEY, chatHistoryOn ? '1' : '0') } catch (err) {}
})

function chatScrollBottom() {
  setTimeout(function () { try { chatMsgsEl.scrollTop = chatMsgsEl.scrollHeight } catch (err) {} }, 20)
}
function chatShowEmpty() {
  chatMsgsEl.textContent = ''
  var e = document.createElement('div')
  e.className = 'dshwv-chat-empty'
  e.textContent = '和大肥鱼聊聊吧。对话走插件自带的 DeepSeek API Key，'
  e.appendChild(document.createElement('br'))
  e.appendChild(document.createTextNode('这部分消耗不计入挂件的「本轮消耗」统计。'))
  chatMsgsEl.appendChild(e)
}
// —— 轻量 Markdown 渲染（仅用于助手回答）——
// 安全：模型输出属于外部内容，绝不能不转义就 innerHTML。
// 因此顺序是「先转义 HTML 实体，再套用 Markdown 语法」，转义后的 &lt; 等
// 不会被后续规则还原成标签，链接也只允许 http/https 前缀。
function chatRenderMd(text) {
  var s = String(text == null ? '' : text)
  if (!s.trim()) return ''
  // 1) 转义 HTML（这一步是 XSS 防线，必须在任何替换之前）
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // 2) 代码块（三连反引号围栏，转义后内容原样保留）
  //    反引号不能用字面量写：本函数在 WIDGET_JS 模板字符串内，字面反引号会
  //    提前终止模板串。用 fromCharCode(96) 构造，正则用 RegExp 动态生成。
  var BT = String.fromCharCode(96)
  var FENCE = BT + BT + BT
  var reFence = new RegExp(FENCE + '([\w+-]*)\r?\n?([\s\S]*?)' + FENCE, 'g')
  s = s.replace(reFence, function (m, lang, code) {
    return '<pre><code>' + code.replace(/\n$/, '') + '</code></pre>'
  })
  // 3) 行内代码
  var reInline = new RegExp(BT + '([^' + BT + '\n]+)' + BT, 'g')
  s = s.replace(reInline, '<code>$1</code>')
  // 4) 粗体 / 斜体
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
  // 5) 链接（先解析成占位 token，避免 6) 的自动链接重复处理）
  var links = []
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, function (m, label, url) {
    links.push('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>')
    return '\u0000L' + (links.length - 1) + '\u0000'
  })
  // 6) 裸链接自动转可点
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, function (m, pre, url) {
    links.push('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>')
    return pre + '\u0000L' + (links.length - 1) + '\u0000'
  })
  // 7) 按行组装块级元素
  var lines = s.split('\n')
  var out = ''
  var inUl = false
  var inOl = false
  var inPre = false
  function closeLists() {
    if (inUl) { out += '</ul>'; inUl = false }
    if (inOl) { out += '</ol>'; inOl = false }
  }
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    if (inPre) {
      out += line
      if (line.indexOf('</code></pre>') !== -1) inPre = false
      continue
    }
    if (line.indexOf('<pre><code>') !== -1) {
      closeLists()
      out += line
      if (line.indexOf('</code></pre>') === -1) inPre = true
      continue
    }
    var um = /^\s*[-*]\s+(.*)$/.exec(line)
    var om = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (um) {
      if (!inUl) { closeLists(); out += '<ul>'; inUl = true }
      out += '<li>' + um[1] + '</li>'
      continue
    }
    if (om) {
      if (!inOl) { closeLists(); out += '<ol>'; inOl = true }
      out += '<li>' + om[1] + '</li>'
      continue
    }
    closeLists()
    var hm = /^(#{1,3})\s+(.*)$/.exec(line)
    if (hm) {
      var lvl = hm[1].length
      out += '<h' + lvl + '>' + hm[2] + '</h' + lvl + '>'
      continue
    }
    if (/^\s*&gt;\s?/.test(line)) {
      out += '<blockquote>' + line.replace(/^\s*&gt;\s?/, '') + '</blockquote>'
      continue
    }
    if (!line.trim()) continue
    out += '<p>' + line + '</p>'
  }
  closeLists()
  // 8) 还原链接 token
  out = out.replace(/\u0000L(\d+)\u0000/g, function (m, idx) { return links[Number(idx)] || '' })
  return out
}

function chatAddMsg(role, text) {
  var d = document.createElement('div')
  d.className = 'dshwv-chat-m ' + (role === 'user' ? 'dshwv-chat-mu' : (role === 'error' ? 'dshwv-chat-me' : 'dshwv-chat-ma'))
  if (role === 'assistant') {
    d.className += ' dshwv-md'
    d.innerHTML = chatRenderMd(text)
  } else {
    // 用户消息与错误提示保持纯文本，避免用户输入的方括号等被当成语法
    d.textContent = text
  }
  chatMsgsEl.appendChild(d)
  chatScrollBottom()
  return d
}
function chatSetTitle(t) { chatTitleEl.textContent = t || '大肥鱼 · 对话' }
function chatUpdateTitle(t) {
  if (chatActiveId) {
    var r = chatFindRow(chatActiveId)
    if (r && r.title === '新对话') { r.title = t; chatRenderSessions() }
  }
  chatSetTitle(t)
}
function chatFindRow(id) {
  for (var i = 0; i < chatSessions.length; i++) if (chatSessions[i].id === id) return chatSessions[i]
  return null
}
function chatRenderSessions() {
  chatSessionsEl.textContent = ''
  if (!chatSessions.length) {
    var em = document.createElement('div')
    em.className = 'dshwv-chat-empty'
    em.textContent = '还没有对话'
    chatSessionsEl.appendChild(em)
    return
  }
  for (var i = 0; i < chatSessions.length; i++) {
    ;(function (row) {
      var d = document.createElement('div')
      d.className = 'dshwv-chat-srow' + (row.id === chatActiveId ? ' dshwv-chat-srow-on' : '')
      var t = document.createElement('span')
      t.className = 'dshwv-chat-stitle'
      t.textContent = row.title || '新对话'
      var del = document.createElement('button')
      del.type = 'button'
      del.className = 'dshwv-chat-sdel'
      del.textContent = '×'
      del.title = '删除这个会话'
      del.addEventListener('click', function (e) {
        e.stopPropagation()
        chatDeleteSession(row.id)
      })
      d.appendChild(t)
      d.appendChild(del)
      d.addEventListener('click', function () { chatSelectSession(row.id) })
      chatSessionsEl.appendChild(d)
    })(chatSessions[i])
  }
}
function chatApplySessions(list, activeId) {
  chatSessions = Array.isArray(list) ? list : []
  if (activeId) chatActiveId = activeId
  chatRenderSessions()
}
function chatSelectSession(id) {
  if (!id || id === chatActiveId) { chatSessionsEl.style.display = 'none'; return }
  chatActiveId = id
  try {
    fetch(CHAT_SESSIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeId: id }),
    }).catch(function () {})
  } catch (err) {}
  chatRenderSessions()
  chatLoadMessages(id)
}
function chatDeleteSession(id) {
  try {
    fetch(CHAT_MESSAGES_URL + '?id=' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function (r) { return r.json() })
      .then(function (d) {
        chatSessions = chatSessions.filter(function (s) { return s.id !== id })
        if (d && d.activeId) chatActiveId = d.activeId
        if (chatActiveId === id) {
          chatActiveId = null
          chatShowEmpty()
          chatSetTitle('')
        }
        chatRenderSessions()
        if (!chatSessions.length) chatCreateSession()
      }).catch(function () {})
  } catch (err) {}
}
var chatSeq = 0
function chatCreateSession() {
  var had = chatSessions.length
  // 前端生成的 id 直接交给服务端使用：这样「新建后立刻发消息」不会出现
  // 前端临时 id 与服务端真实 id 不一致而产生多余会话。
  chatSeq++
  var id = 'whale-' + Date.now().toString(36) + '-' + (chatSeq % 1000).toString(36) +
    Math.random().toString(36).slice(2, 6)
  chatActiveId = id
  chatSessions.unshift({ id: id, title: '新对话', updatedAt: Date.now() })
  chatRenderSessions()
  chatShowEmpty()
  chatSetTitle('')
  if (!had) chatSessionsEl.style.display = 'block'
  try {
    fetch(CHAT_SESSIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id }),
    }).then(function (r) { return r.json() }).then(function (d) {
      if (d && d.ok && d.activeId) chatActiveId = d.activeId
    }).catch(function () {})
  } catch (err) {}
}
function chatLoadMessages(id) {
  try {
    fetch(CHAT_MESSAGES_URL + '?id=' + encodeURIComponent(id), { cache: 'no-store' })
      .then(function (r) { return r.json() })
      .then(function (d) {
        if (!d || !d.ok) { chatShowEmpty(); return }
        var sess = d.session
        chatMsgsEl.textContent = ''
        if (!sess || !sess.messages || !sess.messages.length) { chatShowEmpty(); chatSetTitle(''); return }
        for (var i = 0; i < sess.messages.length; i++) {
          var m = sess.messages[i]
          if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue
          chatAddMsg(m.role, m.content)
        }
        chatSetTitle(sess.title || '')
        chatScrollBottom()
      }).catch(function () { chatShowEmpty() })
  } catch (err) { chatShowEmpty() }
}
function chatBoot() {
  if (chatBooted) return
  chatBooted = true
  try {
    fetch(CHAT_SESSIONS_URL, { cache: 'no-store' })
      .then(function (r) { return r.json() })
      .then(function (d) {
        if (!d || !d.ok) { chatCreateSession(); return }
        chatApplySessions(d.sessions, d.activeId)
        if (!chatSessions.length) { chatCreateSession(); return }
        var target = chatActiveId || chatSessions[0].id
        chatActiveId = target
        chatRenderSessions()
        chatLoadMessages(target)
      }).catch(function () { chatCreateSession() })
  } catch (err) { chatCreateSession() }
}
var chatBooted = false

// —— 流式发送 ——
function chatSend() {
  if (chatBusy) return
  var text = String(chatInput.value || '').trim()
  if (!text) return
  if (!chatActiveId) chatCreateSession()
  if (!chatActiveId) return

  chatInput.value = ''
  chatBusy = true
  chatSendBtn.disabled = true
  chatSendBtn.textContent = '…'
  // 先清掉「暂无消息」占位
  var maybeEmpty = chatMsgsEl.querySelector('.dshwv-chat-empty')
  if (maybeEmpty) chatMsgsEl.textContent = ''
  chatAddMsg('user', text)
  if (chatSessions.length && chatSessions[0].title === '新对话') {
    var short = text.length > 12 ? text.slice(0, 12) + '…' : text
    chatUpdateTitle(short)
  }
  var bubble = chatAddMsg('assistant', '')
  if (typeof exprSetImg === 'function') exprSetImg(EXPR_URL('thinking'))

  var acc = ''
  var failed = false
  // 统一错误展示：错误提示固定纯文本（不能被 Markdown 渲染影响）
  function chatFail(msg) {
    failed = true
    bubble.className = 'dshwv-chat-m dshwv-chat-me'
    bubble.textContent = '× ' + msg
  }
  function finish() {
    chatBusy = false
    chatSendBtn.disabled = false
    chatSendBtn.textContent = '发送'
    if (typeof exprApplyIcon === 'function') exprApplyIcon()
    // 收尾用累积到的完整文本重渲染一次：流式途中的代码块可能还是未闭合状态
    if (!failed && acc && bubble.className.indexOf('dshwv-chat-me') === -1) {
      bubble.classList.add('dshwv-md')
      bubble.innerHTML = chatRenderMd(acc)
    }
    chatScrollBottom()
  }

  try {
    fetch(CHAT_STREAM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: chatActiveId,
        message: text,
        model: chatModelSel.value,
        useHistory: chatHistoryOn,
      }),
    }).then(function (res) {
      if (!res.body || !res.body.getReader) {
        return res.text().then(function (t) {
          var msg = '流式响应不可用'
          try { var j = JSON.parse(t); if (j && j.error) msg = j.error } catch (err) {}
          chatFail(msg)
          finish()
        })
      }
      var reader = res.body.getReader()
      var dec = new TextDecoder()
      var buf = ''
      function pump() {
        return reader.read().then(function (step) {
          if (step.done) {
            if (!acc && !failed) chatFail('没有收到内容')
            finish()
            return
          }
          buf += dec.decode(step.value, { stream: true })
          var nl = buf.indexOf('\n')
          while (nl !== -1) {
            var line = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            if (line) {
              try {
                var o = JSON.parse(line)
                if (o && o.t === 'd' && typeof o.c === 'string') {
                  acc += o.c
                  // 流式过程中也用 Markdown 渲染，代码块/列表边到边成形。
                  // 未闭合的代码围栏在中间态会先按行内代码处理，收尾时再整体重渲染一次。
                  bubble.innerHTML = chatRenderMd(acc)
                  chatScrollBottom()
                } else if (o && o.t === 'err') {
                  chatFail(o.error || '请求失败')
                }
              } catch (err) {}
            }
            nl = buf.indexOf('\n')
          }
          return pump()
        })
      }
      return pump()
    }).catch(function (err) {
      chatFail('网络错误：' + String((err && err.message) || err).slice(0, 120))
      finish()
    })
  } catch (err) {
    chatFail(String((err && err.message) || err).slice(0, 120))
    finish()
  }
}

// —— 打开 / 关闭 ——
function chatOpen() {
  chatPanel.classList.add('dshwv-chat-open')
  chatBoot()
  setTimeout(function () { try { chatInput.focus() } catch (err) {} }, 60)
}
function chatClose() {
  chatPanel.classList.remove('dshwv-chat-open')
}
chatCloseBtn.addEventListener('click', function (e) { e.stopPropagation(); chatClose() })
chatNewBtn.addEventListener('click', function (e) { e.stopPropagation(); chatCreateSession() })
chatToggleBtn.addEventListener('click', function (e) {
  e.stopPropagation()
  var open = chatSessionsEl.style.display !== 'none'
  chatSessionsEl.style.display = open ? 'none' : 'block'
  if (!open) chatRenderSessions()
})
chatSendBtn.addEventListener('click', function (e) { e.stopPropagation(); chatSend() })
chatInput.addEventListener('keydown', function (e) {
  e.stopPropagation()
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatSend() }
})
chatPanel.addEventListener('pointerdown', function (e) { e.stopPropagation() })
chatInput.addEventListener('input', function () {
  try {
    chatInput.style.height = 'auto'
    chatInput.style.height = Math.min(110, chatInput.scrollHeight) + 'px'
  } catch (err) {}
})

// 菜单入口：另起一行，避免改动菜单里已有的行号变量
var chatRow = menuRow()
var chatOpenBtn = document.createElement('button')
chatOpenBtn.type = 'button'
chatOpenBtn.className = 'dshwv-sound'
chatOpenBtn.textContent = '打开对话框'
chatOpenBtn.addEventListener('click', function (e) {
  e.stopPropagation()
  closeMenu()
  chatOpen()
})
chatRow.appendChild(menuLabel('问答'))
chatRow.appendChild(chatOpenBtn)
menuBox.appendChild(chatRow)

// —— 每轮对话消耗检测：轮询 last-turn.json，出现新 seq 时弹消耗金额泡泡 ——
var LAST_TURN_URL = '/dsh-whale/last-turn.json'
var lastCostSeq = 0
var lastCostAligned = false
var todayCost = 0
function loadTodayCost() {
  try {
    var raw = localStorage.getItem('dsh-whale-today-cost')
    if (!raw) return
    var obj = JSON.parse(raw)
    var today = (function(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})(new Date())
    if (obj.date === today && typeof obj.amount === 'number') {
      todayCost = obj.amount
    }
  } catch (err) {}
}
function saveTodayCost() {
  try {
    localStorage.setItem('dsh-whale-today-cost', JSON.stringify({
      date: (function(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})(new Date()),
      amount: todayCost,
    }))
  } catch (err) {}
}
loadTodayCost()
function pollLastTurn() {
  try {
    fetch(LAST_TURN_URL, { cache: 'no-store' })
      .then(function (r) { return r.json() })
      .then(function (d) {
        if (!d || !d.ok || typeof d.seq !== 'number') return
        if (!lastCostAligned) {
          // 首次拿到数据：只对齐 seq，不弹旧轮次
          lastCostSeq = d.seq
          lastCostAligned = true
          return
        }
        if (d.seq > lastCostSeq) {
          lastCostSeq = d.seq
          if (d.turn !== null && d.amount !== null) {
            showCostBubble(Number(d.amount))
            // 累加今日消耗
            var newAmount = Number(d.amount)
            if (isFinite(newAmount) && newAmount > 0) {
              todayCost += newAmount
              saveTodayCost()
              render()
            }
          }
        }
      })
      .catch(function () {})
  } catch (err) {}
}
setInterval(pollLastTurn, 1000)
// 桌宠定制：仅用于离线自测的探针（不参与渲染逻辑）
try {
  window.__whaleProbe = {
    applyBubbleExpr: applyBubbleExpr,
    releaseBubbleExpr: releaseBubbleExpr,
    applyLineExpr: applyLineExpr,
    applyPeakExpr: applyPeakExpr,
    exprDoBlink: exprDoBlink,
    exprApplyIcon: exprApplyIcon,
    pickLineOnly: pickLineOnly,
    showBubble: showBubble,
    hideBubble: hideBubble,
    bubbleBox: bubbleBox,
    get manualExpr() { return manualExpr },
    get locked() { return _bubbleExprName },
    get curImg() { return __curImgSrc },
    get stage() { return bubbleStage },
    get shown() { return bubbleShown },
    get ver() { return exprVer },
    setVer: function (v) { exprVer = v },
    get blinkTimer() { return !!blinkTimer },
    get cuteTimer() { return !!cuteTimer },
  }
} catch (e) {}
})()