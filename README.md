# 小岛 · 自由漫游

独立托管的三维小岛展示，采用原生 HTML、CSS、JavaScript 和本地 Three.js。

在线体验：https://small-goods-harbor-yfsong.flowymule11.chatgpt.site

## 本地运行

安装 Python 3 后，在仓库根目录运行：

```powershell
py -m http.server 5198 --bind 127.0.0.1 --directory dist
```

macOS / Linux 可将 `py` 改为 `python3`。浏览器打开 `http://127.0.0.1:5198/`，按 `Ctrl+C` 停止。如果端口被占用，将命令和访问地址中的 `5198` 改为其他空闲端口。

这是纯静态网站，无需 `npm install` 或构建。请通过 HTTP 服务器访问，不要直接双击 HTML 文件。首次载入会读取约 5.36 MB 的默认模型，浏览器需要支持 WebGL。

## 操作

- 鼠标左键拖动旋转，滚轮缩放，右键拖动平移。
- 触屏单指旋转、双指缩放或平移。
- 底部切换正面、背面、俯瞰、暂停、自动环绕和全屏。
- 空格暂停或继续动画，`R` 复位视角。

## 项目内容

静态网站内容在 `dist/`。支持鼠标与触屏旋转、缩放、平移，以及实时海浪、六秒循环水下光纹、小船轻晃、暂停和自动环绕。

`dist/public/assets/harbor-lite.glb` 是默认场景模型；`harbor.glb` 是高细节备用模型。所有模型和运行依赖随站点托管，无需 Blender 或外部素材服务。

站点 ID 和静态目录配置保存在 `.openai/hosting.json`。此目录是独立的发布工程，不与原应用工程合并。

网页的光照、纹理与折射为实时近似，与 Blender 离线渲染存在差异。

## 第三方依赖

Three.js 与 Draco 已随页面打包，不依赖远程 CDN。许可证和来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本仓库包含网页及其 GLB 模型，不包含 Blender 编辑源工程。
