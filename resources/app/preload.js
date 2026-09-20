/**
 * preload — 连接渲染层与主进程，并让旧挂件代码「无感」迁移。
 *
 * 为什么需要拦截 fetch：
 *   沿用过来的挂件前端代码会请求 /dsh-whale/* 系列路径（余额、表情图、音效、
 *   会话接口）。这些请求由 renderer/bridge.js 在页面上下文里接管，转成 IPC
 *   交给主进程，前端逻辑因此几乎不用改。
 *
 * 注意 contextIsolation：
 *   本应用用 contextIsolation: true，preload 与页面上下文隔离，
 *   所以覆盖 window.fetch 必须在页面上下文做（见 renderer/bridge.js），
 *   preload 只负责把 IPC 通道交出去。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('__whaleIPC__', {
  getConfig: () => ipcRenderer.invoke('whale:getConfig'),
  saveConfig: (patch) => ipcRenderer.invoke('whale:saveConfig', patch),
  asset: (url) => ipcRenderer.invoke('whale:asset', url),
  api: (pathname, payload) => ipcRenderer.invoke('whale:api', pathname, payload),
  createSession: (id) => ipcRenderer.invoke('whale:createSession', id),
  deleteSession: (id) => ipcRenderer.invoke('whale:deleteSession', id),
  openExternal: (url) => ipcRenderer.invoke('whale:openExternal', url),
  quit: () => ipcRenderer.invoke('whale:quit'),
  moveWindow: (dx, dy) => ipcRenderer.invoke('whale:moveWindow', dx, dy),
  setInteractive: (on) => ipcRenderer.invoke('whale:setInteractive', on),
  setWindowSize: (w, h) => ipcRenderer.invoke('whale:setWindowSize', w, h),
  // 上报需要接收鼠标的区域（挂件/菜单/面板），其余范围穿透到桌面
  setActiveRegion: (r) => ipcRenderer.invoke('whale:setActiveRegion', r),

  // 流式问答：主进程用 chat:chunk 持续推送增量。
  // 按 streamId 过滤，避免多条流并发时互相收下对方的增量（回答串台）。
  chatStream: (payload, onChunk, streamId) => {
    const listener = (_e, obj) => {
      if (!obj || obj.streamId !== streamId) return
      try { onChunk(obj) } catch (err) {}
    }
    ipcRenderer.on('chat:chunk', listener)
    const done = ipcRenderer.invoke('whale:chatStream', payload, streamId)
    return done.finally(() => {
      // 稍后摘监听，确保最后几个 chunk 已送达
      setTimeout(() => { try { ipcRenderer.removeListener('chat:chunk', listener) } catch (err) {} }, 300)
    })
  },
})
