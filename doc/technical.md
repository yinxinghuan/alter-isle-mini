# Technical

## 1. 技术栈

- 游戏：Alter Isle Mini
- 类型：simulation
- 简述：Tap to build — Alter Isle 的手机精简版，35 个素材底部 dock，长按擦除，双指缩放，自动保存。一指 = 全部
- 框架 / 语言 / 构建：JavaScript, Vite
- 渲染方式：Canvas/WebGL
- 依赖摘录：vite@^5.1.0
- 平台元信息：meta.title=Alter Isle Mini；cover_url=/poster.png；category=simulation；uuid=5df90f00-de82-4149-a8f5-cb8a1b4167cb

## 2. 目录结构

- `index.html`：Vite/浏览器入口，挂载根节点和基础 meta。
- `vite.config.js`：配置构建、插件和相对路径 base。
- `package.json`：定义 npm 脚本、依赖和工程名称。
- `meta.json`：平台发布元信息，包含标题和封面。
- `src/aigram.js`：游戏源码模块。
- `src/config.js`：游戏源码模块。
- `src/main.js`：游戏源码模块。
- `src/ui/BottomDock.js`：游戏源码模块。
- `src/ui/Audio.js`：游戏源码模块。
- `src/ui/UIManager.js`：游戏源码模块。
- `src/core/Game.js`：游戏源码模块。
- `src/core/Renderer.js`：游戏源码模块。
- `src/core/InputManager.js`：游戏源码模块。
- `src/core/Camera.js`：游戏源码模块。
- `src/storage/SaveSystem.js`：游戏源码模块。
- `src/assets/imageToAsset.js`：游戏源码模块。
- `src/assets/voxelRenderer.js`：游戏源码模块。
- `src/assets/assetManifest.js`：游戏源码模块。

关键源码模块：

- `src/aigram.js`
- `src/config.js`
- `src/main.js`
- `src/ui/BottomDock.js`
- `src/ui/Audio.js`
- `src/ui/UIManager.js`
- `src/core/Game.js`
- `src/core/Renderer.js`
- `src/core/InputManager.js`
- `src/core/Camera.js`
- `src/storage/SaveSystem.js`
- `src/assets/imageToAsset.js`
- `src/assets/voxelRenderer.js`
- `src/assets/assetManifest.js`
- `src/assets/assetDefinitions.js`
- `src/assets/assetLoader.js`
- `src/building/PlacementSystem.js`
- `src/building/PlacedObject.js`
- `src/grid/TileMap.js`
- `src/grid/IsoGrid.js`

## 3. 核心模块

- 状态管理与主循环：通过模块级状态、对象引用和 `requestAnimationFrame` 推进游戏帧。
- 渲染方式：Canvas/WebGL，样式由 CSS/Less 和组件结构共同完成。
- 碰撞 / 更新：源码包含命中、距离、边界或重叠判断，结果会影响得分、生命或阶段。
- 音频：包含程序化音频或音频文件播放，按交互事件触发。
- 多语言：包含 i18n / locale 检测或 `t()` 文案函数。
- 存储：使用 localStorage、useGameSave 或 persist 保存分数、收藏、墙数据或本地状态。
- Aigram 运行时：接入 `@shared/runtime` 或平台桥接能力，用于用户、资料页、分享、通知或平台 API。

## 4. 扩展点

- 改玩法参数：优先查找 `src/` 内大写常量、hooks、主组件顶部配置或关卡数组。
- 换素材：替换 `public/`、`src/img/` 或源码 import 的图片/音频文件，并保持相对路径。
- 调视觉：修改主样式文件中的颜色、间距、动画时长、网格尺寸和响应式规则。
- 改文案：修改 i18n 字典、组件内标题按钮文案，保持 zh/en 同步。
- 加平台能力：在已有 `@shared/runtime`、useGameSave、排行榜、墙或通知调用附近扩展，避免另起一套存储。
