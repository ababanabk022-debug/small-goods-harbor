# 小岛 · 自由漫游

独立托管的三维小岛展示，采用原生 HTML、CSS、JavaScript 和本地 Three.js。

静态网站内容在 `dist/`。支持鼠标与触屏旋转、缩放、平移，以及实时海浪、六秒循环水下光纹、小船轻晃、暂停和自动环绕。

`dist/public/assets/harbor-lite.glb` 是默认场景模型；`harbor.glb` 是高细节备用模型。所有模型和运行依赖随站点托管，无需 Blender 或外部素材服务。

站点 ID 和静态目录配置保存在 `.openai/hosting.json`。此目录是独立的发布工程，不与原应用工程合并。

网页的光照、纹理与折射为实时近似，与 Blender 离线渲染存在差异。
