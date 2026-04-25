import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = __dirname;
const story = JSON.parse(fs.readFileSync(path.join(root, 'story.json'), 'utf8'));
const framesDir = path.join(root, 'frames');
const outputDir = path.join(root, 'output');
const threeBuildDir = path.dirname(fileURLToPath(import.meta.resolve('three')));
const port = 8877;
const sampleArg = process.argv.find((arg) => arg.startsWith('--sample='));
const sampleTimes = sampleArg
  ? sampleArg.slice('--sample='.length).split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v))
  : null;

function assertInsideRoot(target) {
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Refusing to write outside demo root: ${target}`);
  }
}

function cleanFrames() {
  assertInsideRoot(framesDir);
  if (fs.existsSync(framesDir)) {
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
  fs.mkdirSync(framesDir, { recursive: true });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png'
  }[ext] || 'application/octet-stream';
}

function serveFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.error(`404: ${filePath}`);
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(filePath) });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath.startsWith('/vendor/')) {
    const fileName = path.basename(reqPath);
    serveFile(path.join(threeBuildDir, fileName), res);
    return;
  }

  const safeReq = reqPath === '/' ? '/render.html' : reqPath;
  const filePath = path.normalize(path.join(root, safeReq));
  const rel = path.relative(root, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  serveFile(filePath, res);
});

function listen() {
  return new Promise((resolve) => server.listen(port, resolve));
}

function closeServer() {
  return new Promise((resolve) => server.close(resolve));
}

if (sampleTimes) {
  fs.mkdirSync(outputDir, { recursive: true });
} else {
  cleanFrames();
}
await listen();
console.log(`Render server: http://127.0.0.1:${port}/render.html`);

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: story.width, height: story.height, deviceScaleFactor: 1 });
  page.on('console', (msg) => console.log(`PAGE: ${msg.text()}`));
  page.on('pageerror', (err) => console.error(`PAGE ERROR: ${err.message}`));
  await page.goto(`http://127.0.0.1:${port}/render.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.ready === true, { timeout: 60000 });

  if (sampleTimes) {
    for (const time of sampleTimes) {
      await page.evaluate((t) => window.renderFrame(t), time);
      const samplePath = path.join(outputDir, `sample_${String(Math.round(time * 10)).padStart(4, '0')}.png`);
      await page.screenshot({ path: samplePath, type: 'png' });
      console.log(`sample ${time}s -> ${samplePath}`);
    }
  } else {
    const totalFrames = Math.ceil(story.totalDuration * story.fps);
    const start = Date.now();
    for (let frame = 0; frame < totalFrames; frame++) {
      const t = frame / story.fps;
      await page.evaluate((time) => window.renderFrame(time), t);
      const framePath = path.join(framesDir, `frame_${String(frame + 1).padStart(5, '0')}.png`);
      await page.screenshot({ path: framePath, type: 'png' });

      if (frame === 0 || (frame + 1) % story.fps === 0 || frame + 1 === totalFrames) {
        const elapsed = (Date.now() - start) / 1000;
        const fps = (frame + 1) / Math.max(elapsed, 0.001);
        const pct = (((frame + 1) / totalFrames) * 100).toFixed(1);
        process.stdout.write(`\rframes ${frame + 1}/${totalFrames} ${pct}% renderFps=${fps.toFixed(1)}`);
      }
    }
    process.stdout.write('\n');
  }
} finally {
  await browser.close();
  await closeServer();
}

console.log(`Frames written: ${pathToFileURL(framesDir).href}`);
