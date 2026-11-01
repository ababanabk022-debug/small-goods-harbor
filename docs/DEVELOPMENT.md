# 下载与继续开发

当前网站为 **V14.4**，对应的可编辑模型为 **V14.3.1**。这是一套独立的静态网页项目，可以从现有代码和模型继续开发，不依赖原始对话、Codex、MCP 服务或 API 密钥。

## 获取和运行

在 [GitHub 仓库](https://github.com/ababanabk022-debug/small-goods-harbor)选择 **Code → Download ZIP**，解压整个目录；需要保留版本记录时使用 Git：

```bash
git clone https://github.com/ababanabk022-debug/small-goods-harbor.git
cd small-goods-harbor
```

安装 Python 3。Windows 可以双击根目录的 `启动小岛网站.cmd`，也可以运行 `python start-local-site.py`；macOS / Linux 运行 `python3 start-local-site.py`。启动器会显示网址并打开浏览器，优先使用 `http://127.0.0.1:5207/`，端口占用时会选择其他端口。

如需在终端直接控制服务器，运行下列命令并访问 `http://127.0.0.1:5198/`：

```bash
python -m http.server 5198 --bind 127.0.0.1 --directory dist
```

macOS / Linux 将 `python` 换为 `python3`。终端按 `Ctrl+C` 停止。请通过本地 HTTP 服务器访问，不能直接用 `file://` 打开 `index.html`。

网页运行所需的 Three.js、Draco、GLB 和环境声音都已包含在仓库中，**不需要 npm 安装或构建步骤**。浏览器需要支持 WebGL 2、ES Modules / importmap、Web Worker 和 WebAssembly。

## 修改网页

`dist/` 就是可编辑源码，没有另外一套需要编译的隐藏 `src/`。编辑后刷新网页即可看到变化；若浏览器保留旧资源，使用强制刷新。主要入口如下：

| 文件 | 修改内容 |
| --- | --- |
| `dist/index.html`、`style.css` | 页面控件、文字和布局 |
| `dist/viewer.js` | 加载、镜头、光照和控件连接 |
| `dist/water.js`、`water-physics.js` | 水的外观、折射、涟漪传播和阻尼 |
| `dist/harbor-motion.js`、`harbor-navigation.js` | 小船和居民运动、引航 |
| `dist/harbor-hike.js` | 玛拉上山、山顶停留和返回 |
| `dist/harbor-pov.js` | 跟随第一视角和转头输入 |
| `dist/harbor-audio.js` | 单一复合声音开关、淡入淡出 |
| `dist/public/assets/` | 网页模型、远景模型与元数据 |
| `dist/public/audio/` | 已混好的环境声音与素材来源 |

修改后至少检查：模型能加载、海浪和角色持续运动、点击水面有涟漪与引航、暂停/继续、各第一视角切换、声音开关，以及手机尺寸布局。更改人物路线或模型时，还应检查转弯、台阶高度和近景遮挡。

## 修改模型并更新网页

只改网页逻辑或样式时无需 Blender。需要修改几何、文字、材质或建筑布局时，使用 [当前模型包](../blender/small-goods-harbor-pov.blend.zip)。解压其中的 `small-goods-harbor-pov.blend` 到 `blender/`，用 Blender 打开；制作和重开验证使用 Blender 5.2。字体已内嵌，模型没有外部贴图或链接库依赖。详见[模型包说明](../blender/README.md)。

保存修改后，在仓库根目录运行以下命令。`blender` 需在 PATH 中；也可以用自己机器上的 Blender 可执行文件路径替代。导出使用独立后台进程，不修改已保存的输入文件。

```bash
blender --background --factory-startup blender/small-goods-harbor-pov.blend --python-exit-code 1 --python blender/export-harbor.py -- --lite
blender --background --factory-startup --python-exit-code 1 --python blender/export-compress.py -- --lite
blender --background --factory-startup blender/small-goods-harbor-pov.blend --python-exit-code 1 --python blender/export-harbor.py
blender --background --factory-startup --python-exit-code 1 --python blender/export-compress.py
```

默认输出到 `output/export-staging/`。检查生成报告后，将下列四个文件复制到 `dist/public/assets/` 的同名位置，再运行网页检查：

- `harbor-lite.glb` 和 `scene-meta-lite.json`
- `harbor.glb` 和 `scene-meta.json`

`export-surface-textures.py` 由导出脚本自动调用；不需要单独运行。模型和元数据应成对更新。`POV_ENVIRONMENT` 远景集合不包含在这两个主岛导出中，网页另行加载现有 `harbor-horizon.glb`。`build-pov-environment.py` 是重建代码生成远景的工具，会重建该集合并保存 `.blend`；只改主岛时无需执行。

`fix-near-scene.py`、`finish-near-supports.py`、`add-stair-back-rocks.py`、`ground-summit-sign.py` 等是历史一次性修复脚本，不是导出的前置步骤。当前模型包已含这些修复；其中一些脚本依赖本机历史检查报告或会拒绝重复运行，下载后不应按文件名顺序全部执行。

开发中的 `.blend` 和 `output/` 已被 Git 忽略。需要交付更新后的可编辑场景时，可使用 `blender/package-harbor.py` 生成便携 ZIP 和清单；该工具还需要 Python、Node.js 和 Blender。其 `--blender` 参数请填写本机路径，版本号按实际更新填写：

```bash
python blender/package-harbor.py --blender blender --node node --version 14.3.2
```

这里的 `14.3.2` 仅为下一次模型修改的命令示例，不表示仓库已经包含该版本。打包会验证模型、内嵌字体和资源引用，并保持编辑工作副本不变。

## 重建环境声音

运行网站只需已经提交的 `dist/public/audio/island-ambience.mp3`。原始海浪、海鸟和人群录音保存在 `assets/audio-sources/`，均附 CC0 来源说明。只有重新混音才需要额外安装 NumPy 和 FFmpeg / ffprobe：

```bash
python -m pip install -r tools/requirements-audio.txt
python tools/build-ambient-audio.py
```

将 FFmpeg 和 ffprobe 放入 PATH 后运行，结果会写入 `dist/public/audio/`，中间文件位于 `output/ambient-audio/`。声音行为详见[环境声音说明](ambient-audio-v14.4.md)，录音出处见[素材来源](../assets/audio-sources/SOURCES.md)。

## 路径、提交和部署

请从仓库根目录执行上述命令，并保留 `dist/public/` 与 `dist/vendor/` 的相对位置；不要将本机绝对路径写入网页资源 URL。个人环境配置、缓存和生成文件无需提交。

下载 ZIP 的副本可以直接编辑；使用 Git 的协作者可新建分支提交修改。向原仓库直接推送需要仓库写权限，也可以 Fork 后通过 Pull Request 提交。仓库中的第三方依赖和录音许可见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)，本说明不改变原有许可范围。

部署时将 `dist/` 内容发布到支持静态文件的托管服务即可。GitHub 源码推送不会自动更新原来的 Sites 在线展示；部署是独立操作。
