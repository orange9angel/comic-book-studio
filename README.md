# Comic Book Studio

Prototype pipeline for generating a short voiced comic-book video from still pages.

This repository is independent from `dula-story`, `dula-engine`, and `dula-assets`. It can borrow ideas from those projects, but it owns its own renderer, story format, audio scripts, and media pipeline.

## Demo

The current example is `Starlight Courier`, a 5-page audio comic rendered at 1920x1080, 24 fps, 32 seconds.

Final rendered video:

```text
output/starlight_courier_baked_kaiti.mp4
```

## Pipeline

- `story.json` defines page timing, focus motion, image paths, and speech bubbles.
- `render.js` bakes speech bubbles into page textures, then renders a Three.js page-turn book.
- `render_frames.mjs` drives Chromium through Puppeteer and exports PNG frames.
- `build_audio_edge.py` generates Edge TTS dialogue, page-turn SFX, BGM mix, and final `assets/audio/mixed.wav`.

## Setup

Install JavaScript dependencies:

```powershell
npm install
```

Install Python dependency:

```powershell
pip install -r requirements.txt
```

FFmpeg must be available on `PATH`.

## Build

Generate audio:

```powershell
python .\build_audio_edge.py
```

Render all frames:

```powershell
npm run render
```

Encode the final video:

```powershell
npm run mux
```

For quick visual checks:

```powershell
npm run render:sample
```

Generated `frames/` are intentionally ignored because they can be recreated.
