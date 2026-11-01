# 网站环境声音的可编辑原录音

这三段 CC0 1.0 录音供 `tools/build-ambient-audio.py` 离线重建网站的复合环境声音。网站运行只读取已经生成的 `dist/public/audio/island-ambience.mp3`；不需要加载这里的素材或安装声音处理工具。

| 文件 | 作者与录音 | 来源 |
| --- | --- | --- |
| `ocean.mp3` | SamsterBirdies — Calm ocean waves | [Freesound 578524](https://freesound.org/people/SamsterBirdies/sounds/578524/) |
| `seagulls.mp3` | DaveGould — Seagulls-M.wav | [Freesound 32930](https://freesound.org/people/DaveGould/sounds/32930/) |
| `dialogue.mp3` | blaastaal — murmuring | [Freesound 766658](https://freesound.org/people/blaastaal/sounds/766658/) |

录音许可均为 [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)。文件为作者页面公开的 HQ MP3 预览，不是原始无损母带。网站混音的处理方法和测量值见 [混音说明](../../dist/public/audio/SOURCES.md)。

可选重建：安装 Python 3、FFmpeg（含 ffprobe），在仓库根目录执行：

```bash
python -m pip install -r tools/requirements-audio.txt
python tools/build-ambient-audio.py
```

macOS / Linux 可以使用 `python3`。重建结果写入 `dist/public/audio/`，中间文件写入忽略版本控制的 `output/ambient-audio/`。视频文件和视频制作中间素材不随本项目上传。
