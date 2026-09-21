/**
 * bridge — 在页面上下文里把旧挂件的网络请求接到 Electron 主进程。
 *
 * 挂件原本通过 HTTP 向 DSH 要数据（/dsh-whale/*）。桌宠里没有 DSH，
 * 于是这里覆盖 window.fetch：凡是 /dsh-whale/ 开头的请求，一律转成 IPC
 * 交给主进程处理。挂件自身的代码因此几乎不需要改动。
 *
 * 必须在挂件脚本之前加载。
 */
(function () {
  var IPC = window.__whaleIPC__
  if (!IPC) {
    // preload 失败时给出明确提示，避免出现「挂件静默消失」
    document.addEventListener('DOMContentLoaded', function () {
      var b = document.createElement('div')
      b.style.cssText = 'position:fixed;left:8px;bottom:8px;background:#c62828;color:#fff;font:12px monospace;padding:8px;border-radius:6px;z-index:99999'
      b.textContent = 'preload 未加载：__whaleIPC__ 缺失'
      document.body.appendChild(b)
    })
    return
  }

  function jsonResponse(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  var realFetch = window.fetch ? window.fetch.bind(window) : null
  var exprVer = 'v2'
  try { exprVer = localStorage.getItem('dsh-whale-expr-ver') || 'v2' } catch (e) {}

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || ''
    if (url.indexOf('/dsh-whale/') === -1) {
      return realFetch ? realFetch(input, init) : Promise.reject(new Error('no fetch'))
    }

    // 解析出路径与查询参数
    var pathname = url
    var query = ''
    var qi = url.indexOf('?')
    if (qi !== -1) { query = url.slice(qi + 1); pathname = url.slice(0, qi) }
    var params = {}
    try {
      new URLSearchParams(query).forEach(function (v, k) { params[k] = v })
    } catch (e) {}

    var ver = params.ver || exprVer

    // 流式问答：单独走 IPC 增量推送
    if (pathname === '/dsh-whale/chat/stream') {
      var body = {}
      try { body = JSON.parse((init && init.body) || '{}') } catch (e) {}
      // 每条流一个唯一 id，主进程会带在增量上，preload 据此过滤，避免串台
      var streamId = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      var encoder = new TextEncoder()
      var controller = null
      var stream = new ReadableStream({
        start: function (c) { controller = c },
      })
      IPC.chatStream(body, function (chunk) {
        try { controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n')) } catch (e) {}
      }, streamId).then(function () {
        try { controller.close() } catch (e) {}
      }).catch(function (err) {
        try {
          controller.enqueue(encoder.encode(JSON.stringify({ t: 'err', error: String(err && err.message || err) }) + '\n'))
          controller.close()
        } catch (e) {}
      })
      return Promise.resolve(new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
      }))
    }

    // 静态资源：主进程读文件，这里转成 blob URL
    var isAsset = pathname === '/dsh-whale/image.png' ||
      pathname === '/dsh-whale/rua.gif' ||
      pathname === '/dsh-whale/expr' ||
      pathname.indexOf('/dsh-whale/sound/') === 0
    if (isAsset) {
      return IPC.asset(url).then(function (r) {
        if (!r || r.status !== 200 || !r.body) return new Response('', { status: 404 })
        var blob = new Blob([r.body], { type: r.mime || 'application/octet-stream' })
        return new Response(blob, { status: 200, headers: { 'Content-Type': r.mime || 'application/octet-stream' } })
      })
    }

    // 其余是数据接口
    return IPC.api(pathname, params).then(function (data) {
      return jsonResponse(data)
    }).catch(function (err) {
      return jsonResponse({ ok: false, error: String(err && err.message || err) }, 500)
    })
  }

  // 会话新建/删除走各自的 IPC（挂件用 POST/DELETE 表达）
  var realFetch2 = window.fetch
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || ''
    var method = ((init && init.method) || 'GET').toUpperCase()
    if (url.indexOf('/dsh-whale/chat/sessions.json') !== -1 && method === 'POST') {
      var b = {}
      try { b = JSON.parse((init && init.body) || '{}') } catch (e) {}
      if (b.id) {
        return IPC.createSession(b.id).then(function (r) { return jsonResponse(r) })
      }
      return IPC.api('/dsh-whale/chat/sessions.json', b).then(function (r) { return jsonResponse(r) })
    }
    if (url.indexOf('/dsh-whale/chat/messages.json') !== -1 && method === 'DELETE') {
      var id = ''
      try { id = new URLSearchParams(url.split('?')[1] || '').get('id') || '' } catch (e) {}
      return IPC.deleteSession(id).then(function (r) { return jsonResponse(r) })
    }
    if (url.indexOf('/dsh-whale/chat/messages.json') !== -1 && method === 'POST') {
      var id2 = ''
      try { id2 = new URLSearchParams(url.split('?')[1] || '').get('id') || '' } catch (e) {}
      return IPC.deleteSession(id2).then(function (r) { return jsonResponse(r) })
    }
    return realFetch2(input, init)
  }

  // ---------------------------------------------------------------------
  // 元素 src 拦截
  //
  // 挂件里的图片/音效是用 `img.src = '/dsh-whale/xxx'` 直接赋值的，
  // 这不经过 window.fetch，因此上面的 fetch 补丁覆盖不到。在 file:// 下
  // 浏览器会把 '/dsh-whale/...' 解析成 file:///C:/dsh-whale/... 而加载失败。
  //
  // 这里拦截 src 的 setter：凡是 /dsh-whale/ 开头的地址，改从主进程取数据
  // 并转成 blob URL。用 WeakMap 保留原地址，并缓存 blob 防止被 GC 回收。
  // ---------------------------------------------------------------------
  var ASSET_CACHE = {}

  function rewriteElementSrc(ctor, attr) {
    if (!ctor || !ctor.prototype) return
    var proto = ctor.prototype
    var desc = Object.getOwnPropertyDescriptor(proto, attr)
    if (!desc || !desc.set) return
    var origSet = desc.set
    var origGet = desc.get
    var pending = new WeakMap()
    try {
      var newSet = function (v) {
        var url = String(v == null ? '' : v)
        if (url.indexOf('/dsh-whale/') !== 0) {
          if (origGet) pending.set(this, url)
          origSet.call(this, v)
          return
        }
        var self = this
        // 先记原地址（外部读取 src 时看到的是逻辑地址）
        pending.set(self, url)
        var cached = ASSET_CACHE[url]
        if (cached) { origSet.call(self, cached); return }
        IPC.asset(url).then(function (r) {
          if (!r || r.status !== 200 || !r.body) return
          var blob = new Blob([r.body], { type: r.mime || 'application/octet-stream' })
          var bUrl = URL.createObjectURL(blob)
          ASSET_CACHE[url] = bUrl
          // 只有当元素仍期望这个地址时才写入，避免切换表情时的竞态
          if (pending.get(self) === url) origSet.call(self, bUrl)
        }).catch(function () {})
      }
      newSet.__whalePatched = true
      Object.defineProperty(proto, attr, {
        configurable: true,
        enumerable: desc.enumerable,
        get: function () {
          return pending.has(this) ? pending.get(this) : (origGet ? origGet.call(this) : '')
        },
        set: newSet,
      })
    } catch (e) {}
  }

  rewriteElementSrc(window.HTMLImageElement, 'src')
  // 音频：src setter 的拦截对 `new Audio(src)` 无效。
  // 浏览器构造函数走的是内部槽位，不会经过 HTMLMediaElement.prototype.src 的
  // setter（实测 mediaPatched=true 但 audio.src 仍是 file:///...），
  // 所以必须在构造层面就把 /dsh-whale/ 地址换成 blob。
  try {
    var NativeAudio = window.Audio
    window.Audio = function (src) {
      var el = new NativeAudio()
      if (src != null) {
        var u = String(src)
        if (u.indexOf('/dsh-whale/') === 0) {
          var cached = ASSET_CACHE[u]
          if (cached) {
            el.src = cached
          } else {
            IPC.asset(u).then(function (r) {
              if (!r || r.status !== 200 || !r.body) return
              var blob = new Blob([r.body], { type: r.mime || 'audio/mpeg' })
              var bUrl = URL.createObjectURL(blob)
              ASSET_CACHE[u] = bUrl
              try { el.src = bUrl } catch (e) {}
            }).catch(function () {})
          }
        } else {
          el.src = u
        }
      }
      return el
    }
    window.Audio.prototype = NativeAudio.prototype
    window.Audio.__whaleAudioPatched = true
  } catch (e) {}
  // 记录拦截是否真的挂上：这一步以前是静默失败的，只有把结果暴露出来
  // 才能区分「没拦截到」和「拦截了但后续出问题」。
  try {
    var dImg = window.HTMLImageElement && Object.getOwnPropertyDescriptor(window.HTMLImageElement.prototype, 'src')
    var dMed = window.HTMLMediaElement && Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'src')
    window.__srcPatch = {
      imgHasSrc: !!(dImg && dImg.set), imgPatched: !!(dImg && dImg.set && dImg.set.__whalePatched),
      mediaHasSrc: !!(dMed && dMed.set), mediaPatched: !!(dMed && dMed.set && dMed.set.__whalePatched),
      audioCtorPatched: window.Audio && window.Audio.__whaleAudioPatched === true,
    }
  } catch (e) { window.__srcPatch = { err: String(e && e.message) } }

  // 桌宠只有 DeepSeek 余额，默认必须走余额模式（selectedAccountIdx = -1），
  // 否则气泡会显示「火山方舟用量--获取失败」。
  //
  // 为什么不在主进程 size.json 里配：挂件对该字段做了归一化
  //   usageMode = d.usageMode === 'token' ? 'token' : 'ledger'
  // 拿到什么值都会变成 'ledger'，而 select 的合法值是 '0'/'1'/'2'/'-1'，配不进去。
  //
  // 所以改为：等挂件初始化完成后，以用户身份选中「DeepSeek 余额」这一项，
  // 触发它自己的 change 处理器（设置 selectedAccountIdx 并 refresh）。
  // 只做一次，之后用户在菜单里的选择会被尊重。
  var accountFixed = false
  function fixAccountOnce() {
    if (accountFixed) return true
    var sel = null
    var selects = document.querySelectorAll('select.dshwv-sound')
    for (var i = 0; i < selects.length; i++) {
      for (var k = 0; k < selects[i].options.length; k++) {
        if (selects[i].options[k].value === '-1') { sel = selects[i]; break }
      }
      if (sel) break
    }
    if (!sel) return false
    accountFixed = true
    try {
      sel.value = '-1'
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    } catch (e) {}
    // 标题是初始化时写入的静态文本（labelEl.textContent = getLabelText()），
    // 切换账号后不会自己更新，这里一并纠正。
    fixLabelText()
    var labelTimer = setInterval(fixLabelText, 500)
    setTimeout(function () { try { clearInterval(labelTimer) } catch (e) {} }, 6000)
    return true
  }
  function fixLabelText() {
    try {
      var lbl = document.querySelector('.dshwv-label')
      if (lbl && lbl.textContent !== 'DeepSeek 余额') lbl.textContent = 'DeepSeek 余额'
    } catch (e) {}
  }
  var fixTimer = setInterval(function () {
    if (fixAccountOnce()) clearInterval(fixTimer)
  }, 250)
  // 5 秒后放弃，避免一直轮询
  setTimeout(function () { try { clearInterval(fixTimer) } catch (e) {} }, 5000)

  // 配置注入：让挂件读到桌宠的偏好
  IPC.getConfig().then(function (cfg) {
    if (!cfg) return
    try {
      if (cfg.exprVer) localStorage.setItem('dsh-whale-expr-ver', cfg.exprVer)
      if (typeof cfg.scale === 'number') localStorage.setItem('dsh-whale-scale', String(cfg.scale))
      if (cfg.model) localStorage.setItem('dsh-whale-chat-model', cfg.model)
    } catch (e) {}
    window.__whaleConfig = cfg
  }).catch(function () {})

  // 窗口拖拽（app-region 手柄）已取消。
  // 窗口现在是整屏大小，挂件自身的拖动逻辑（state.left/top，clamp 到窗口）
  // 就能把它放到屏幕任意位置 —— 这正是"全屏随便拖"的实现方式。
  // 小窗口方案下的手柄在全屏后毫无用处，只会白占一块点击区域。

  // ---------------------------------------------------------------------
  // 菜单会超出窗口：设置菜单约 560px 高且 position:fixed 锚在挂件上方，
  // 而常驻窗口只有 400 高，底部条目会被裁掉（用户看到"只显示上面一半"）。
  // 菜单打开时把窗口向上扩展，关闭时收回原高度。
  // ---------------------------------------------------------------------
  function watchMenuSize() {
    var menu = document.querySelector('.dshwv-menu')
    if (!menu) return false
    // 注意：NORMAL_H 必须与 main.js 里的默认窗口高度一致，
    // 否则菜单关闭后窗口不会回到原尺寸。
    // MENU_H 要足够容纳「菜单 462px + 挂件形象 250px」再加上余量，
    // 否则菜单或挂件会被窗口裁掉（用户反馈过"只显示一半"和"图标消失"）。
    var NORMAL_H = 460      // 与 main.js 的 H 保持一致
    var MENU_H = 760        // 菜单 + 挂件 + 余量；主进程会在屏幕放不下时自动收敛
    var expanded = false
    var apply = function () {
      var open = menu.className.indexOf('dshwv-menu-open') !== -1
      if (open === expanded) return
      expanded = open
      // 窗口已固定为整屏，不再随菜单缩放（改小会把菜单裁掉）
      // 窗口变高后可用空间变多，面板可以少抬一些，避免顶得太靠上。
      try {
        document.documentElement.style.setProperty('--whale-chat-bottom', open ? '80px' : '170px')
      } catch (e) {}
      // 菜单区域也要纳入活动范围，否则菜单会被判定为"空白"而点击穿透。
      // 稍等一拍，等窗口尺寸调整完毕再测量。
      setTimeout(function () {
        if (typeof updateRegion === 'function') updateRegion()
      }, 150)
    }
    try {
      new MutationObserver(apply).observe(menu, { attributes: true, attributeFilter: ['class'] })
    } catch (e) {}
    apply()
    return true
  }
  var menuTimer = setInterval(function () {
    if (watchMenuSize()) clearInterval(menuTimer)
  }, 250)
  setTimeout(function () { try { clearInterval(menuTimer) } catch (e) {} }, 6000)

  // ---------------------------------------------------------------------
  // 活动区域上报：告诉主进程「哪些范围需要接收鼠标」，其余范围穿透到桌面。
  //
  // 之前是常开交互，结果是窗口整块矩形（360x460）都会挡住下面的软件按钮，
  // 而窗口左上角那片空白尤其明显。
  //
  // 注意不要用 mousemove 判断悬停：窗口一旦设为穿透，鼠标事件就不再进入
  // 页面，渲染层的检测永远不会触发 —— 那正是上一版「挂件完全点不动」的原因。
  // 位置判断交给主进程轮询鼠标，这里只上报区域矩形。
  // ---------------------------------------------------------------------
  function updateRegion() {
    try {
      var boxes = ['.dshwv-root', '.dshwv-menu.dshwv-menu-open', '.dshwv-chat.dshwv-chat-open']
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, found = false
      for (var i = 0; i < boxes.length; i++) {
        var el = document.querySelector(boxes[i])
        if (!el) continue
        var r = el.getBoundingClientRect()
        if (!r || r.width <= 0 || r.height <= 0) continue
        found = true
        if (r.left < minX) minX = r.left
        if (r.top < minY) minY = r.top
        if (r.right > maxX) maxX = r.right
        if (r.bottom > maxY) maxY = r.bottom
      }
      if (!found) return false
      if (IPC.setActiveRegion) {
        IPC.setActiveRegion({ x: Math.round(minX), y: Math.round(minY), w: Math.round(maxX - minX), h: Math.round(maxY - minY) })
      }
      return true
    } catch (e) { return false }
  }
  // 挂件被拖动后位置会变，活动区域必须跟着更新。
  // 否则鼠标移到新位置时会被判定为"空白"而穿透 —— 表现就是「拉远后点不动」。
  function watchRootPosition() {
    var rootEl = document.querySelector('.dshwv-root')
    if (!rootEl) return false
    var pending = null
    try {
      // 挂件移动时会频繁写 style（express/settle），这里做 60ms 节流
      new MutationObserver(function () {
        if (pending) return
        pending = setTimeout(function () { pending = null; updateRegion() }, 60)
      }).observe(rootEl, { attributes: true, attributeFilter: ['style', 'class'] })
    } catch (e) {}
    return true
  }
  var rootTimer = setInterval(function () {
    if (watchRootPosition()) clearInterval(rootTimer)
  }, 250)
  // 兜底：低频重报一次，防止有遗漏的位置变化途径
  setInterval(updateRegion, 2000)

  var regionTimer = setInterval(function () {
    if (updateRegion()) clearInterval(regionTimer)
  }, 250)
  // 不要监听 resize 再上报：窗口尺寸是本文件通过 IPC 改的，
  // 改尺寸会触发 resize → 再上报 → 又可能触发调整，形成事件风暴（实测把 CPU 拖高）。
  // 改为在改尺寸之后主动上报一次。

  // ---------------------------------------------------------------------
  // 对话框位置：原始 CSS 是 bottom:18px，正好压在右下角的挂件形象上。
  // 用 CSS 变量把它抬到挂件上方，并限制高度不超过可用空间。
  // 用变量而非写死：菜单展开时窗口会变高，那时可以少抬一些。
  // ---------------------------------------------------------------------
  var rootStyle = document.documentElement.style
  // 挂件原始 CSS 用 min(100vw,100vh) 决定大小，于是窗口一变矮、挂件也跟着缩水，
  // 导致「压窗口减盲区」和「面板要有高度」互相打架。
  // 改成都按宽度基准：窗口 360 下挂件恒为 250px，高度不再影响它。
  // 窗口高度因此可以给对话面板留出空间。
  var rootStyle = document.documentElement.style
  // 面板底部避让：必须大于挂件形象高度，否则会压住大肥鱼。
  rootStyle.setProperty('--whale-chat-bottom', '170px')
  // 只改对话面板位置，不动挂件尺寸。
  // （曾试图用变量覆盖 --dshw-base 让挂件只按宽度缩放，结果挂件变成 0×0：
  //   --dshw-scale 定义在 .dshwv-root 自身上，在 :root 求值拿不到，
  //   整个 clamp() 失效。窗口高度已经是 460，挂件自然就是 250px，无需覆盖。）
  var fix = document.createElement('style')
  fix.textContent =
    '.dshwv-root{--dshw-base:clamp(122px, calc(150px * var(--dshw-scale)), 625px)!important;}' +
    '.dshwv-chat{bottom:var(--whale-chat-bottom,170px)!important;' +
    'max-height:calc(100vh - var(--whale-chat-bottom,170px) - 14px)!important;min-height:180px;}'
  ;(document.head || document.documentElement).appendChild(fix)
})()
