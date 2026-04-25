import * as THREE from 'three';

const story = await fetch('/story.json').then((r) => r.json());
const width = story.width;
const height = story.height;
const pageW = 14.8;
const pageH = 8.33;
const pageZ = 0.05;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(width, height);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x08090d);
scene.fog = new THREE.Fog(0x08090d, 22, 46);

const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
camera.position.set(0, 0, 18);
camera.lookAt(0, 0, 0);

const ambient = new THREE.AmbientLight(0xf0f7ff, 1.7);
scene.add(ambient);

const key = new THREE.DirectionalLight(0xffdfaa, 2.1);
key.position.set(-5, 7, 10);
key.castShadow = true;
scene.add(key);

const rim = new THREE.PointLight(0x82d8ff, 45, 28);
rim.position.set(5, 2, 8);
scene.add(rim);

const bookGroup = new THREE.Group();
bookGroup.rotation.x = -0.055;
scene.add(bookGroup);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function wrapBubbleText(ctx, text, maxWidth) {
  const explicit = text.split('\n');
  const lines = [];
  for (const segment of explicit) {
    let current = '';
    for (const char of Array.from(segment)) {
      const test = current + char;
      if (current && ctx.measureText(test).width > maxWidth) {
        lines.push(current);
        current = char;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function bubbleColors(tone) {
  if (tone === 'robot') {
    return { fill: '#dffaff', stroke: '#073644', text: '#062832' };
  }
  if (tone === 'star') {
    return { fill: '#fff2b7', stroke: '#3b2868', text: '#30204f' };
  }
  return { fill: '#fffaf0', stroke: '#151515', text: '#111111' };
}

function drawBubble(ctx, bubble, canvas) {
  const scale = canvas.width / 1920;
  const x = bubble.x * canvas.width;
  const y = bubble.y * canvas.height;
  const w = (bubble.w || 300) * scale;
  const paddingX = 24 * scale;
  const paddingY = 18 * scale;
  const radius = 34 * scale;
  const fontSize = 50 * scale;
  const lineHeight = fontSize * 1.22;
  const colors = bubbleColors(bubble.tone);

  ctx.save();
  ctx.font = `${fontSize}px KaiTi, STKaiti, "Kaiti SC", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lines = wrapBubbleText(ctx, bubble.text, w - paddingX * 2);
  const h = Math.max(76 * scale, lines.length * lineHeight + paddingY * 2);
  const left = x - w / 2;
  const top = y - h / 2;
  const tail = bubble.tail || 'down';
  const tailOffset = tail === 'down-left' ? -w * 0.22 : tail === 'down-right' ? w * 0.22 : 0;
  const tailX = x + tailOffset;
  const tailY = top + h;

  ctx.shadowColor = 'rgba(0,0,0,0.30)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 7 * scale;

  ctx.beginPath();
  ctx.moveTo(tailX - 18 * scale, tailY - 3 * scale);
  ctx.lineTo(tailX + 16 * scale, tailY - 3 * scale);
  ctx.lineTo(tailX + (tail === 'down-left' ? -26 : tail === 'down-right' ? 26 : 0) * scale, tailY + 34 * scale);
  ctx.closePath();
  ctx.fillStyle = colors.fill;
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = 3.5 * scale;
  ctx.fill();
  ctx.stroke();

  roundedRect(ctx, left, top, w, h, radius);
  ctx.fillStyle = colors.fill;
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = 3.5 * scale;
  ctx.fill();
  ctx.stroke();

  ctx.shadowColor = 'transparent';
  ctx.fillStyle = colors.text;
  ctx.font = `${fontSize}px KaiTi, STKaiti, "Kaiti SC", serif`;
  const firstY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, x, firstY + i * lineHeight);
  });
  ctx.restore();
}

function createComicPageTexture(image, page) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const bubble of page.bubbles || []) {
    drawBubble(ctx, bubble, canvas);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

const pageImages = await Promise.all(story.pages.map((page) => loadImage(page.image)));
const textures = pageImages.map((image, index) => createComicPageTexture(image, story.pages[index]));
for (const texture of textures) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
}

const pageGeometry = new THREE.PlaneGeometry(pageW, pageH, 1, 1);
const stillPages = textures.map((texture) => {
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.82,
    metalness: 0.0,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(pageGeometry, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.z = pageZ;
  bookGroup.add(mesh);
  return mesh;
});

const flipPivot = new THREE.Group();
bookGroup.add(flipPivot);
const flipMesh = new THREE.Mesh(
  pageGeometry,
  new THREE.MeshStandardMaterial({ roughness: 0.78, side: THREE.DoubleSide })
);
flipMesh.position.x = pageW / 2;
flipMesh.castShadow = true;
flipMesh.receiveShadow = true;
flipPivot.add(flipMesh);

const cover = new THREE.Mesh(
  new THREE.BoxGeometry(pageW + 0.7, pageH + 0.7, 0.18),
  new THREE.MeshStandardMaterial({ color: 0x17131d, roughness: 0.65, metalness: 0.05 })
);
cover.position.z = -0.18;
cover.receiveShadow = true;
bookGroup.add(cover);

const paperEdge = new THREE.Mesh(
  new THREE.BoxGeometry(pageW + 0.18, pageH + 0.18, 0.08),
  new THREE.MeshStandardMaterial({ color: 0xe7dfd2, roughness: 0.9 })
);
paperEdge.position.z = -0.04;
bookGroup.add(paperEdge);

const table = new THREE.Mesh(
  new THREE.PlaneGeometry(42, 24),
  new THREE.MeshStandardMaterial({ color: 0x161820, roughness: 0.95, metalness: 0.0 })
);
table.position.z = -0.45;
table.receiveShadow = true;
scene.add(table);

const vignetteCanvas = document.createElement('canvas');
vignetteCanvas.width = 1920;
vignetteCanvas.height = 1080;
const vg = vignetteCanvas.getContext('2d');
const gradient = vg.createRadialGradient(960, 480, 220, 960, 540, 980);
gradient.addColorStop(0, 'rgba(255,255,255,0)');
gradient.addColorStop(0.62, 'rgba(0,0,0,0.02)');
gradient.addColorStop(1, 'rgba(0,0,0,0.42)');
vg.fillStyle = gradient;
vg.fillRect(0, 0, 1920, 1080);
const vignette = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 11.25),
  new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(vignetteCanvas),
    transparent: true,
    depthTest: false
  })
);
vignette.position.set(0, 0, 7.5);
camera.add(vignette);
scene.add(camera);

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function easeInOut(t) {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
}

function pageAt(t) {
  return story.pages.findIndex((page) => t >= page.start && t < page.end);
}

function applyFocus(page, t) {
  const local = clamp01((t - page.start) / (page.end - page.start));
  const p = easeInOut(local);
  const f = page.focus;
  const scale = THREE.MathUtils.lerp(f.scale0, f.scale1, p);
  bookGroup.scale.set(scale, scale, scale);
  bookGroup.position.x = THREE.MathUtils.lerp(f.x0, f.x1, p) * pageW;
  bookGroup.position.y = THREE.MathUtils.lerp(f.y0, f.y1, p) * pageH;
  bookGroup.rotation.z = THREE.MathUtils.lerp(-0.012, 0.012, Math.sin(local * Math.PI));
}

function updatePageVisibility(index) {
  stillPages.forEach((mesh, i) => {
    mesh.visible = i === index;
    mesh.position.z = pageZ;
  });
}

function updateFlip(t, index) {
  const page = story.pages[index];
  const nextPage = story.pages[index + 1];
  const flipStart = page.end - story.transitionDuration;
  const inFlip = nextPage && t >= flipStart && t < page.end;
  flipMesh.visible = false;

  if (!inFlip) return;

  const progress = easeInOut((t - flipStart) / story.transitionDuration);
  stillPages[index].visible = false;
  stillPages[index + 1].visible = true;
  stillPages[index + 1].position.z = pageZ - 0.025;

  flipMesh.material.map = textures[index];
  flipMesh.material.needsUpdate = true;
  flipMesh.visible = true;
  flipPivot.position.set(-pageW / 2, 0, pageZ + 0.04);
  flipPivot.rotation.y = -Math.PI * progress;
  flipPivot.rotation.z = -0.02 * Math.sin(progress * Math.PI);
  flipMesh.position.z = 0.03 * Math.sin(progress * Math.PI);
}

window.renderFrame = (t) => {
  const index = Math.max(0, pageAt(t));
  const page = story.pages[index] || story.pages.at(-1);

  updatePageVisibility(index);
  applyFocus(page, t);
  updateFlip(t, index);

  rim.intensity = 38 + Math.sin(t * 0.9) * 7;
  renderer.render(scene, camera);
};

window.story = story;
window.ready = true;
