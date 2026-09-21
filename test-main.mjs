/**
 * 桌宠主进程逻辑集成测试（不需要 GUI）。
 *
 * 思路：main.js 里 Electron 部分无法在纯 Node 下加载，但核心业务逻辑是标准
 * Node 代码。这里把这些函数按源码原样提取出来（不重写），在临时目录中执行，
 * 从而真实验证：余额查询、会话 CRUD、流式问答转发。
 *
 * 默认不调用真实 API（省钱）。加 --with-key 才做真实流式请求。
 */
import { readFileSync, mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'

const withKey = process.argv.includes('--with-key')
const PET = process.cwd()
const src = readFileSync(join(PET, 'main.js'), 'utf8')

// 隔离目录：不碰项目里的真实 config/chat-data
const sandboxDir = mkdtempSync(join(tmpdir(), 'whale-pet-'))

// 从 main.js 抽出纯逻辑函数体（去掉 electron 依赖的 require 行）
const body = src
  .replace(/^const \{ app[\s\S]*?require\('electron'\)\s*$/m, '')
  .replace(/^app\.whenReady[\s\S]*$/m, '')          // 去掉窗口启动部分
  .replace(/^app\.on\('window-all-closed'[\s\S]*$/m, '')
  // will-quit 在 whenReady 之前，不受上面那两条贪婪替换影响，得单独摘掉，
  // 否则沙箱里没有 app 对象，一加载就 ReferenceError。
  .replace(/^app\.on\('will-quit'[^\n]*$/m, '')

// 覆盖路径常量：数据写到临时目录（隔离），但资源仍从真实项目目录读
const patched = body
  .replace(/const PROJECT_DIR = __dirname/, `const PROJECT_DIR = ${JSON.stringify(sandboxDir)}`)
  .replace(/const CONFIG_PATH = [^\n]+/, `const CONFIG_PATH = ${JSON.stringify(join(sandboxDir, 'config.json'))}`)
  .replace(/const CHAT_DIR = [^\n]+/, `const CHAT_DIR = ${JSON.stringify(join(sandboxDir, 'chat-data'))}`)
  .replace(/const ASSETS_DIR = [^\n]+/, `const ASSETS_DIR = ${JSON.stringify(join(PET, 'assets'))}`)

let fail = 0
const killed = []   // 记录被 main.js 请求执行的 taskkill（不应真的执行）
const ok = (m) => console.log('  OK   ' + m)
const bad = (m) => { fail++; console.log('  FAIL ' + m) }

// 真实 key 可选注入
if (withKey) {
  const cred = join(process.env.USERPROFILE || '', '.dsh', '.credentials.yaml')
  if (existsSync(cred)) {
    const m = readFileSync(cred, 'utf8').match(/^\s*DEEPSEEK_API_KEY\s*:\s*(.+?)\s*$/m)
    if (m) {
      writeFileSync(join(sandboxDir, 'config.json'), JSON.stringify({ apiKey: m[1].trim().replace(/^['"]|['"]$/g, '') }), 'utf8')
    }
  }
}

const sandbox = {
  console, fetch, setTimeout, clearTimeout, setInterval, clearInterval,
  AbortSignal, AbortController, TextDecoder, TextEncoder, URL, URLSearchParams,
  Response, Blob, ReadableStream, Buffer, process,
  require: (name) => {
    if (name === 'node:fs') return fsMod
    if (name === 'node:path') return pathMod
    if (name === 'node:crypto') return cryptoMod
    // main.js 用 execSync('taskkill ...') 做「重启时先杀旧实例」。
    // 测试里绝不能真去 taskkill（会杀掉用户正在用的桌宠，甚至误伤），
    // 所以只记录调用、返回成功。
    if (name === 'node:child_process') {
      return { execSync: (cmd, opts) => { killed.push({ cmd, opts }); return '' } }
    }
    throw new Error('unexpected require: ' + name)
  },
  module: { exports: {} }, exports: {},
  __dirname: sandboxDir,
}
import fsMod from 'node:fs'
import pathMod from 'node:path'
import cryptoMod from 'node:crypto'

sandbox.globalThis = sandbox
vm.createContext(sandbox)

// 暴露需要测试的函数
const expose = `
;globalThis.__T = {
  getApiKey, getBalance, readIndex, writeIndex, readSession, writeSession,
  validId, appendMessages, handleChatStream, handleApi, handleAsset, titleOf,
  ensureDir, CHAT_DIR, CONFIG_PATH,
}`
try {
  vm.runInContext(patched + expose, sandbox)
  ok('main.js 业务逻辑加载成功（无 electron 依赖部分）')
} catch (err) {
  bad('加载失败: ' + String(err && err.message).slice(0, 300))
  console.log(String(err && err.stack || '').split('\n').slice(0, 6).join('\n'))
  process.exit(1)
}
const T = sandbox.__T

console.log('')
console.log('--- 1. 配置与凭据 ---')
{
  const hasKey = !!T.getApiKey()
  if (withKey) {
    hasKey ? ok('API Key 已注入（--with-key）') : bad('--with-key 模式下没拿到 Key')
  } else {
    console.log('       无 Key 模式（默认）。getApiKey() = ' + JSON.stringify(T.getApiKey()))
    ok('配置读取路径正常')
  }
}

console.log('')
console.log('--- 2. 会话 CRUD ---')
{
  const id = 'whale-test-0001'
  T.validId(id) ? ok('合法 id 通过校验') : bad('合法 id 被拒')
  T.validId('bad') ? bad('非法 id 通过了校验') : ok('非法 id 被拒')
  T.validId('whale-../etc') ? bad('路径穿越 id 未被拦') : ok('路径穿越 id 被拦')

  const s = { id, title: '新对话', messages: [], createdAt: Date.now(), updatedAt: Date.now() }
  T.writeSession(s)
  T.readSession(id) ? ok('会话写入并可读回') : bad('会话读回失败')

  const idx = T.readIndex()
  idx.sessions.unshift({ id, title: '新对话', createdAt: Date.now(), updatedAt: Date.now() })
  idx.activeId = id
  T.writeIndex(idx)
  const idx2 = T.readIndex()
  idx2.sessions.some((x) => x.id === id) ? ok('索引写入可读回') : bad('索引读回失败')

  T.appendMessages(id, '你好', '你好呀')
  const s2 = T.readSession(id)
  s2 && s2.messages.length === 2 ? ok('消息追加成功（' + s2.messages.length + ' 条）') : bad('消息追加异常')
  s2 && s2.title === '你好' ? ok('标题自动取自首条消息: ' + s2.title) : bad('标题未更新: ' + (s2 && s2.title))

  // 历史上限
  for (let i = 0; i < 40; i++) T.appendMessages(id, 'q' + i, 'a' + i)
  const s3 = T.readSession(id)
  if (!s3 || !Array.isArray(s3.messages)) {
    bad('历史读取失败（会话为 null）')
  } else {
    s3.messages.length <= 40 ? ok('历史被裁剪到上限内（' + s3.messages.length + ' 条）') : bad('历史未裁剪: ' + s3.messages.length)
  }

  // 落盘
  const dir = join(sandboxDir, 'chat-data')
  existsSync(dir) ? ok('会话目录已创建') : bad('会话目录缺失')
  readdirSync(dir).some((f) => f.startsWith('whale-')) ? ok('会话文件落盘') : bad('会话文件缺失')
}

console.log('')
console.log('--- 3. 资源路由 ---')
{
  const img = await T.handleAsset('/dsh-whale/image.png?ver=v2')
  img.status === 200 && img.body && img.body.length > 1000 ? ok('形象图可读（' + img.body.length + ' 字节）') : bad('形象图读取失败: ' + JSON.stringify(img.status))
  const expr = await T.handleAsset('/dsh-whale/expr?name=happy&ver=v2')
  expr.status === 200 ? ok('表情图可读') : bad('表情图读取失败（happy/v2）')
  const snd = await T.handleAsset('/dsh-whale/sound/Ya1.mp3')
  snd.status === 200 ? ok('音效可读') : bad('音效读取失败')
  const badPath = await T.handleAsset('/dsh-whale/expr?name=../../config&ver=v2')
  badPath.status === 404 ? ok('表情名路径穿越被拦') : bad('表情名路径穿越未被拦！')
  const miss = await T.handleAsset('/dsh-whale/nope.png')
  miss.status === 404 ? ok('未知资源返回 404') : bad('未知资源未返回 404')
}

console.log('')
console.log('--- 4. 数据接口（无 Key 时的错误路径） ---')
{
  if (!T.getApiKey()) {
    const b = await T.getBalance()
    b.ok === false && b.code === 'NO_KEY' ? ok('无 Key 时余额返回明确错误: ' + b.error) : bad('无 Key 时余额响应异常: ' + JSON.stringify(b))
  } else {
    const b = await T.getBalance()
    b.ok ? ok('余额查询成功: ' + b.totalBalance + ' ' + b.currency + '  峰谷=' + b.isPeak) : bad('余额查询失败: ' + JSON.stringify(b))
  }
  const sizeRes = await T.handleApi('/dsh-whale/size.json', {})
  sizeRes.ok && typeof sizeRes.scale === 'number' ? ok('size.json 返回合法结构') : bad('size.json 结构异常')
  const sess = await T.handleApi('/dsh-whale/chat/sessions.json', {})
  sess.ok && Array.isArray(sess.sessions) ? ok('会话列表接口正常（' + sess.sessions.length + ' 个）') : bad('会话列表异常')
}

console.log('')
console.log('--- 5. 流式问答 ---')
{
  const sent = []
  const fakeWc = { isDestroyed: () => false, send: (ch, obj) => sent.push(obj) }
  await T.handleChatStream({ sessionId: 'whale-test-0001', message: 'hi' }, fakeWc)
  const first = sent[0]
  if (!T.getApiKey()) {
    first && first.t === 'err' && first.code === 'NO_KEY'
      ? ok('无 Key 时返回 {t:"err",code:"NO_KEY"} 流式错误块')
      : bad('无 Key 时响应不是约定的错误块: ' + JSON.stringify(first))
  } else {
    const text = sent.filter((x) => x.t === 'd').map((x) => x.c).join('')
    const done = sent.some((x) => x.t === 'done')
    const err = sent.find((x) => x.t === 'err')
    if (err) bad('真实问答报错: ' + err.error)
    else if (text) { ok('真实回答: ' + JSON.stringify(text.slice(0, 60))); done ? ok('收到 done 块') : bad('缺少 done') }
    else bad('没有内容返回')
    // 历史落盘
    const s = T.readSession('whale-test-0001')
    s && s.messages.length >= 2 ? ok('问答历史已落盘（' + s.messages.length + ' 条）') : bad('历史未落盘')
  }
  // 非法输入
  const s2 = []
  await T.handleChatStream({ sessionId: 'bad', message: 'x' }, { isDestroyed: () => false, send: (c, o) => s2.push(o) })
  s2[0] && s2[0].t === 'err' ? ok('非法会话 id 被拒') : bad('非法 id 未被拒')
}

// ---------------------------------------------------------------------------
console.log('--- 6. 重启逻辑不该在测试里动手 ---')
{
  killed.length === 0
    ? ok('测试期间没有执行任何 taskkill')
    : bad('测试期间竟然调用了 taskkill: ' + JSON.stringify(killed))
}

// 清理
try { rmSync(sandboxDir, { recursive: true, force: true }) } catch (e) {}

console.log('')
console.log(fail === 0 ? '桌宠主进程逻辑测试全部通过' : fail + ' 项失败')
process.exit(fail === 0 ? 0 : 1)
