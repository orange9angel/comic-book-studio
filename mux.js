import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const episodeArg = process.argv.find((arg) => arg.startsWith('--episode='));
const episode = episodeArg ? episodeArg.slice('--episode='.length) : '';
const episodeRoot = episode ? path.join(__dirname, episode) : __dirname;

const storyPath = path.join(episodeRoot, 'story.json');
if (!fs.existsSync(storyPath)) {
  console.error(`story.json not found: ${storyPath}`);
  process.exit(1);
}

const story = JSON.parse(fs.readFileSync(storyPath, 'utf8'));
const title = story.title?.replace(/\s+/g, '_') || 'output';
const fps = story.fps || 24;
const framesDir = path.join(episodeRoot, 'frames');
const audioPath = path.join(episodeRoot, 'assets', 'audio', 'mixed.wav');
const outputDir = path.join(episodeRoot, 'output');
const outputPath = path.join(outputDir, `${title}_baked_kaiti.mp4`);

if (!fs.existsSync(framesDir)) {
  console.error(`Frames directory not found: ${framesDir}`);
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

const ffmpegArgs = [
  '-y',
  '-framerate', String(fps),
  '-i', path.join(framesDir, 'frame_%05d.png'),
  '-i', audioPath,
  '-c:v', 'libx264',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  '-b:a', '192k',
  '-shortest',
  outputPath
];

console.log(`Muxing: ${outputPath}`);
console.log(`  frames: ${framesDir}`);
console.log(`  audio:  ${audioPath}`);

const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: 'inherit' });
ffmpeg.on('close', (code) => {
  if (code === 0) {
    console.log(`Done: ${outputPath}`);
  } else {
    console.error(`ffmpeg exited with code ${code}`);
    process.exit(code || 1);
  }
});
