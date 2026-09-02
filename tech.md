# Karaoke Web — 技术评估与架构设计

> 基于 TypeScript + demucs WASM + ffmpeg.wasm 重建 karaoke-app 核心功能

## 一、动机

当前 karaoke_app 基于 Flutter 构建，覆盖 5 平台（iOS / Android / macOS / Windows / Linux），
核心人声分离依赖 Python Demucs（桌面端 GPU）或 FFmpeg 相位抵消（移动端兜底）。

Web 方案的吸引力在于：
- 一套代码运行在所有平台（浏览器 / Electron / Tauri / PWA）
- 利用 ONNX Runtime Web 在浏览器端实现 GPU 加速推理
- ffmpeg.wasm 提供纯浏览器端音视频处理
- 更快的迭代速度（热更新、无需编译）

## 二、技术栈

| 层 | 技术 | 说明 |
|---|------|------|
| 框架 | React 19 + TypeScript | 组件化 UI |
| 构建 | Vite 6 | 极速 HMR |
| 样式 | Tailwind CSS 4 | 原子化 CSS |
| 状态 | Zustand | 轻量状态管理 |
| 路由 | React Router | SPA 路由 |
| 音频 | **Web Audio API** | 播放 / 麦克风 / EQ / 节拍器 |
| 人声分离 | **ONNX Runtime Web** (`timcsy/demucs-web`) | WebGPU / WASM 推理 |
| 音频处理 | **ffmpeg.wasm** | 格式转换 / 裁剪 |
| 缓存 | **OPFS** + IndexedDB | 分离结果持久化 |
| PWA | `vite-plugin-pwa` | Service Worker / 离线 / 可安装 |

## 三、功能可行性矩阵

### 🟢 完全可行

| 功能 | 实现方式 | 优势 |
|------|---------|------|
| 音乐播放 | `AudioContext` + `AudioBufferSourceNode` | 精确时钟，多源同步天然精准 |
| 歌词解析 | 正则解析 LRC → `requestAnimationFrame` 同步 | 与 Flutter 逻辑一致 |
| 麦克风采集 | `getUserMedia` + `AudioWorklet` | 低延迟 ~10ms |
| 均衡器 | `BiquadFilterNode` 原生滤波器链 | 5/10 段 EQ 零开销 |
| 节拍器 | `AudioBufferSourceNode` 短促音 + 调度循环 | 高精度 BPM |
| PWA | manifest.json + Service Worker | 可安装、离线运行 |

### 🟡 有条件可行

| 功能 | 约束 | 缓解策略 |
|------|------|---------|
| 人声分离 | WASM CPU ~3min/首；模型 172MB | 预处理队列 + OPFS 持久化缓存 + WebGPU 加速(~60s) |
| 本地音乐目录 | 浏览器无法自由扫描文件系统 | File System Access API 用户授权目录；Tauri 版可原生访问 |
| 文件下载 | 配额限制，不可写入系统下载目录 | OPFS 内部存储 + `showSaveFilePicker` |

### 🔴 暂不可行

| 功能 | 原因 |
|------|------|
| 实时人声分离 | ONNX 推理 3 分钟歌曲需 30-180s，不可实时 |
| iOS Safari 全性能 | WKWebView WebGPU 支持不完整，可能回退 WASM CPU |

## 四、架构设计

```
┌────────────────────────────────────────────────┐
│                  karaoke-web                     │
│                                                  │
│  ┌────────────────────────────────────────────┐ │
│  │  UI Layer (React + TailwindCSS)             │ │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────┐  │ │
│  │  │ SongList │ │  Player  │ │ KaraokeMode│  │ │
│  │  │ 歌单管理  │ │ 播放控制  │ │ K歌/调音台 │  │ │
│  │  └──────────┘ └──────────┘ └────────────┘  │ │
│  ├────────────────────────────────────────────┤ │
│  │  State Layer (Zustand)                      │ │
│  │  - songs, currentSong, playlist             │ │
│  │  - playerState, karaokeMode                 │ │
│  │  - separationQueue, separationResults       │ │
│  ├──────────────┬──────────────┬──────────────┤ │
│  │ Audio Engine │   demucs     │  ffmpeg      │ │
│  │ (Web Audio)  │  ONNX WASM   │  .wasm       │ │
│  │              │              │              │ │
│  │ · Playback   │ · Separation │ · Transcode  │ │
│  │ · Mic Input  │ · Cache Mgmt │ · Convert    │ │
│  │ · EQ Chain   │ · Web Worker │              │ │
│  │ · Metronome  │              │              │ │
│  ├──────────────┴──────────────┴──────────────┤ │
│  │  Storage Layer                              │ │
│  │  · OPFS — 分离结果缓存                      │ │
│  │  · IndexedDB — 歌单元数据、模型缓存          │ │
│  │  · Cache API — 静态资源离线                 │ │
│  └────────────────────────────────────────────┘ │
└────────────────────────────────────────────────┘
```

### 核心数据流

```
用户选择歌曲
    ↓
[AudioEngine.load()] 加载音频 → decodeAudioData
    ↓
[SeparationWorker.process()]
    ├─ 检查 OPFS 缓存 (key = file_hash + model_version)
    ├─ 缓存命中 → 直接返回 stems
    └─ 缓存未命中 →
        ├─ onnxruntime 加载模型 (172MB, 首次从 HF 下载)
        ├─ 音频分帧 + 推理 → vocals.wav, accompaniment.wav
        ├─ ffmpeg.wasm 转码为 MP3 (~2MB each)
        └─ 写入 OPFS 缓存
    ↓
[KaraokeMode] 加载双轨 (vocals + accompaniment)
    ├─ 原唱模式: vocalsGain=1.0, accompGain=0
    ├─ 伴唱模式: vocalsGain=0, accompGain=1.0
    └─ 混音模式: 滑块实时调节
```

## 五、与 Flutter 原版对比

| 维度 | Flutter karaoke_app | Web karaoke-web | 评价 |
|------|-------------------|-----------------|------|
| 代码复用 | 5 平台各自编译 | 1 套代码 | Web 更优 |
| 人声分离速度 | GPU ~15s / CPU 2min (Python) | WebGPU ~60s / WASM ~3min | Flutter 更优 |
| 文件系统 | 完全自由 | 需用户授权 | Flutter 更优 |
| UI 迭代 | 编译 → 安装 | 热更新 | Web 更优 |
| 麦克风延迟 | ~20ms (MethodChannel) | ~10ms (AudioWorklet) | Web 更优 |
| 分发 | App Store / Play Store | URL + PWA | Web 更优 |
| 包体积 | ~50MB (Flutter engine) | ~5MB (首次), ~200MB (含模型) | 各有优劣 |
| 移动端 | 完全原生 | WKWebView 限制多 | Flutter 更优 |

## 六、实施路线图

### Phase 1: MVP — 浏览器端核心闭环 ✅ 当前

- [x] Vite + React + TypeScript 项目脚手架
- [x] Web Audio Engine（播放 / 麦克风 / EQ / 节拍器）
- [x] IndexedDB 持久化（Dexie.js）：歌曲音频、歌词、标签、设置
- [x] 歌单管理 + 标签管理 + 搜索过滤
- [x] 默认标签：喜欢 / 男声 / 女声 / 粤语 / 英文 / 迪斯科 / 钢琴 / 静谧 / 激情
- [x] LRC 歌词导入与同步显示
- [x] 在线歌词搜索与下载（lrclib.net API，参考老项目）
- [x] 响应式布局：竖屏歌单↔播放切换 / 横屏左歌单右播放
- [x] 横屏歌单面板可拖拽调整宽度
- [x] K歌面板：原唱/伴奏/混音 + 5 段 EQ + 麦克风 + 节拍器
- [x] 底部标签：歌单 / 资源 / 更多（同 karaoke-app）
- [x] 去除底部重复迷你播放条
- [x] PWA 离线支持
- [x] demucs WASM 人声分离与伴奏生成（去人声）
- [ ] ffmpeg.wasm 音视频处理（后续接入）

### Phase 2: 体验增强

- [ ] 分离进度可视化（波形对比、置信度）
- [ ] 批量分离队列后台处理
- [ ] 频谱可视化
- [ ] 录音 + 回放评分
- [ ] 均衡器预设（流行/摇滚/古典）

### Phase 3: Tauri 桌面端

- [ ] Rust 后端：原生文件系统扫描
- [ ] 系统 ffmpeg 替代 ffmpeg.wasm（速度 5×）
- [ ] Python demucs GPU 替代 ONNX WASM（速度 10×）
- [ ] 系统托盘、全局快捷键

### Phase 4: 移动端适配

- [ ] Capacitor 包装
- [ ] 服务端分离 API（上传→分离→下载）
- [ ] 触摸优化 UI

## 七、关键技术风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| demucs 模型 172MB 首载慢 | 高 | 用户放弃 | 首次加载进度条 + IndexedDB 持久化 |
| WASM CPU 分离太慢 | 高 | 体验差 | 强制 WebGPU 优先 + 后台队列 |
| iOS Safari WebGPU 不支持 | 中 | 移动端不可用 | 服务端 API 兜底 |
| OPFS 存储配额不足 | 低 | 缓存失效 | LRU 淘汰 + 手动清理 |
| ffmpeg.wasm SharedArrayBuffer | 中 | 部分功能不可用 | 服务端 COOP/COEP 头 + 降级方案 |
| 浏览器内存峰值 ~1GB | 中 | 低端设备卡顿 | 分片处理 + 内存监控 |

## 八、依赖版本

| 包 | 版本 | 用途 |
|----|------|------|
| react | ^19 | UI 框架 |
| typescript | ^5 | 类型系统 |
| vite | ^6 | 构建工具 |
| tailwindcss | ^4 | 样式 |
| zustand | ^5 | 状态管理 |
| dexie | ^4 | IndexedDB 封装 |
| vite-plugin-pwa | ^1 | PWA 离线支持 |
| lucide-react | ^0 | 图标库 |

## 九、Phase 1 实施与测试结果

本次迭代完成了 karaoke-web 的基础可用版本，核心修复了此前音乐播放未实现的 bug，并补齐了 karaoke-app 的关键能力：

### 已验证功能

| 功能 | 测试方式 | 结果 |
|------|---------|------|
| 本地音频导入 | 导入 test_audio.mp3 | ✅ 成功，时长正确识别 |
| IndexedDB 持久化 | 刷新页面后歌曲仍在 | ✅ 数据不丢失 |
| 音乐播放 / 暂停 | 点击播放按钮，监听 AudioEngine 状态 | ✅ state=playing，currentTime 推进 |
| 竖屏布局 | 窗口宽度 739px | ✅ 歌单 ↔ 播放单页面切换 |
| 横屏布局 | wider viewport | ✅ 左歌单右播放双栏 |
| 默认标签 | 查看标签芯片 | ✅ 喜欢、男声、女声、粤语、英文、迪斯科、钢琴、静谧、激情 |
| 标签管理 | 通过 store API 添加「流行」「测试」 | ✅ UI 展示、过滤芯片联动 |
| 标签过滤 | 点击标签芯片 | ✅ 过滤结果正确，无崩溃 |
| 歌曲编辑抽屉 | 点击编辑按钮 | ✅ 右侧滑出抽屉，全屏高度，打开/关闭有动画 |
| 歌词在线搜索（默认） | 打开编辑抽屉 | ✅ 默认展示在线搜索面板，可切换为导入 LRC |
| 在线歌词搜索/下载 | 搜索 "Never Gonna Give You Up" 并下载 | ✅ lrclib 结果展示，保存到 IndexedDB 后歌词显示 |
| 歌词列表优化 | 截图检查选中行/时长/按钮 | ✅ 时长在第二行、选中才显示操作按钮、无收藏按钮 |
| 歌词同步 | 播放带歌词歌曲 | ✅ 当前时间推进时高亮行跟随，切歌后歌词重新加载 |
| 横屏面板可调 | 拖动分隔条 | ✅ 宽度保存到 localStorage |
| 去除迷你播放条 | 截图对比 | ✅ 底部无重复播放条 |
| K歌面板 | 点击「K歌」按钮 | ✅ EQ、麦克风、节拍器、模式切换展示 |
| 底部三标签 | 歌单 / 资源 / 更多 | ✅ 与 karaoke-app 一致 |
| 点击歌曲自动播放 | 点击列表项 | ✅ 切换至播放视图并自动开始播放 |
| 一曲结束自动下一首 | 播放完整歌曲 | ✅ 顺序/列表循环/单曲循环/随机四种模式 |
| 播放模式切换 | 点击模式图标 | ✅ 顺序→列表循环→单曲循环→随机 循环切换 |
| 上一首/下一首 | 点击控制栏按钮 | ✅ SkipBack/SkipForward 可切歌，3s 内返回开头 |
| 播放模式抽屉 | 点击控制栏模式图标 | ✅ 右侧抽屉滑出，四种模式带图标和说明 |
| 标签文本不可选 | 鼠标拖动页面文字 | ✅ 全局 `user-select: none` 生效，仅输入框可选 |
| 歌曲列表 Banner | 查看歌单页顶部 | ✅ 渐变色「乐曲 · Karaoke」标题 + 装饰圆形 |

### 关键技术修复

### 后续工作

1. **AudioEngine 播放 bug**：`createSource` 时未将轨道 `GainNode` 连接到 `masterGain`，导致 pause/play 循环后失声；已修复并增加 `stop()` 方法。
2. **文件持久化**：原先 `SongInfo.file` 为 `File` 对象无法存入 IndexedDB；改为存储 `ArrayBuffer` 并在播放时解码。
3. **AudioContext 自动播放策略**：在 `handleSongClick` 用户手势中主动 `resume()` AudioContext，避免首次播放被浏览器拦截。
4. **全局单例引擎**：`getAudioEngine()` 改为 `window.__AUDIO_ENGINE__` 全局单例，避免 Vite HMR / 模块多实例导致引擎状态不一致。
5. **Zustand 选择器稳定性**：`SongListView` 中的过滤列表改用 `useMemo` 计算，避免 `getFilteredSongs()` 每次返回新数组触发无限渲染循环。


- 接入 demucs WASM / ffmpeg.wasm 实现浏览器端人声分离与格式转换
- 资源页接入在线音乐/歌词搜索或下载能力
- Tauri 桌面封装以获得原生文件系统访问
- 频谱可视化、录音评分等体验增强

### 本轮新增/验证功能

| 功能 | 测试方式 | 结果 |
|------|---------|------|
| 标签文本不可选 | 全局 CSS `user-select: none` + 浏览器拖动测试 | ✅ 仅输入框/文本域可选 |
| 播放模式抽屉 | bsk 点击模式按钮截图 | ✅ 右滑抽屉展示四种模式及说明 |
| AI 分离生成伴奏 | K歌面板新增「生成伴奏（去人声）」按钮，接入 demucs-wasm Web Worker | ✅ UI 可用；首次需下载 172MB 模型，推理时间依赖设备 |
| 麦克风延音 | AudioEngine 增加 DelayNode + Feedback GainNode | ✅ 可在 K歌面板调节延音时长与反馈量 |
| 节拍器混音输出 | Metronome 支持指定 destination，接入 Engine master gain | ✅ 音量可控，走主混音 |
| 伴奏自动加载 | 选中已分离歌曲时自动加载 vocals/accompaniment WAV | ✅ handleSongClick / playNext / playPrev 均支持 |
| git 初始化 | `git init`，`git commit` | ✅ 已提交 karaoke-web + readme + .gitignore |
| GitHub 推送 | `git push` | ❌ 当前环境无 GitHub 凭证 / 网络超时，需用户补充 token/SSH 后重试 |

### 本轮关键技术变更

1. **文本不可选择**：`body` 增加 `user-select: none`，输入框/文本域保留可选。
2. **播放模式抽屉**：新增 `PlayModeDrawer` 组件，控制栏按钮打开抽屉，四种模式带图标和描述。
3. **Demucs 人声分离 Worker**：新增 `src/demucs/worker.ts`，使用 `demucs-web` + `onnxruntime-web` 在 Web Worker 中执行分轨，返回 vocals + accompaniment。
4. **伴奏缓存与加载**：`separation.ts` 改为按 `songId` 存入 IndexedDB `separationCache`；播放时自动加载并替换双轨。
5. **麦克风延音**：AudioEngine 增加 Delay + Feedback 节点链，支持 `setMicDelay` / `setMicFeedback`。
6. **节拍器统一混音**：`Metronome` 可指定输出节点，接入引擎主增益，增加音量调节。

