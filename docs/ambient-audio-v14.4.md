# V14.4 · 听见小岛

2026-10-30，本地网站更新。

右上角只有一个声音开关。点击「开启声音」后，海浪、错落的海鸟叫声和远处含混交谈一起播放；再次点击关闭。没有独立音轨开关或音量面板。每次打开页面都默认静音，点击前不下载声音文件。

声音为一个 72 秒、48 kHz 双声道 MP3 循环，约 1.44 MB。混音实测 −16.94 LUFS，网页默认增益 90% 后约 −17.86 LUFS，比短片的约 −20 LUFS 更明显。人声保持模糊，鸟鸣间歇出现。无削波，解码后首尾接缝检查通过。

`dist/harbor-audio.js` 使用一个可复用循环音源；切换带淡入淡出，暂停小岛或离开页面时声音淡出，恢复后继续。小鱼水下视角会柔化声音。快速开关、取消尚在加载的声音和加载失败重试不会叠加音源。

真实 Chrome 浏览器检查 12 项通过：默认静音与延迟加载、一个文件/音源、实际非零输出、关闭与暂停、快速切换、加载取消、失败重试、键盘控制、视角切换以及手机横竖屏布局等。页面错误为零。后台事件通过模拟可见性变化检查，未验证操作系统窗口切换。数值与浏览器信号检查不等同于真人耳机试听。

源码为 `dist/harbor-audio.js`，音频与出处在 `dist/public/audio/`。`tools/build-ambient-audio.py` 可从已有 CC0 原录音重建混音；原录音属于本机视频制作素材，不随网站仓库保存，需按 [SOURCES.md](../dist/public/audio/SOURCES.md) 所列来源准备 `ocean.mp3`、`seagulls.mp3`、`dialogue.mp3` 到 `video-production/audio/sources/`。网页运行只需要已经提交的复合 MP3。

本机验证资料：`output/ambient-audio/verification.json` 和 `output/playwright/ambient-audio/browser-report.json`。
