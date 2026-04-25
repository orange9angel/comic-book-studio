#!/usr/bin/env python3
import asyncio
import json
import subprocess
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent
AUDIO_DIR = ROOT / "assets" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

LINES = [
    {
        "file": "edge_voice_01.mp3",
        "text": "雨后的旧城街角，小岚和豆豆捡到一封会发光的银色信。",
        "start": 0.45,
        "voice": "zh-CN-XiaoxiaoNeural",
    },
    {
        "file": "edge_voice_02.mp3",
        "text": "信封展开，一张星图在阁楼里亮了起来。",
        "start": 6.65,
        "voice": "zh-CN-XiaoxiaoNeural",
    },
    {
        "file": "edge_voice_03.mp3",
        "text": "银色信纸折成小船，载着他们沿星光飞过屋顶。",
        "start": 13.05,
        "voice": "zh-CN-XiaoxiaoNeural",
    },
    {
        "file": "edge_voice_04.mp3",
        "text": "乌云深处，一颗迷路的小星星被雨线缠住了。",
        "start": 19.45,
        "voice": "zh-CN-XiaoxiaoNeural",
    },
    {
        "file": "edge_voice_05.mp3",
        "text": "清晨，小星星回到天空，雨滴也变成了闪光的告别。",
        "start": 25.85,
        "voice": "zh-CN-XiaoxiaoNeural",
    },
]


def run(cmd):
    subprocess.run(cmd, check=True)


async def generate_voice(line):
    out = AUDIO_DIR / line["file"]
    communicate = edge_tts.Communicate(
        text=line["text"],
        voice=line["voice"],
        rate="+6%",
        pitch="+4Hz",
        volume="+0%",
    )
    await communicate.save(str(out))


async def main():
    await asyncio.gather(*(generate_voice(line) for line in LINES))

    voice_inputs = []
    filters = []
    for i, line in enumerate(LINES):
        voice_inputs.extend(["-i", str(AUDIO_DIR / line["file"])])
        delay = round(line["start"] * 1000)
        filters.append(f"[{i}:a]adelay={delay}|{delay},volume=1.35[v{i}]")

    mix_inputs = "".join(f"[v{i}]" for i in range(len(LINES)))
    filters.append(f"{mix_inputs}amix=inputs={len(LINES)}:duration=longest:normalize=0,aresample=48000[dialogue]")
    dialogue = AUDIO_DIR / "dialogue_edge.wav"
    run([
        "ffmpeg",
        "-y",
        *voice_inputs,
        "-filter_complex",
        ";".join(filters),
        "-map",
        "[dialogue]",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "48000",
        str(dialogue),
    ])

    flip = AUDIO_DIR / "page_flip.wav"
    run([
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anoisesrc=d=0.42:c=pink:r=48000",
        "-af",
        "highpass=f=650,lowpass=f=5200,afade=t=in:st=0:d=0.025,afade=t=out:st=0.22:d=0.20,volume=0.20",
        "-ac",
        "2",
        str(flip),
    ])

    bgm = AUDIO_DIR / "bgm.wav"
    run([
        "ffmpeg",
        "-y",
        "-stream_loop",
        "-1",
        "-i",
        str(AUDIO_DIR / "pixabay_bgm.mp3"),
        "-t",
        "32",
        "-af",
        "volume=0.17,afade=t=in:st=0:d=1.2,afade=t=out:st=29:d=3",
        "-ac",
        "2",
        "-ar",
        "48000",
        str(bgm),
    ])

    flip_times = [5.6, 12.0, 18.4, 24.8]
    sfx_inputs = []
    sfx_filters = []
    for i, t in enumerate(flip_times):
        sfx_inputs.extend(["-i", str(flip)])
        delay = round(t * 1000)
        sfx_filters.append(f"[{i}:a]adelay={delay}|{delay},volume=1.8[s{i}]")
    sfx_mix_inputs = "".join(f"[s{i}]" for i in range(len(flip_times)))
    sfx_filters.append(f"{sfx_mix_inputs}amix=inputs={len(flip_times)}:duration=longest:normalize=0,aresample=48000[sfx]")
    sfx = AUDIO_DIR / "sfx.wav"
    run([
        "ffmpeg",
        "-y",
        *sfx_inputs,
        "-filter_complex",
        ";".join(sfx_filters),
        "-map",
        "[sfx]",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "48000",
        str(sfx),
    ])

    mixed = AUDIO_DIR / "mixed.wav"
    run([
        "ffmpeg",
        "-y",
        "-i",
        str(dialogue),
        "-i",
        str(bgm),
        "-i",
        str(sfx),
        "-filter_complex",
        "[0:a]volume=1.15[d];[1:a]volume=1.0[b];[2:a]volume=1.0[s];[d][b][s]amix=inputs=3:duration=longest:normalize=0,alimiter=limit=0.95[out]",
        "-map",
        "[out]",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "48000",
        str(mixed),
    ])

    manifest = {
        "tts": "edge-tts",
        "voice": "zh-CN-XiaoxiaoNeural",
        "entries": LINES,
    }
    (AUDIO_DIR / "edge_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Audio written to {mixed}")


if __name__ == "__main__":
    asyncio.run(main())
