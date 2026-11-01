# 小岛环境声音

制作日期：2026-10-30。`island-ambience.mp3` 为 72 秒、48 kHz 双声道、160 kbps 的复合环境声音。海浪、海鸟、含混人声已混合到一个文件，由网站的一个开关控制，用户开启后才加载和播放。

| 混音层 | 原始录音与作者 | 来源与许可 | 编辑 |
| --- | --- | --- | --- |
| 海浪 | SamsterBirdies — Calm ocean waves | [Freesound 578524](https://freesound.org/people/SamsterBirdies/sounds/578524/)，CC0 1.0 | 连续海浪；滤除低频噪声和尖锐高频，尾首交叉淡化 |
| 海鸟 | DaveGould — Seagulls-M.wav | [Freesound 32930](https://freesound.org/people/DaveGould/sounds/32930/)，CC0 1.0 | 自然海鸟叫声分组错落，柔化首尾与高频，轻微左右分布 |
| 人声 | blaastaal — murmuring | [Freesound 766658](https://freesound.org/people/blaastaal/sounds/766658/)，CC0 1.0 | 两段含混人声叠成远处交谈；频带收窄、尾首交叉淡化，不构成旁白 |

[CC0 1.0 许可](https://creativecommons.org/publicdomain/zero/1.0/)。原始作者页及许可于短片制作时核验，保存于本机 `video-production/audio/sources/*-source.html`；使用同批已保存录音，没有新增下载。原始文件是 Freesound 公开 HQ MP3 预览，不是原始无损母带。

网页循环与短片混音分开制作，不改变既有视频音轨。没有音乐或文字旁白。构建脚本：`tools/build-ambient-audio.py`；所需三段原录音已包含在仓库 `assets/audio-sources/`，无需视频制作目录。重建需要 Python、numpy、FFmpeg，Python 依赖见 `tools/requirements-audio.txt`。

温和压缩控制偶发浪峰与人声尖峰。最终 MP3 解码后实测 −16.94 LUFS、−2.78 dBTP；网页以 90% 增益播放时约 −17.86 LUFS、−3.70 dBTP。最终循环首尾有两秒连续交叉淡化；压缩和限幅状态也跨周期预热，避免音量在接缝处突然变化。精确测量、无削波与解码循环边界检查保存在本机 `output/ambient-audio/verification.json`。数值验证不等同于真人耳机试听。
