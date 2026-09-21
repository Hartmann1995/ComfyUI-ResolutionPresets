# ComfyUI-ResolutionPresets

> 常用出图尺寸预设 + 一键横竖屏 + 自定义分辨率（锁定宽高比）的 ComfyUI 分辨率节点。
> Resolution presets for ComfyUI — common canvas sizes, one-click orientation switch, and custom resolution with aspect-ratio lock.

[![ComfyUI](https://img.shields.io/badge/ComfyUI-custom%20node-8A2BE2)](https://www.comfy.org/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## 简介 | Overview

**中文**　ComfyUI-ResolutionPresets 是一个轻量的 ComfyUI 自定义节点，用于集中管理「出图分辨率」。它内置 SD1.5 / SDXL / 16:9 视频规格 / 21:9 超宽屏等常用预设，并提供「横竖屏」一键切换、「预设 / 自定义」模式切换、以及锁定宽高比自定义。方向（横屏 / 竖屏）由统一的开关强制，因此同一预设在竖屏模式下会自动旋转（如 `1920×1080` → `1080×1920`），无需为每种方向重复列预设项。所有尺寸默认对齐到 8 的倍数，避免潜在空间（latent）尺寸报错。

**English**　ComfyUI-ResolutionPresets is a lightweight custom node that centralizes *output resolution* management. It ships with common presets for SD1.5, SDXL, 16:9 video specs, and 21:9 ultrawide, plus a one-click portrait/landscape switch, a preset/custom mode toggle, and aspect-ratio-locked custom sizing. Orientation is enforced by a single flag, so the same preset auto-rotates in portrait mode (e.g. `1920×1080` → `1080×1920`) — no need to list separate portrait/landscape items. All sizes snap to multiples of 8 by default to keep latent dimensions valid.

---

## 节点 | Nodes

| 节点（显示名） | Node (display name) | 输出 | Output | 说明 | Description |
| --- | --- | --- | --- | --- | --- |
| `ResolutionPresets` | 分辨率预设 | `INT` 宽 / `INT` 高 | width / height | 连接到 `Empty Latent Image` 或任意需要宽高的节点 | Feed into `Empty Latent Image` or any node that takes width/height |
| `ResolutionPresetsLatent` | 分辨率预设-Latent | `LATENT` | latent | 直接输出空潜空间，等价于「分辨率预设 → Empty Latent Image」两步 | Outputs an empty latent directly — same as preset → Empty Latent Image |

> 两个节点共用同一套前端 UI 与分辨率计算逻辑，行为完全一致。
> Both nodes share the same UI and resolution logic, so they behave identically.

---

## 功能特性 | Features

- 🔘 **一键横竖屏**　*One-click orientation* — 按钮切换横屏 / 竖屏，旋转由后端统一强制，不覆盖你已填的自定义宽高。
- 🔘 **预设 / 自定义模式**　*Preset / custom mode* — 两种模式互斥显隐：切到自定义后，预设控件自动隐藏，避免后端忽略的死控件。
- 🔒 **锁定宽高比**　*Aspect-ratio lock* — 自定义模式下开启，改任意一边自动按比例计算另一边（对齐到 8 的倍数）。
- 📐 **强制 8 的倍数**　*Force multiple of 8* — 可选开关；关闭后仅做整数化与下界裁剪。Latent 版始终按 8 对齐（潜在空间硬性要求）。
- 🌐 **全中文 UI**　*Chinese UI* — 控件标签、输出端口名、按钮均为中文；状态开关隐藏，由按钮控制。
- 💾 **工作流持久化**　*Workflow persistence* — 通过 `onSerialize` / `onConfigure` 钩子正确保存与回填，重启 ComfyUI 后状态不丢失、已保存工作流不错位。

---

## 内置预设 | Built-in Presets

| 分组 | Group | 预设 | Preset |
| --- | --- | --- | --- |
| SD1.5（512 基准） | SD1.5 (512 base) | 512×512 · 640×512 · 768×512 · 768×640 | |
| SDXL（长边 ≈1024） | SDXL (long edge ≈1024) | 1024×1024 · 1152×896 · 1216×832 · 1344×768 · 1536×640 | |
| 16:9 视频 | 16:9 video | HD 1280×720 · FHD 1920×1080 · 2K 2560×1440 · 4K 3840×2160 | |
| 21:9 超宽屏 | 21:9 ultrawide | 2560×1080 · 3440×1440 | |
| 其它常用比例 | Other ratios | 4:3 1600×1200 · 3:2 1920×1280 · 5:4 1280×1024 | |

> 竖屏方向由「横竖屏」按钮强制，故预设表里只列横版基准尺寸。
> Portrait orientation is enforced by the button, so only landscape base sizes are listed.

---

## 安装 | Installation

**中文**
1. 将本仓库克隆到 ComfyUI 的 `custom_nodes` 目录：
   ```bash
   cd ComfyUI/custom_nodes
   git clone https://github.com/Hartmann1995/ComfyUI-ResolutionPresets.git
   ```
2. 重启 ComfyUI。
3. 在节点列表的「分辨率」(resolution) 分类下即可找到「分辨率预设」与「分辨率预设-Latent」。

**English**
1. Clone this repo into ComfyUI's `custom_nodes` directory:
   ```bash
   cd ComfyUI/custom_nodes
   git clone https://github.com/Hartmann1995/ComfyUI-ResolutionPresets.git
   ```
2. Restart ComfyUI.
3. Find **分辨率预设** / **分辨率预设-Latent** under the *resolution* category in the node list.

> 无需额外依赖（only uses `torch`，随 ComfyUI 自带）。
> No extra dependencies — only `torch`, which ships with ComfyUI.

---

## 使用方法 | Usage

**中文**
1. 拖入「分辨率预设」节点，默认输出 `宽度` / `高度`，连到 `Empty Latent Image` 的 `width` / `height`。
2. 点「模式」按钮在「预设 / 自定义」间切换：预设模式选内置尺寸；自定义模式填宽高并可用「宽高比」按钮锁定比例。
3. 点「横竖屏」按钮切换横 / 竖屏，同一预设会自动旋转。
4. 想要一步到位，可直接用「分辨率预设-Latent」节点，输出空潜空间连到采样器。

**English**
1. Drop a **分辨率预设** node; it outputs `宽度` / `高度` (width / height) — wire them to `Empty Latent Image`'s `width` / `height`.
2. Click **模式** (Mode) to switch between *Preset* and *Custom*. In custom mode, enter width/height and use the **宽高比** (Ratio) button to lock the aspect ratio.
3. Click **横竖屏** (Orientation) to switch landscape/portrait — the same preset auto-rotates.
4. For a one-shot setup, use the **分辨率预设-Latent** node, which outputs an empty latent straight to your sampler.

---

## 兼容性 | Compatibility

- 兼容旧工作流：历史工作流里残留的带「横屏 / 竖屏」字样的旧预设名，会自动回退到 `SDXL 1024×1024`；前端 `RATIOS` 映射表仍解析 `9:16 / 3:4 / 2:3 / 4:5` 等旧比例。
- 前端扩展版本：v0.39（见 `js/resolution_presets.js` 注释）。
- 取整规则：后端 `math.floor(x/8 + 0.5)` 与前端 `Math.round(x/8)*8` 一致（均为四舍五入），切换「强制 8 的倍数」开关时 UI 显示值与实际上下图完全一致。

- Legacy workflows are supported: stale preset names with "横屏/竖屏" labels fall back to `SDXL 1024×1024`; the frontend `RATIOS` table still parses old ratios like `9:16 / 3:4 / 2:3 / 4:5`.
- Frontend extension version: v0.39 (see comments in `js/resolution_presets.js`).
- Rounding: the backend `math.floor(x/8 + 0.5)` matches the frontend `Math.round(x/8)*8` (both round half-up), so the UI value and the actual generated size stay in sync when toggling "force multiple of 8".

---

## 文件结构 | File Structure

```
ComfyUI-ResolutionPresets/
├── __init__.py                 # 节点注册 + WEB_DIRECTORY | node registration
├── resolution_presets.py       # 后端：两个节点 + 分辨率计算 | backend: nodes + math
└── js/
    └── resolution_presets.js   # 前端：中文化 / 按钮 / 比例联动 / 持久化 | frontend UI
```

---

## 许可证 | License

MIT — 自由用于个人与商业项目。
MIT — free for personal and commercial use.
