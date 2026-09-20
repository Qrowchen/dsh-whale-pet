# 大肥鱼桌宠

独立运行在桌面上的大肥鱼挂件：透明无边框窗口、可在**屏幕任意位置拖动**，显示
DeepSeek 余额，并带一个可多会话切换的对话面板。**不依赖 DSH**，直接连 DeepSeek API。

## 启动

**推荐**：双击 `start-pet.vbs`（无黑窗，静默启动）。

也可以双击 `run.bat` —— 会显示启动信息和日志路径，出错时停在窗口里不闪退。

或在终端里：`npm start`

**再次双击 `start-pet.vbs` 就是重启**：它会先结束正在运行的旧实例（连同所有子进程），
再启动新的。所以万一卡住了，不用去任务管理器，再点一次启动器即可。

## 操作

| 操作 | 效果 |
|---|---|
| 点挂件身体 | 按压反馈：形象切表情 + 音效 |
| 拖动挂件身体 | 把挂件移到屏幕任意位置 |
| 鼠标移到挂件上 | 显示汉堡菜单按钮（问答 / 表情 / 尺寸 / 音效） |
| 点气泡 | 三态循环：余额 → 峰谷信息 → 随机台词 → 关闭 |
| 关闭 | 右键任务栏图标退出，或 `Alt+F4` |

窗口本身是**整屏大小**的透明窗口，但只有挂件（以及展开的菜单/面板）会接收鼠标，
其余区域一律穿透到桌面 —— 所以挂件旁边的软件按钮仍然可以正常点击。

## 配置

编辑项目根目录的 `config.json`（可参照 `config.example.json`）：

```json
{
  "apiKey": "sk-你的Key",
  "scale": 1.5,
  "exprVer": "v2",
  "model": "deepseek-flash",
  "soundOn": true,
  "vol": 0.9
}
```

| 字段 | 说明 |
|---|---|
| `apiKey` | DeepSeek API Key。**只存在主进程（Node 侧）**，渲染层拿不到。也可用环境变量 `DEEPSEEK_API_KEY`（优先级更高）。 |
| `scale` | 挂件大小，0.6 ~ 2.5 |
| `exprVer` | 表情素材版本：`v1` / `v2` / `v3` / `v4` |
| `model` | 对话模型。**只能是 `deepseek-flash` 或 `deepseek-v4-pro`**（见下） |
| `soundOn` / `vol` | 音效开关与音量 |

> ⚠️ 模型名必须是官方 API 接受的 ID。`deepseek-v4.1-flash` 是 DSH 界面的**显示名**，
> 直接当模型名请求会被 400 拒绝。实测可用值只有 `deepseek-flash` 与 `deepseek-v4-pro`。

运行数据都在项目目录下，可随时删除重建：

- `chat-data/` —— 对话会话（`index.json` + 每会话一个文件）
- `usage-ledger.json` —— 今日消耗的本地记账
- `.whale-pid` —— 当前实例的进程号（重启功能用；正常退出会自动删除）

## 目录结构

```
dsh-whale-pet/
├── main.js              主进程：窗口、鼠标穿透、IPC、余额、流式问答、会话存储
├── preload.js           IPC 桥（contextBridge + 流式 chunk 的 streamId 过滤）
├── renderer/
│   ├── index.html       入口
│   ├── bridge.js        拦截 /dsh-whale/* 请求转 IPC、活动区域上报、面板避让
│   └── widget.js        挂件前端（由插件抽取，见 npm run gen:widget）
├── assets/              形象图 + 四套表情 + 音效（约 78 MB）
├── config.json          你的配置（含 API Key，不要外传）
├── run.bat              带日志的启动器（排错用）
├── start-pet.vbs        静默启动 / 重启（日常用）
└── test-main.mjs        主进程逻辑测试
```

## 与 DSH 插件的关系

前端代码复用自 DSH 插件 `dsh-whale-widget-plus-punky`，靠 `renderer/bridge.js`
覆盖 `window.fetch`、`window.Audio` 与图片 `src`，把原本打到 DSH 的 `/dsh-whale/*`
请求改为走 IPC，因此表情、气泡、拖拽、对话面板、Markdown 渲染全部保留。

插件那边更新后，重新抽取即可：

```
npm run gen:widget
```

## 开发与排错

```
npm test                        # 主进程逻辑测试（不花钱、不调真实 API）
node test-main.mjs --with-key    # 额外做一次真实 API 调用
npm run gen:widget               # 从插件重新抽取前端脚本
```

诊断模式（截屏 + 输出页面状态/活动区域/音频状态后自动退出）：

```
set WHALE_DIAG=1 && set WHALE_DIAG_WAIT=12000 && npm start
```

## 已知限制与设计取舍

- **需要 `node_modules`（约 380 MB）才能开发运行**。仓库里不含它，clone 后先 `npm install`。
  要分发给不装 Node 的人，需要自行打包（本项目做过手工打包：复制 Electron 运行时
  + 把应用放进 `resources/app/` 即可，产物不进仓库）。
- **鼠标穿透靠轮询**。主进程每 150ms 检查一次鼠标位置来决定是否穿透。曾经用过
  60ms，实测把 CPU 拖到 20 秒/25 秒并导致卡死；现在 150ms 已足够跟手。
  拖动期间会冻结穿透判定，避免判定翻转引发系统 API 调用风暴。
- **今日消耗是本地估算，不是官方数字**。DeepSeek 未开放用量查询接口，
  这里是用「余额差值」记账（`usage-ledger.json`），因此：
  首次观测只建立基准不累加；桌宠关闭期间的消耗若余额先降后升（充值）会漏记。
- **气泡三态**已定制为「余额 → 峰谷 → 台词（必定）→ 关闭」。
  上游原版第三态是从权重池随机抽的，约 62% 仍是峰谷，这里改成了确定性行为。
- 对话消耗不计入挂件的「今日消耗」统计 —— 问答是独立调用，不在同一条记账链路上。

## 许可与署名

**这个仓库里有三套不同的许可，请注意区分。**

### 代码 —— MIT

`main.js`、`preload.js`、`renderer/bridge.js`、`extract-widget.mjs`、`test-main.mjs`
及其余工程文件采用 MIT（见 [LICENSE](LICENSE)）。

### 前端挂件 —— 来自上游插件，同为 MIT

`renderer/widget.js` 是从 DSH 插件 [`dsh-whale-widget-plus-punky`](https://www.npmjs.com/package/dsh-whale-widget-plus-punky)
抽取的前端脚本（由 `extract-widget.mjs` 可复现生成，不是手改的）。
该插件基于 B站「月匠」的 `dsh-whale-widget` 二次开发，两者均为 MIT 许可。
上游更新后可重新抽取同步。

### 形象素材 —— **不是 MIT，是 CC BY-NC-SA 4.0**

`assets/` 下的图片与音效**不适用 MIT**：

- 基于 [fornarwhal/deepseek-whale-girl-icon](https://github.com/fornarwhal/deepseek-whale-girl-icon) 的二创作品
- 角色原型：上善无形 OC「溟月」；DeepSeek 元素二创：ZipZipPipe
- 许可证：[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
- **禁止商业使用**；转载需署名，并以相同方式共享

> ⚠️ 要**商用**必须先替换 `assets/` 里的全部素材。
> 只换 `DSniang1.png` 不够 —— 四套表情（`v1`~`v4`）同属该二创作品。

### 第三方依赖

Electron 及其运行时组件遵循各自许可证（MIT / BSD 等）。
`node_modules` 不进仓库，用 `npm install` 恢复。
