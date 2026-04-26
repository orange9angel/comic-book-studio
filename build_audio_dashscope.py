#!/usr/bin/env python3
"""
Comic Book Studio — 阿里云 DashScope TTS 配音生成器

Features:
- 使用阿里云 DashScope Sambert API 生成高质量中文 TTS
- 中文效果自然流畅
- API 失败时自动回退到 edge-tts
- 生成 TTS、翻页音效、BGM 并混音为最终音频

Usage:
    1. 从 https://dashscope.console.aliyun.com/ 获取 API Key
    2. 设置环境变量: $env:DASHSCOPE_API_KEY="sk-xxx"
    3. 运行: python build_audio_dashscope.py

推荐声音预设（Sambert 模型）：
    - 小岚    : zhimao-v1    (知猫 — 活泼女童声)
    - 豆豆    : zhishuo-v1   (知硕 — 年轻男声)
    - 小星星  : zhixia-v1    (知夏 — 温柔女声)
    - 旁白    : zhishuo-v1   (知硕 — 沉稳男声)
"""
import asyncio
import json
import os
import subprocess
from pathlib import Path

import dashscope
import edge_tts

ROOT = Path(__file__).resolve().parent
AUDIO_DIR = ROOT / "assets" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

DASHSCOPE_API_KEY = os.environ.get("DASHSCOPE_API_KEY", "")
if DASHSCOPE_API_KEY:
    dashscope.api_key = DASHSCOPE_API_KEY

# Sambert 预设声音映射
DASHSCOPE_PRESETS = {
    "小岚": {
        "model": "sambert-zhimao-v1",    # 知猫 — 活泼女童声
    },
    "豆豆": {
        "model": "sambert-zhishuo-v1",   # 知硕 — 年轻男声
    },
    "小星星": {
        "model": "sambert-zhixia-v1",    # 知夏 — 温柔女声
    },
    "旁白": {
        "model": "sambert-zhishuo-v1",   # 知硕 — 沉稳男声
    },
}

# 回退 edge-tts 配置
EDGE_VOICE_MAP = {
    "小岚": {"voice": "zh-CN-XiaoyiNeural", "rate": "+0%", "pitch": "+0Hz", "volume": "+0%"},
    "豆豆": {"voice": "zh-CN-YunjianNeural", "rate": "+5%", "pitch": "+8Hz", "volume": "+5%"},
    "小星星": {"voice": "zh-CN-XiaoxiaoNeural", "rate": "-5%", "pitch": "+5Hz", "volume": "-5%"},
    "旁白": {"voice": "zh-CN-YunxiNeural", "rate": "+0%", "pitch": "+0Hz", "volume": "+0%"},
}


def run(cmd):
    """运行外部命令，失败时抛出异常。"""
    subprocess.run(cmd, check=True)


def load_story_and_config():
    """加载 story.json 和 voice_config.json。"""
    story_path = ROOT / "story.json"
    config_path = ROOT / "voice_config.json"
    story = json.loads(story_path.read_text(encoding="utf-8"))
    config = json.loads(config_path.read_text(encoding="utf-8"))
    return story, config


def generate_with_dashscope(text, model, output_path):
    """调用 DashScope Sambert API。成功返回 True，失败返回 False。"""
    if not DASHSCOPE_API_KEY:
        return False
    try:
        from dashscope.audio.tts import SpeechSynthesizer

        result = SpeechSynthesizer.call(
            model=model,
            text=text,
            sample_rate=48000,
        )
        if result.get_audio_data():
            with open(output_path, "wb") as f:
                f.write(result.get_audio_data())
            return True
        else:
            print(f"    DashScope 返回空音频")
            return False
    except Exception as e:
        print(f"    DashScope 失败: {e}")
        return False


async def generate_with_edgetts(text, voice, rate, pitch, volume, output_path):
    """回退到 edge-tts。"""
    communicate = edge_tts.Communicate(
        text=text, voice=voice, rate=rate, pitch=pitch, volume=volume
    )
    await communicate.save(str(output_path))


def get_mp3_duration(mp3_path):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(mp3_path)],
        capture_output=True, text=True,
    )
    try:
        return float(result.stdout.strip())
    except ValueError:
        return None


def build_lines(story, config):
    """从 story.json 构建配音行列表。"""
    roles = config["roles"]
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
            narrator_dur = max(1.0, len(caption) * 0.28)

        # 估算对白时长
        bubble_durs = []
        for bubble in bubbles:
            text = bubble.get("text", "")
            char_count = sum(1 for c in text if "\u4e00" <= c <= "\u9fff")
            bubble_durs.append(max(1.0, char_count * 0.28))

        total_dialogue_dur = sum(bubble_durs) + max(0, len(bubbles) - 1) * 0.4
        available_time = page_duration - 1.0
        need_time = narrator_dur + total_dialogue_dur + (0.4 if caption else 0.0)
        skip_narrator = need_time > available_time

        current_time = page_start + 0.3

        # 生成旁白
        if caption and not skip_narrator:
            narrator = roles.get("旁白", {"voice": "zh-CN-YunxiNeural", "rate": "+0%", "pitch": "+0Hz", "volume": "+0%"})
            lines.append({
                "id": line_idx,
                "file": f"voice_{line_idx:03d}_narrator.mp3",
                "text": caption,
                "start": current_time,
                "speaker": "旁白",
                "voice": narrator["voice"],
                "rate": "+0%",
                "pitch": "+0Hz",
                "volume": "+0%",
                "type": "narrator",
                "dashscope": DASHSCOPE_PRESETS.get("旁白"),
            })
            line_idx += 1
            current_time += narrator_dur + 0.4

        # 生成对白
        for i, bubble in enumerate(bubbles):
            speaker = bubble.get("speaker", "旁白")
            text = bubble.get("text", "")
            if not text:
                continue

            role_cfg = roles.get(speaker, roles.get("旁白"))
            dur = bubble_durs[i]
            if current_time + dur > page_end - 0.5:
                break

            lines.append({
                "id": line_idx,
                "file": f"voice_{line_idx:03d}_{speaker}.mp3",
                "text": text,
                "start": current_time,
                "speaker": speaker,
                "voice": role_cfg["voice"],
                "rate": role_cfg.get("rate", "+0%"),
                "pitch": role_cfg.get("pitch", "+0Hz"),
                "volume": role_cfg.get("volume", "+0%"),
                "type": "dialogue",
                "dashscope": DASHSCOPE_PRESETS.get(speaker),
            })
            line_idx += 1
            current_time += dur + 0.4

    return lines


async def generate_voice(line):
    """生成单条语音，优先 DashScope，失败回退 edge-tts。"""
    out = AUDIO_DIR / line["file"]

    # 尝试 DashScope
    if DASHSCOPE_API_KEY and line.get("dashscope"):
        cfg = line["dashscope"]
        print(f"  DashScope: {line['speaker']} - {line['text'][:15]}... (model={cfg['model']})")
        if generate_with_dashscope(line["text"], cfg["model"], out):
            print(f"    ✅ 成功")
            return
        print(f"    ⚠️ 回退到 edge-tts")

    # 回退到 edge-tts
    cfg = EDGE_VOICE_MAP.get(line["speaker"], EDGE_VOICE_MAP["旁白"])
    await generate_with_edgetts(
        line["text"], cfg["voice"], cfg["rate"], cfg["pitch"], cfg["volume"], out
    )
    print(f"  edge-tts: {line['speaker']} - {line['text'][:15]}...")


async def generate_all_voices(lines):
    """并发生成所有语音文件。"""
    print(f"生成 {len(lines)} 条语音...")
    await asyncio.gather(*(generate_voice(line) for line in lines))
    print("全部语音生成完成。")


def mix_dialogue(lines):
    """将所有语音文件按时间轴混音。"""
    if not lines:
        return AUDIO_DIR / "dialogue_dashscope.wav"

    voice_inputs = []
    filters = []
    for i, line in enumerate(lines):
        voice_inputs.extend(["-i", str(AUDIO_DIR / line["file"])])
        delay = round(line["start"] * 1000)
        vol = 1.25 if line["type"] == "dialogue" else 1.0
        filters.append(f"[{i}:a]adelay={delay}|{delay},volume={vol}[v{i}]")

    mix_inputs = "".join(f"[v{i}]" for i in range(len(lines)))
    filters.append(
        f"{mix_inputs}amix=inputs={len(lines)}:duration=longest:normalize=0,"
        "aresample=48000[dialogue]"
    )

    dialogue = AUDIO_DIR / "dialogue_dashscope.wav"
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
    print("Comic Book Studio — DashScope TTS 配音生成器")
    print("=" * 50)

    if not DASHSCOPE_API_KEY:
        print("[WARNING] DASHSCOPE_API_KEY 未设置，将使用 edge-tts")
        print("获取 Key: https://dashscope.console.aliyun.com/")
    else:
        print(f"[INFO] DashScope API Key 已设置: {DASHSCOPE_API_KEY[:12]}...")

    # 1. 加载配置
    story, config = load_story_and_config()
    print(f"加载故事: {story['title']} ({len(story['pages'])} 页)")

    # 2. 构建配音行
    lines = build_lines(story, config)
    print(f"总配音行数: {len(lines)}")

    # 3. 生成语音
    await generate_all_voices(lines)

    # 4. 混音 dialogue
    print("\n混音对白轨道...")
    dialogue = mix_dialogue(lines)

    # 5. 生成 SFX
    print("生成音效...")
    flip = generate_page_flip_sfx()
    transition_dur = story.get("transitionDuration", 0.9)
    flip_times = [page["end"] - transition_dur for page in story["pages"][:-1]]
    print(f"  翻页时间点: {flip_times}")
    sfx = mix_sfx(flip, flip_times)

    # 6. 生成 BGM
    print("生成 BGM...")
    bgm = generate_bgm(story.get("totalDuration", 32))

    # 7. 最终混音
    print("最终混音...")
    mixed = final_mix(dialogue, bgm, sfx)

    # 8. 统计
    total_chars = sum(len(line["text"]) for line in lines)
    print(f"\n{'=' * 50}")
    print(f"音频输出: {mixed}")
    print(f"本次使用字符数: {total_chars}")
    print(f"{'=' * 50}")


if __name__ == "__main__":
    asyncio.run(main())
