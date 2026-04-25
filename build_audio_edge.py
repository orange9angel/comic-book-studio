#!/usr/bin/env python3
"""
Comic Book Studio — 多角色情感配音生成器

功能：
- 读取 story.json 中的旁白和角色对白
- 根据 voice_config.json 为每个角色分配独立声音
- 通过 rate/pitch/volume 参数组合模拟情感变化
- 生成 TTS、翻页音效、BGM 并混音为最终音频

注意：edge-tts 不支持 SSML mstts:express-as 情感标签（会自动转义），
      因此通过调整 rate/pitch/volume 参数来实现情感效果。

依赖：edge-tts, ffmpeg
"""
import asyncio
import json
import re
import subprocess
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent
AUDIO_DIR = ROOT / "assets" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)


def run(cmd):
    """运行外部命令，失败时抛出异常。"""
    subprocess.run(cmd, check=True)


def parse_percent(val: str) -> int:
    """解析百分比字符串如 '+10%' '-5%' 为整数。"""
    m = re.match(r"([+-]?\d+)%", val)
    return int(m.group(1)) if m else 0


def parse_hz(val: str) -> int:
    """解析赫兹字符串如 '+10Hz' '-5Hz' 为整数。"""
    m = re.match(r"([+-]?\d+)Hz", val, re.IGNORECASE)
    return int(m.group(1)) if m else 0


def combine_percent(base: str, offset: str) -> str:
    """合并两个百分比，如 '+5%' + '+3%' = '+8%'。"""
    total = parse_percent(base) + parse_percent(offset)
    sign = "+" if total >= 0 else ""
    return f"{sign}{total}%"


def combine_hz(base: str, offset: str) -> str:
    """合并两个赫兹值，如 '+5Hz' + '+3Hz' = '+8Hz'。"""
    total = parse_hz(base) + parse_hz(offset)
    sign = "+" if total >= 0 else ""
    return f"{sign}{total}Hz"


def load_story_and_config():
    """加载 story.json 和 voice_config.json。"""
    story_path = ROOT / "story.json"
    config_path = ROOT / "voice_config.json"

    story = json.loads(story_path.read_text(encoding="utf-8"))
    config = json.loads(config_path.read_text(encoding="utf-8"))

    return story, config


def estimate_duration(text: str, rate: str) -> float:
    """粗略估计语音时长（秒）。中文字符约 0.25s/字，rate 影响实际速度。"""
    # 统计中文字符数（不含标点和空白）
    char_count = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    # 基础时长
    base = max(1.0, char_count * 0.28)
    # rate 调整：+10% rate 表示快 10%，时长缩短
    rate_pct = parse_percent(rate)
    adjusted = base / (1 + rate_pct / 100)
    return adjusted


def build_lines(story, config):
    """
    从 story.json 构建配音行列表。

    编排策略：旁白和对白交替出现，互不重叠。
    - 每页开头放旁白（介绍场景），时长控制在 1.5s 以内
    - 旁白结束后放角色对白串行
    - 如果一页内容太多，优先保留对白，旁白可省略
    """
    roles = config["roles"]
    emotion_map = config["emotion_map"]
    lines = []
    line_idx = 0

    pages = story["pages"]

    for page_idx, page in enumerate(pages):
        page_start = page["start"]
        page_end = page["end"]
        page_duration = page_end - page_start
        bubbles = page.get("bubbles", [])
        caption = page.get("caption", "")

        # 估算旁白时长
        narrator_dur = 0.0
        if caption:
            narrator_cfg = roles.get("旁白", {
                "voice": "zh-CN-YunxiNeural",
                "rate": "+0%", "pitch": "+0Hz", "volume": "+0%"
            })
            narrator_dur = estimate_duration(caption, narrator_cfg["rate"])

        # 估算对白时长
        bubble_durs = []
        for bubble in bubbles:
            speaker = bubble.get("speaker", "旁白")
            emotion = bubble.get("emotion", "neutral")
            text = bubble.get("text", "")
            role_cfg = roles.get(speaker, roles.get("旁白"))
            emo_cfg = emotion_map.get(emotion, emotion_map["neutral"])
            rate = combine_percent(role_cfg["rate"], emo_cfg["rate_offset"])
            bubble_durs.append(estimate_duration(text, rate))

        total_dialogue_dur = sum(bubble_durs) + max(0, len(bubbles) - 1) * 0.4

        # 决策：旁白+对白+间隔 是否能在页面内放下
        # 留 0.5s 开头缓冲 + 0.5s 结尾缓冲
        available_time = page_duration - 1.0
        need_time = narrator_dur + total_dialogue_dur + (0.4 if caption else 0.0)
        skip_narrator = need_time > available_time

        current_time = page_start + 0.3

        # === 生成旁白 ===
        if caption and not skip_narrator:
            narrator = roles.get("旁白", {
                "voice": "zh-CN-YunxiNeural",
                "rate": "+0%", "pitch": "+0Hz", "volume": "+0%"
            })
            emo = emotion_map.get("neutral", emotion_map["neutral"])
            lines.append({
                "id": line_idx,
                "file": f"voice_{line_idx:03d}_narrator.mp3",
                "text": caption,
                "start": current_time,
                "speaker": "旁白",
                "voice": narrator["voice"],
                "rate": combine_percent(narrator["rate"], emo["rate_offset"]),
                "pitch": combine_hz(narrator["pitch"], emo["pitch_offset"]),
                "volume": combine_percent(narrator["volume"], emo["volume_offset"]),
                "type": "narrator",
            })
            line_idx += 1
            current_time += narrator_dur + 0.4

        # === 生成对白 ===
        for i, bubble in enumerate(bubbles):
            speaker = bubble.get("speaker", "旁白")
            emotion = bubble.get("emotion", "neutral")
            text = bubble.get("text", "")

            if not text:
                continue

            role_cfg = roles.get(speaker, roles.get("旁白"))
            emo_cfg = emotion_map.get(emotion, emotion_map["neutral"])

            rate = combine_percent(role_cfg["rate"], emo_cfg["rate_offset"])
            pitch = combine_hz(role_cfg["pitch"], emo_cfg["pitch_offset"])
            volume = combine_percent(role_cfg["volume"], emo_cfg["volume_offset"])

            if bubble.get("tone") == "robot":
                rate = combine_percent(rate, "+5%")
                pitch = combine_hz(pitch, "+5Hz")
            elif bubble.get("tone") == "star":
                rate = combine_percent(rate, "-3%")
                pitch = combine_hz(pitch, "+5Hz")
                volume = combine_percent(volume, "-3%")

            dur = bubble_durs[i]
            # 确保不超出页面结束时间（留 0.5s 边距）
            if current_time + dur > page_end - 0.5:
                break

            lines.append({
                "id": line_idx,
                "file": f"voice_{line_idx:03d}_{speaker}.mp3",
                "text": text,
                "start": current_time,
                "speaker": speaker,
                "voice": role_cfg["voice"],
                "rate": rate,
                "pitch": pitch,
                "volume": volume,
                "type": "dialogue",
            })
            line_idx += 1
            current_time += dur + 0.4

    return lines


async def generate_voice(line):
    """使用 edge-tts 生成单条语音。"""
    out = AUDIO_DIR / line["file"]
    communicate = edge_tts.Communicate(
        text=line["text"],
        voice=line["voice"],
        rate=line["rate"],
        pitch=line["pitch"],
        volume=line["volume"],
    )
    await communicate.save(str(out))
    print(f"  ✓ {line['file']} — {line['speaker']}: {line['text'][:20]}... [rate={line['rate']} pitch={line['pitch']} vol={line['volume']}]")


async def generate_all_voices(lines):
    """并发生成所有语音文件。"""
    print(f"Generating {len(lines)} voice lines...")
    await asyncio.gather(*(generate_voice(line) for line in lines))
    print("All voices generated.")


def mix_dialogue(lines):
    """将所有语音文件按时间轴混音为一条 dialogue 轨道。"""
    if not lines:
        return AUDIO_DIR / "dialogue_edge.wav"

    voice_inputs = []
    filters = []
    for i, line in enumerate(lines):
        voice_inputs.extend(["-i", str(AUDIO_DIR / line["file"])])
        delay = round(line["start"] * 1000)
        # 对白音量稍大，旁白稍小
        vol = 1.25 if line["type"] == "dialogue" else 1.0
        filters.append(f"[{i}:a]adelay={delay}|{delay},volume={vol}[v{i}]")

    mix_inputs = "".join(f"[v{i}]" for i in range(len(lines)))
    filters.append(
        f"{mix_inputs}amix=inputs={len(lines)}:duration=longest:normalize=0,"
        "aresample=48000[dialogue]"
    )

    dialogue = AUDIO_DIR / "dialogue_edge.wav"
    run([
        "ffmpeg", "-y",
        *voice_inputs,
        "-filter_complex", ";".join(filters),
        "-map", "[dialogue]",
        "-acodec", "pcm_s16le",
        "-ar", "48000",
        str(dialogue),
    ])
    return dialogue


def generate_page_flip_sfx():
    """生成翻页音效。"""
    flip = AUDIO_DIR / "page_flip.wav"
    run([
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", "anoisesrc=d=0.42:c=pink:r=48000",
        "-af",
        "highpass=f=650,lowpass=f=5200,afade=t=in:st=0:d=0.025,"
        "afade=t=out:st=0.22:d=0.20,volume=0.20",
        "-ac", "2",
        str(flip),
    ])
    return flip


def mix_sfx(flip, flip_times):
    """将翻页音效按时间点混音。"""
    sfx_inputs = []
    sfx_filters = []
    for i, t in enumerate(flip_times):
        sfx_inputs.extend(["-i", str(flip)])
        delay = round(t * 1000)
        sfx_filters.append(f"[{i}:a]adelay={delay}|{delay},volume=1.8[s{i}]")

    sfx_mix_inputs = "".join(f"[s{i}]" for i in range(len(flip_times)))
    sfx_filters.append(
        f"{sfx_mix_inputs}amix=inputs={len(flip_times)}:duration=longest:normalize=0,"
        "aresample=48000[sfx]"
    )

    sfx = AUDIO_DIR / "sfx.wav"
    run([
        "ffmpeg", "-y",
        *sfx_inputs,
        "-filter_complex", ";".join(sfx_filters),
        "-map", "[sfx]",
        "-acodec", "pcm_s16le",
        "-ar", "48000",
        str(sfx),
    ])
    return sfx


def generate_bgm(total_duration=32):
    """生成 BGM 轨道。"""
    bgm_src = AUDIO_DIR / "pixabay_bgm.mp3"
    bgm = AUDIO_DIR / "bgm.wav"

    if not bgm_src.exists():
        print(f"Warning: BGM source not found at {bgm_src}, creating silent track.")
        run([
            "ffmpeg", "-y",
            "-f", "lavfi",
            "-i", "anullsrc=r=48000:cl=stereo",
            "-t", str(total_duration),
            "-acodec", "pcm_s16le",
            str(bgm),
        ])
        return bgm

    fade_out_start = max(0, total_duration - 3)
    run([
        "ffmpeg", "-y",
        "-stream_loop", "-1",
        "-i", str(bgm_src),
        "-t", str(total_duration),
        "-af", f"volume=0.17,afade=t=in:st=0:d=1.2,afade=t=out:st={fade_out_start}:d=3",
        "-ac", "2",
        "-ar", "48000",
        str(bgm),
    ])
    return bgm


def final_mix(dialogue, bgm, sfx):
    """将 dialogue、bgm、sfx 混音为最终音频。"""
    mixed = AUDIO_DIR / "mixed.wav"
    run([
        "ffmpeg", "-y",
        "-i", str(dialogue),
        "-i", str(bgm),
        "-i", str(sfx),
        "-filter_complex",
        "[0:a]volume=1.15[d];[1:a]volume=1.0[b];[2:a]volume=1.0[s];"
        "[d][b][s]amix=inputs=3:duration=longest:normalize=0,alimiter=limit=0.95[out]",
        "-map", "[out]",
        "-acodec", "pcm_s16le",
        "-ar", "48000",
        str(mixed),
    ])
    return mixed


async def main():
    print("=" * 50)
    print("Comic Book Studio — 多角色情感配音生成器")
    print("=" * 50)

    # 1. 加载配置
    story, config = load_story_and_config()
    print(f"Loaded story: {story['title']} ({len(story['pages'])} pages)")

    # 2. 构建配音行
    lines = build_lines(story, config)
    print(f"Total voice lines: {len(lines)}")
    for line in lines:
        print(f"  [{line['start']:6.2f}s] {line['speaker']:6s} : {line['text'][:30]}... [voice={line['voice']}, rate={line['rate']}, pitch={line['pitch']}]")

    # 3. 生成语音
    await generate_all_voices(lines)

    # 4. 混音 dialogue
    print("\nMixing dialogue track...")
    dialogue = mix_dialogue(lines)

    # 5. 生成 SFX
    print("Generating SFX...")
    flip = generate_page_flip_sfx()
    # 翻页时间点 = 每页结束时间 - transitionDuration（最后一页不翻页）
    transition_dur = story.get("transitionDuration", 0.9)
    flip_times = [page["end"] - transition_dur for page in story["pages"][:-1]]
    print(f"  Page flip times: {flip_times}")
    sfx = mix_sfx(flip, flip_times)

    # 6. 生成 BGM
    print("Generating BGM...")
    bgm = generate_bgm(story.get("totalDuration", 32))

    # 7. 最终混音
    print("Final mix...")
    mixed = final_mix(dialogue, bgm, sfx)

    # 8. 保存清单
    manifest = {
        "tts": "edge-tts",
        "ssml": False,
        "note": "edge-tts auto-escapes SSML tags, so mstts:express-as is not supported. Emotion is simulated via rate/pitch/volume.",
        "lines": [
            {
                "id": line["id"],
                "speaker": line["speaker"],
                "text": line["text"],
                "start": line["start"],
                "voice": line["voice"],
                "rate": line["rate"],
                "pitch": line["pitch"],
                "volume": line["volume"],
                "type": line["type"],
            }
            for line in lines
        ],
    }
    (AUDIO_DIR / "edge_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"\n{'=' * 50}")
    print(f"Audio written to: {mixed}")
    print(f"Manifest: {AUDIO_DIR / 'edge_manifest.json'}")
    print(f"{'=' * 50}")


if __name__ == "__main__":
    asyncio.run(main())
