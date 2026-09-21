#!/usr/bin/env node
/**
 * 查看大肥鱼桌宠的本地记账账本。
 *
 * 用法：
 *   node ledger-report.mjs                 # 读同目录的 usage-ledger.json
 *   node ledger-report.mjs <账本路径>       # 指定别的账本
 *
 * 为什么需要它：DeepSeek 没有开放用量查询接口，「今日消耗」是用余额差值
 * 本地估算的。这个脚本把账本里的观测流水按时间列出来，可以回答：
 *   什么时候开机、当时余额多少、每次观测掉了多少钱。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const file = process.argv[2] || join(here, 'usage-ledger.json')

if (!existsSync(file)) {
  console.log('账本还不存在：' + file)
  console.log('（桌宠成功查询过一次余额后才会生成）')
  process.exit(0)
}

let led
try {
  led = JSON.parse(readFileSync(file, 'utf8'))
} catch (e) {
  console.error('账本读取失败：' + e.message)
  process.exit(1)
}

function fmtTime(iso) {
  try {
    const d = new Date(iso)
    const p = (n) => String(n).padStart(2, '0')
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
  } catch (e) { return String(iso) }
}
function money(v) {
  return (v === null || v === undefined) ? '--' : Number(v).toFixed(2)
}

console.log('='.repeat(60))
console.log('  大肥鱼桌宠 · 本地记账')
console.log('='.repeat(60))
console.log('  账本文件 : ' + file)
console.log('  当日     : ' + (led.date || '--'))
console.log('  今日消耗 : ¥' + money(led.todayUsage))
console.log('  当前余额 : ¥' + money(led.lastBalance))
console.log('  最后更新 : ' + (led.updatedAt ? fmtTime(led.updatedAt) : '--'))

const log = Array.isArray(led.log) ? led.log : []
console.log('')
console.log('--- 今日观测流水（显示最近 40 条 / 共 ' + log.length + ' 条）---')
if (!log.length) {
  console.log('  （无。这是旧版账本格式，跑一会儿就会开始记录）')
} else {
  for (const r of log.slice(-40)) {
    const tag = r.e === 'start' ? '   <<< 开机首次观测' : ''
    const d = (r.d === null || r.d === undefined) ? '' : '   本次 -¥' + money(r.d)
    console.log('  ' + fmtTime(r.t) + '   余额 ¥' + money(r.b) + d + tag)
  }
}

const hist = Array.isArray(led.history) ? led.history : []
console.log('')
console.log('--- 历史汇总（最近 ' + Math.min(hist.length, 30) + ' 天）---')
if (!hist.length) {
  console.log('  （尚无。跨天后当天的累计会自动归档到这里，保留 30 天）')
} else {
  for (const h of hist.slice(0, 30)) {
    console.log('  ' + h.date + '   消耗 ¥' + money(h.usage) + '   日终余额 ¥' + money(h.endBalance))
  }
}
console.log('')
console.log('说明：')
console.log('  · “本次 -¥x.xx”= 那一次观测相比上次少的钱，累加即今日消耗')
console.log('  · 余额上升（充值）不计入消耗，但会更新基准')
console.log('  · 60 秒观测一次；掉线期间如果余额先降后升，那段落差无法还原')
