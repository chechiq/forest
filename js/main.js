import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { quadVert, quadFrag, flowFrag, ptsVert, ptsFrag } from './shaders.js';
import { initKinetic } from './kinetic.js';

gsap.registerPlugin(ScrollTrigger);
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

// ---------- цепочка кадров: каждый следующий лежит внутри предыдущего ----------
// fx — сила макро-эффектов. последний кадр (final) свой для телефона и компьютера
const CHAIN = [
  { file: 'L0', fx: 0.0, hero: true, cut: true },   // анфас: капсула отдельным слоем поверх студии
  { file: 'L1', fx: 0.05 },  // крона под стеклом
  { file: 'L2', fx: 0.2, fg: ['F2a'] },   // крона во весь кадр
  { file: 'L3', fx: 0.45, fg: ['F3a'] },  // шишки
  { file: 'L4', fx: 0.75, fg: ['F4a'] },  // поверхность
  { file: 'L5', fx: 1.0, fg: ['F5a'] },   // капли
  { file: 'final', fx: 0.6 },
];
// где кадр k+1 лежит внутри кадра k: центр x, y и размер w, h (в долях кадра k).
// первые три стыка найдены автовыравниванием (tools/chain/align.py), дальше центр и ×2
const RECTS = [
  [0.4990, 0.4007, 0.6979, 0.3097],
  [0.4938, 0.5328, 0.5208, 0.5219],
  [0.4969, 0.5844, 0.4437, 0.4437],
  [0.5, 0.5, 0.5, 0.5],
  [0.5, 0.5, 0.5, 0.5],
  [0.5, 0.5, 0.7, 0.7],
];
const N = CHAIN.length;
const G0 = CHAIN.findIndex((f) => f.file === 'L0'); // анфас капсулы: дальше начинается зум
const CUT_RECT = [0.4958, 0.5049, 0.9875, 0.9875];   // где вырезанная капсула лежит в кадре анфаса (tools/chain/align.py)

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch = matchMedia('(hover: none)').matches;
const isPortrait = () => innerWidth / innerHeight < 0.85;

const O_SCAN = 1.08; // запас кадра под параллакс
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// ---------- рендерер ----------
const canvas = document.getElementById('gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
} catch (e) {
  document.documentElement.classList.add('no-gl');
}

// бюджет пикселей: на огромных экранах не рендерим больше ~3 Мп
const PIXEL_BUDGET = 3.2e6;
const dprFor = (w, h) => Math.max(0.75, Math.min(devicePixelRatio, 1.5, Math.sqrt(PIXEL_BUDGET / (w * h))));
let dprScale = 1;
let dpr = dprFor(innerWidth, innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const quadMat = new THREE.ShaderMaterial({
  vertexShader: quadVert,
  fragmentShader: quadFrag,
  depthTest: false, depthWrite: false,
  uniforms: {
    tA: { value: null }, dA: { value: null }, tB: { value: null }, dB: { value: null },
    tFlow: { value: null },
    uAspA: { value: 1.5 }, uAspB: { value: 1.5 },
    uRes: { value: new THREE.Vector2(innerWidth, innerHeight) },
    uCen: { value: new THREE.Vector2(0.5, 0.5) }, uHv: { value: 1 },
    uRect: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) }, uMixB: { value: 0 }, uLodB: { value: 0 }, uEnd: { value: 0 }, uDefA: { value: 0 }, uDefB: { value: 0 },
    uTime: { value: 0 }, uBlur: { value: 0 }, uGlass: { value: 0 }, uFade: { value: 0 },
    uMotion: { value: reduced ? 0.25 : 1 },
    uMouse: { value: new THREE.Vector2(0.5, 0.5) }, uPar: { value: new THREE.Vector2() },
    uIdle: { value: new THREE.Vector2() },
    tStudio: { value: null }, tCut: { value: null }, tFgA: { value: null }, tFgB: { value: null }, dFgA: { value: null }, dFgB: { value: null },
    uBgB: { value: 0 }, uCutA: { value: 0 }, uCutB: { value: 0 },
    uCutRect: { value: new THREE.Vector4(...CUT_RECT) },
    uFgA: { value: new THREE.Vector4(0, 0, 1, 1) }, uFgB: { value: new THREE.Vector4(0, 0, 1, 1) }, uFgL: { value: new THREE.Vector4(3, 1, 3, 1) },
    uLoA: { value: 0 }, uLoB: { value: 0 }, uLoFA: { value: 0 }, uLoFB: { value: 0 },
    uFxA: { value: 0 }, uFxB: { value: 0 }, uSheenA: { value: 1 }, uBgA: { value: 1 },
  },
});
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat);
quad.frustumCulled = false;
scene.add(quad);

// след мыши: две маленькие текстуры по очереди (ping-pong)
const FLOW = 128;
const rtOpts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
const flowRT = [new THREE.WebGLRenderTarget(FLOW, FLOW, rtOpts), new THREE.WebGLRenderTarget(FLOW, FLOW, rtOpts)];
const flowMat = new THREE.ShaderMaterial({
  vertexShader: quadVert, fragmentShader: flowFrag, depthTest: false, depthWrite: false,
  uniforms: {
    tMap: { value: flowRT[0].texture }, uFalloff: { value: 0.2 }, uDissipation: { value: 0.95 },
    uAspect: { value: 1 }, uMouse: { value: new THREE.Vector2(-1, -1) }, uVelocity: { value: new THREE.Vector2() },
  },
});
const flowScene = new THREE.Scene();
const flowQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), flowMat);
flowQuad.frustumCulled = false;
flowScene.add(flowQuad);
let flowIdx = 0;
const flowVel = new THREE.Vector2();
function updateFlow() {
  const read = flowRT[flowIdx], write = flowRT[1 - flowIdx];
  flowMat.uniforms.tMap.value = read.texture;
  renderer.setRenderTarget(write);
  renderer.render(flowScene, camera);
  renderer.setRenderTarget(null);
  flowIdx = 1 - flowIdx;
  quadMat.uniforms.tFlow.value = write.texture;
}

// частицы
const COUNT = touch ? 300 : 600;
const seeds = new Float32Array(COUNT * 4);
for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
const ptsGeo = new THREE.BufferGeometry();
ptsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
ptsGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
const trail = Array.from({ length: 8 }, () => new THREE.Vector2(9, 9));
const ptsMat = new THREE.ShaderMaterial({
  vertexShader: ptsVert,
  fragmentShader: ptsFrag,
  transparent: true, depthTest: false, depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 }, uTravel: { value: 0 }, uAspect: { value: 1 }, uDpr: { value: dpr },
    uStage: { value: 0 }, uBright: { value: 0 }, uShock: { value: 1 },
    uShockPos: { value: new THREE.Vector2(9, 9) },
    uPar: { value: new THREE.Vector2() }, uMacro: { value: 0 }, uFinal: { value: 0 },
    uTrail: { value: trail }, uTrailS: { value: new Array(8).fill(0) },
  },
});
const points = new THREE.Points(ptsGeo, ptsMat);
points.frustumCulled = false;
points.renderOrder = 1;
scene.add(points);

// ---------- загрузка ----------
const EMPTY = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1); EMPTY.needsUpdate = true;
// декод картинок вне главного потока (ImageBitmap); flipY = false совпадает с ориентацией битмапа.
// на телефонах ужимаем до 2048 по большей стороне: экран всё равно меньше, а 10 текстур 3072² съедают ~350 МБ видеопамяти
const MAX_TEX = touch ? 2048 : 0;
const canBitmap = typeof createImageBitmap === 'function';
const texLoader = new THREE.TextureLoader();
function setupTex(t) {
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  if (renderer) t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  t.needsUpdate = true;
  return t;
}
async function loadBitmap(url) {
  const blob = await (await fetch(url)).blob();
  const opts = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  let bmp = await createImageBitmap(blob, opts);
  const big = Math.max(bmp.width, bmp.height);
  if (MAX_TEX && big > MAX_TEX) {
    const k = MAX_TEX / big, w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    bmp.close();
    bmp = await createImageBitmap(blob, { ...opts, resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  }
  const t = setupTex(new THREE.Texture(bmp));
  t.userData.lo = Math.log2(big / Math.max(bmp.width, bmp.height));   // насколько ужали: шейдер сдвигает мипы, размытие то же
  return t;
}
function loadTex(url) {
  if (canBitmap) return loadBitmap(url).catch(() => loadImg(url));
  return loadImg(url);
}
function loadImg(url) {
  return new Promise((res, rej) => texLoader.load(url, (t) => res(setupTex(t)), undefined, rej));
}

// грузим всё под лоадером: заливка большой текстуры в видеокарту посреди скролла даёт фриз (на телефоне до 0.4 с),
// поэтому никакой догрузки на ходу. декод идёт вне главного потока, капсула и первые кадры — в начале очереди
let chain = null;
let loaded = 0;
const elPct = document.querySelector('.loader__pct');
const TOTAL = N * 2 + 2 + CHAIN.reduce((n, f) => n + (f.fg ? 2 : 0), 0);
const tick1 = () => { loaded++; elPct.textContent = Math.min(100, Math.round((loaded / TOTAL) * 100)); };
const counted = (p) => p.then((x) => (tick1(), x));

function pathsFor(f) {
  if (f.file === 'final') {
    const n = isPortrait() ? '06-final-m' : '06-final';
    return [`assets/keyframes/${n}.webp`, `assets/depth/${n}.depth.webp`];
  }
  return [`assets/chain/${f.file}.webp`, `assets/chain/depth/${f.file}.depth.webp`];
}
async function loadFrame(f) {
  const [a, b] = pathsFor(f);
  const [tex, dep, fgTex, fgDep] = await Promise.all([
    counted(loadTex(a)),
    counted(loadTex(b)),
    f.fg ? counted(loadTex('assets/chain/' + f.fg[0] + '.webp')) : null,
    f.fg ? counted(loadTex('assets/chain/depth/' + f.fg[0].slice(0, 2) + '.fgdepth.webp')) : null,
  ]);
  return { ...f, tex, dep, fgTex, fgDep, asp: tex.image.width / tex.image.height };
}

// ---------- плавный скролл ----------
const lenis = reduced ? null : new Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 0.9 });
if (lenis) lenis.on('scroll', ScrollTrigger.update);
if (/[?&]debug(&|=|$)/.test(location.search)) window.__lenis = lenis;   // ?debug — доступ из консоли и бенчмарка

const sections = [...document.querySelectorAll('.sec')];
// g — непрерывный номер кадра: k ровно в центре k-й секции (секции бывают разной высоты)
let centers = [];
const measure = () => { centers = sections.map((s) => s.offsetTop + s.offsetHeight / 2 - innerHeight / 2); };
function scrollToG(y) {
  if (!centers.length || !sections[0].offsetHeight || !Number.isFinite(y)) return S.g; // окно нулевой высоты
  if (y <= centers[0]) return 0;
  for (let i = 0; i < N - 1; i++) if (y < centers[i + 1]) return i + (y - centers[i]) / (centers[i + 1] - centers[i]);
  return N - 1;
}

// ---------- доводка скролла: в середине перехода остановиться нельзя ----------
const snap = { lastY: 0, lastMove: 0, restY: 0, held: false, busy: false };
const stopSnap = () => { snap.busy = false; snap.restY = scrollY; };
addEventListener('wheel', stopSnap, { passive: true });
addEventListener('touchstart', () => { snap.held = true; snap.busy = false; }, { passive: true });
addEventListener('touchend', () => { snap.held = false; }, { passive: true });
addEventListener('keydown', stopSnap);
function scrollForG(g) { const i = Math.min(Math.floor(g), N - 2); return centers[i] + (g - i) * (centers[i + 1] - centers[i]); }
const NOSNAP = /[?&]nosnap/.test(location.search);   // отладка: покадровые снимки без доводки
function checkSnap(time) {
  if (NOSNAP) return;
  const y = scrollY;
  if (Math.abs(y - snap.lastY) > 0.5) { snap.lastMove = time; snap.lastY = y; return; }
  if (snap.busy || snap.held || time - snap.lastMove < 0.18 || S.intro < 1) return;
  const g = S.g, t = g - Math.floor(g);
  // направление: куда ушёл скролл от места, где он последний раз стоял
  const dir = Math.sign(y - snap.restY) || 1;
  if (t < 0.12 || t > 0.88 || g >= N - 1) { snap.restY = y; return; }   // у заголовков скролл свободный
  const target = dir > 0 ? Math.ceil(g) : Math.floor(g);
  const ty = scrollForG(target);
  const dur = 0.7 + Math.abs(target - g) * 0.9;
  snap.busy = true;
  if (lenis) lenis.scrollTo(ty, { duration: dur, easing: (x) => 1 - Math.pow(1 - x, 3), onComplete: stopSnap });
  else { window.scrollTo({ top: ty, behavior: 'smooth' }); setTimeout(stopSnap, dur * 1000); }
}

// ---------- мышь ----------
const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, amt: 0, px: 0.5, py: 0.5 };
function onMove(x, y) { mouse.tx = x / innerWidth; mouse.ty = y / innerHeight; }
addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY), { passive: true });
addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t) onMove(t.clientX, t.clientY); }, { passive: true });
addEventListener('pointerdown', (e) => {
  onMove(e.clientX, e.clientY);
  ptsMat.uniforms.uShockPos.value.set(mouse.tx * 2 - 1, -(mouse.ty * 2 - 1));
  gsap.fromTo(ptsMat.uniforms.uShock, { value: 0 }, { value: 1, duration: 1.3, ease: 'power2.out' });
});

// ---------- состояние ----------
const S = { g: 0, gs: 0, gPrev: 0, vel: 0, travel: 0, intro: 0, exitK: 0 };
let frameTimes = [];

// какая высота кадра видна, если кадр закрывает экран целиком (с запасом под параллакс)
const coverH = (asp) => { const sa = innerWidth / innerHeight; return (sa > asp ? asp / sa : 1) / O_SCAN; };
// капсула на старте: целиком по высоте экрана, по бокам студия
const heroH = () => 1 / (isPortrait() ? 0.92 : 1.0);

function resize() {
  const w = innerWidth, h = innerHeight;
  dpr = dprFor(w, h) * dprScale;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  quadMat.uniforms.uRes.value.set(w, h);
  ptsMat.uniforms.uAspect.value = w / h;
  ptsMat.uniforms.uDpr.value = dpr;
  flowMat.uniforms.uAspect.value = w / h;
  measure();
}

function tick(time, dtMs) {
  const dt = Math.min(dtMs / 1000, 0.05);
  if (lenis) lenis.raf(time * 1000);
  if (!chain) return;

  // скролл → номер кадра
  S.g = scrollToG(scrollY);
  checkSnap(time);
  S.gs += (S.g - S.gs) * Math.min(1, dt * (lenis ? 9 : 7));
  const vel = (S.gs - S.gPrev) / Math.max(dt, 1e-3);
  S.gPrev = S.gs;
  S.vel += (vel - S.vel) * Math.min(1, dt * 6);

  const gs = S.gs;
  const i = Math.min(Math.floor(gs), N - 2);
  const t = gs - i;
  // камера не стоит: у заголовка чуть медленнее, между ними быстрее
  // при выходе из капсулы — без притормаживания у кадров: одна ровная линия через весь зум
  const p = mix(t, smooth(0.08, 1.0, t), 0.7 * (1 - S.exitK));
  const A = chain[i], B = chain[i + 1], R = RECTS[i];
  const u = quadMat.uniforms;

  if (u.tA.value !== A.tex) {
    u.tA.value = A.tex; u.dA.value = A.dep; u.uAspA.value = A.asp; u.uFxA.value = A.fx;
    u.uBgA.value = A.hero ? 1 : 0; u.uCutA.value = A.cut ? 1 : 0; u.tFgA.value = A.fgTex || EMPTY; u.dFgA.value = A.fgDep || EMPTY;
    u.uLoA.value = A.tex.userData.lo || 0; u.uLoFA.value = (A.fgTex && A.fgTex.userData.lo) || 0;
  }
  if (u.tB.value !== B.tex) {
    u.tB.value = B.tex; u.dB.value = B.dep; u.uAspB.value = B.asp; u.uFxB.value = B.fx;
    u.uBgB.value = B.hero ? 1 : 0; u.uCutB.value = B.cut ? 1 : 0; u.tFgB.value = B.fgTex || EMPTY; u.dFgB.value = B.fgDep || EMPTY;
    u.uLoB.value = B.tex.userData.lo || 0; u.uLoFB.value = (B.fgTex && B.fgTex.userData.lo) || 0;
  }

  // зум в точку: видимая высота меняется по экспоненте, центр едет так, чтобы цель стояла на месте
  const introZ = 1 + (1 - S.intro) * 0.18;
  const hv0 = (A.hero ? heroH() : coverH(A.asp)) / (i === 0 ? introZ : 1);
  const hv1 = R[3] * coverH(B.asp);
  const hv = Math.exp(mix(Math.log(hv0), Math.log(hv1), p));
  const f = (hv0 - hv) / (hv0 - hv1);
  u.uHv.value = hv;
  u.uCen.value.set(mix(0.5, R[0], f), mix(0.5, R[1], f));
  u.uRect.value.set(R[0], R[1], R[2], R[3]);
  u.uLodB.value = Math.log2(B.tex.image.width / (A.tex.image.width * R[2]));
  // расфокус: старый кадр уходит в мягкость, смена на пике размытия, новый выходит в резкость
  // стык без мыла: вложенный кадр наплывает долго и мягко (с широким краем и подгонкой цвета в шейдере),
  // расфокуса почти нет — лишь чуть смягчить разницу в резкости. последний стык (капля → финал) — другой кадр, ему чуть больше
  const soft = (i === N - 2 ? 0.45 : 0.16) * (reduced ? 0.5 : 1);
  u.uDefA.value = smooth(0.35, 0.65, p) * soft;
  u.uMixB.value = smooth(0.18, 0.68, p);   // L1 перегенерирован точным продолжением L0 — длинный наплыв на всех стыках
  u.uDefB.value = (1 - smooth(0.5, 0.85, p)) * soft;
  u.uEnd.value = smooth(0.7, 0.95, p);
  // передний план: у кадра A пролетает мимо камеры и гаснет, у B выезжает из глубины
  // два слоя на кадр летят сквозь камеру непрерывно: в конце перехода слои B стоят ровно там,
  // где стояли слои A в начале -> на стыке ничего не выскакивает
  // уходящий слой быстро пролетает мимо объектива и растворяется в сильном размытии, приходящий выплывает мягким
  const zA = 1 + 0.5 * smooth(0, 0.22, p), zB = mix(0.92, 1, smooth(0.86, 1, p));         // масштаб = близость к камере
  const fA = A.fg ? 1 : 0, fB = B.fg ? 1 : 0;
  // на переходе переднего плана нет: старый тает в начале, новый проявляется, когда кадр уже в фокусе
  u.uFgA.value.set(fA * (1 - smooth(0.0, 0.22, p)), fA * (1 - smooth(0.5, 0.95, p)), zA, zA);
  u.uFgB.value.set(fB * smooth(0.86, 1.0, p), fB * smooth(0.15, 0.8, p), zB, zB);
  // ближний слой мягкий, средний почти резкий; чем ближе к камере, тем мягче
  u.uFgL.value.set(0.3 + 5.0 * smooth(0, 0.22, p), 1.0 + 1.8 * p, 0.3 + 4.5 * (1 - smooth(0.86, 1.0, p)), 0.4 + 0.6 * p);

  u.uIdle.value.set(Math.sin(time * 0.21) * 0.45, Math.cos(time * 0.17) * 0.3);
  u.uSheenA.value = A.cut ? 1 - p : 0;
  u.uGlass.value = A.file === 'L1' ? Math.sin(Math.PI * p) * 0.8 : 0;   // стенки капсулы уходят за край
  u.uBlur.value = Math.sin(Math.PI * p) * clamp(Math.abs(S.vel) * 0.5, 0, 1) * (reduced ? 0.1 : 0.2);   // смаз движения — только на быстром скролле и слегка
  u.uTime.value = time;
  u.uFade.value = S.intro;

  // мышь
  const k = Math.min(1, dt * 6);
  mouse.x += (mouse.tx - mouse.x) * k;
  mouse.y += (mouse.ty - mouse.y) * k;
  const sp = Math.hypot(mouse.x - mouse.px, mouse.y - mouse.py) / Math.max(dt, 1e-3);
  mouse.px = mouse.x; mouse.py = mouse.y;
  mouse.amt += (clamp(sp * 0.6, 0, 1) - mouse.amt) * Math.min(1, dt * (sp * 0.6 > mouse.amt ? 10 : 2.5));
  u.uMouse.value.set(mouse.x, mouse.y);
  u.uPar.value.set((mouse.x - 0.5) * 2, (mouse.y - 0.5) * 2);

  // след мыши: скорость курсора в координатах экрана (y вверх)
  const fx = mouse.tx, fy = 1 - mouse.ty;
  const fm = flowMat.uniforms;
  if (fm.uMouse.value.x >= 0) {
    const vx = (fx - fm.uMouse.value.x) / Math.max(dt, 1e-3) * 0.25;
    const vy = (fy - fm.uMouse.value.y) / Math.max(dt, 1e-3) * 0.25;
    flowVel.x += (vx - flowVel.x) * 0.5;
    flowVel.y += (vy - flowVel.y) * 0.5;
    if (flowVel.length() > 1) flowVel.setLength(1);
  }
  fm.uMouse.value.set(fx, fy);
  fm.uVelocity.value.copy(flowVel).multiplyScalar(reduced ? 0.3 : 1);
  flowVel.multiplyScalar(0.9);
  updateFlow();

  // частицы
  for (let j = 7; j > 0; j--) trail[j].copy(trail[j - 1]);
  trail[0].set(mouse.x * 2 - 1, -(mouse.y * 2 - 1));
  const ts = ptsMat.uniforms.uTrailS.value;
  for (let j = 0; j < 8; j++) ts[j] = (0.12 + mouse.amt * 0.9) * Math.pow(1 - j / 8, 1.5);
  // на рывке скролла частицы не проматывают цикл целиком (иначе мигают)
  S.travel += clamp((S.gs - (S.travelG ?? S.gs)) * 0.22, -0.012, 0.012) + dt * (0.006 + 0.01 * smooth(G0 + 3.5, G0 + 4.6, S.gs));
  S.travelG = S.gs;
  const pu = ptsMat.uniforms;
  pu.uTravel.value = S.travel;
  pu.uTime.value = time;
  pu.uStage.value = smooth(G0 + 1.5, G0 + 3.0, gs);
  pu.uPar.value.set(u.uPar.value.x + u.uIdle.value.x, u.uPar.value.y + u.uIdle.value.y);
  pu.uMacro.value = smooth(G0 + 3.5, G0 + 4.6, gs);
  pu.uFinal.value = smooth(G0 + 5.3, G0 + 5.95, gs);
  pu.uBright.value = (0.25 + 0.75 * smooth(G0 + 1.5, G0 + 3.5, gs)) * S.intro;

  renderer.render(scene, camera);

  // качество на лету: тормозит секунду подряд -> чуть меньше пикселей, летает -> возвращаем
  if (S.intro >= 1 && !document.hidden) {
    frameTimes.push(dtMs);
    if (frameTimes.length >= 60) {
      const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      frameTimes = [];
      if (avg > 20 && dprScale > 0.8) { dprScale = Math.max(0.8, dprScale - 0.1); resize(); }
      else if (avg < 14 && dprScale < 1) { dprScale = Math.min(1, dprScale + 0.1); resize(); }
    }
  }
}

// ---------- выход из капсулы: камеру плавно высасывает назад через весь зум за ~2.8 с ----------
let exiting = false;
function exitCapsule() {
  if (exiting || !chain) return;
  exiting = true;
  snap.busy = true;                                    // доводка не вмешивается
  if (lenis) lenis.stop();                             // ввод на время выхода не принимаем
  document.documentElement.classList.add('exiting');   // тексты гаснут
  gsap.to(S, { exitK: 1, duration: 0.25, ease: 'power1.out', overwrite: true });
  // камера едет с постоянной скоростью по зуму (по логарифму масштаба), а не по скроллу:
  // у стыков разная глубина вложения, и при ровном скролле она бы рывками ускорялась и тормозила
  const L = RECTS.slice(0, N - 1).map((R, i) => {
    const A = chain[i], B = chain[i + 1];
    const hv0 = A.hero ? heroH() : coverH(A.asp), hv1 = R[3] * coverH(B.asp);
    return Math.max(0.15, Math.abs(Math.log(hv0 / hv1)));
  });
  const cum = [0]; L.forEach((l, i) => cum.push(cum[i] + l));
  const gFromU = (u) => { let i = 0; while (i < L.length - 1 && u > cum[i + 1]) i++; return i + clamp((u - cum[i]) / L[i], 0, 1); };
  const g0 = Math.min(S.g, N - 1), i0 = Math.min(Math.floor(g0), N - 2);
  const st = { u: cum[i0] + (g0 - i0) * L[i0] };
  const toY = () => { const y = st.u <= 0 ? 0 : scrollForG(gFromU(st.u)); if (lenis) lenis.scrollTo(y, { immediate: true, force: true }); else window.scrollTo(0, y); };
  gsap.to(st, {
    u: 0, duration: 2.8, ease: 'power2.inOut', onUpdate: toY,
    onComplete: () => {
      toY(); stopSnap();
      if (lenis) lenis.start();
      gsap.to(S, { exitK: 0, duration: 0.8, ease: 'power1.inOut', overwrite: true });
      // тексты возвращаем, когда скраб-таймлайны доехали (сглаживание 0.6 с), иначе мелькнут осколки forest
      setTimeout(() => { document.documentElement.classList.remove('exiting'); exiting = false; }, 750);
    },
  });
}

// ---------- старт ----------
async function start() {
  if (lenis) lenis.stop();
  resize();
  // типографика (вместе с заголовком forest) живёт в kinetic.js
  const playIntro = initKinetic({ lenis, reduced, touch, onExit: exitCapsule });
  const [set, studio, cutTex] = await Promise.all([
    Promise.all(CHAIN.map(loadFrame)),
    loadTex('assets/chain/H2.webp').then((t) => (tick1(), t)),
    loadTex('assets/chain/H1.webp').then((t) => (tick1(), t)),
  ]);
  quadMat.uniforms.tStudio.value = studio;
  quadMat.uniforms.tCut.value = cutTex;
  chain = set;
  if (window.__lenis) { window.__S = S; window.__U = quadMat.uniforms; }   // ?debug: замеры камеры
  // всё заливаем в видеокарту заранее: иначе первая встреча с текстурой посреди скролла = подвисание
  [studio, cutTex, EMPTY, ...chain.flatMap((f) => [f.tex, f.dep, f.fgTex, f.fgDep])].forEach((t) => { if (t) renderer.initTexture(t); });

  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
  addEventListener('resize', resize);

  const tl = gsap.timeline();
  tl.to('.loader', { opacity: 0, duration: 0.8, ease: 'power2.inOut', delay: 0.2 })
    .set('.loader', { display: 'none' })
    .to(S, { intro: 1, duration: 2.4, ease: 'power3.out' }, '<')
    .add(playIntro, '<0.5')
    .add(() => { if (lenis) lenis.start(); ScrollTrigger.refresh(); }, '<0.6');

  S.g = S.gs = S.gPrev = scrollToG(scrollY);
}

if (renderer) start();
else document.querySelector('.loader').remove();
