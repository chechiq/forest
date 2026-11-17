// кинетическая типографика: свой сплиттер, физика по секциям, svg-фильтры, мышь, скорость скролла, угольки.
// состояние букв — простые объекты; таймлайны GSAP (скраб по скроллу) крутят их, один рендер в тикере пишет DOM.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const r2 = (n) => Math.round(n * 100) / 100;
const SR_ONLY = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';

// ---------- состояние буквы ----------
// s — то, что крутят скраб-таймлайны; l — живой слой (пружины, волны, удары), прибавляется сверху
const st0 = () => ({ x: 0, y: 0, z: 0, yp: 0, rx: 0, ry: 0, rz: 0, skx: 0, sx: 1, sy: 1, op: 1, w: 0,
  tx: 0, ty: 0, tr: 0, bx: 0, by: 0, br: 0, hop: 1, clip: 1 });
const lv0 = () => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, r: 0, skx: 0, sx: 1, sy: 1, w: 0, vx: 0, vy: 0, vr: 0, vk: 0 });

// полная рамка буквы (с запасом под выносные элементы) — к ней раскрывается ледяной осколок
const FULL = [[-30, -40], [50, -46], [130, -40], [140, 50], [130, 140], [50, 146], [-30, 140], [-40, 50]];

function makeChar(t) {
  const el = (cls, txt) => { const n = document.createElement('span'); n.className = cls; if (txt) n.textContent = txt; return n; };
  const cw = el('cw'), ch = el('char'), gb = el('gb', t), ht = el('hl ht', t), hb = el('hl hb', t);
  ch.append(gb, ht, hb); cw.append(ch);
  // осколок: точки вдоль случайной трещины через букву, при раскрытии выворачиваются в рваный многоугольник
  const a = rnd(0, Math.PI), cx = rnd(35, 65), cy = rnd(35, 65);
  const shard = FULL.map((_, k) => { const q = (k / FULL.length) * 2 - 1; return [cx + Math.cos(a) * q * 45 + rnd(-8, 8), cy + Math.sin(a) * q * 45 + rnd(-8, 8)]; });
  const s = st0();
  s.r = [Math.random(), Math.random(), Math.random(), Math.random()];
  return { cw, ch, gb, ht, hb, s, l: lv0(), r: s.r, shard, k: {}, m: { on: false }, mo: { mw: 0 }, bw: 0 };
}

// сплиттер: текст → .word → .cw → .char (.gb + .hl.ht + .hl.hb). .idx не трогаем, для читалок — скрытая копия
function split(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('.idx').forEach((n) => n.remove());
  const label = clone.textContent.replace(/\s+/g, ' ').trim();
  el.setAttribute('aria-label', label);
  const chars = [];
  [...el.childNodes].forEach((n) => {
    if (n.nodeType === 3) {
      const frag = document.createDocumentFragment();
      // делим только по обычным пробелам: неразрывный (&nbsp;) склеивает слова в одну строку («себя сам»)
      n.textContent.split(/([ \t\n\r]+)/).forEach((tok) => {
        if (!tok) return;
        if (/^[ \t\n\r]+$/.test(tok)) { frag.append(' '); return; }
        const w = document.createElement('span');
        w.className = 'word';
        w.setAttribute('aria-hidden', 'true');
        [...tok].forEach((t) => { const c = makeChar(t); c.i = chars.length; w.append(c.cw); chars.push(c); });
        frag.append(w);
      });
      n.replaceWith(frag);
    } else if (n.classList && n.classList.contains('idx')) n.setAttribute('aria-hidden', 'true');
  });
  const sr = document.createElement('span');
  sr.style.cssText = SR_ONLY;
  sr.textContent = label;
  el.prepend(sr);
  chars.forEach((c, i) => { c.u = chars.length > 1 ? i / (chars.length - 1) : 0.5; });
  return chars;
}

// ---------- рендер буквы: пишем в DOM только то, что изменилось ----------
function put(c, key, el, prop, val) { if (c.k[key] !== val) { c.k[key] = val; el.style[prop] = val; } }
function drawChar(c, opMul) {
  const s = c.s, l = c.l;
  const op = clamp(s.op * opMul, 0, 1);
  put(c, 'v', c.ch, 'visibility', op < 0.003 ? 'hidden' : '');
  if (op < 0.003) return;
  put(c, 'o', c.ch, 'opacity', op > 0.997 ? '' : String(r2(op)));
  put(c, 't', c.ch, 'transform',
    `perspective(800px) translate3d(${r2(s.x + l.x)}px,calc(${r2(s.yp)}% + ${r2(s.y + l.y)}px),${r2(s.z + l.z)}px) ` +
    `rotateX(${r2(s.rx + l.rx)}deg) rotateY(${r2(s.ry + l.ry)}deg) rotate(${r2(s.rz + l.r)}deg) ` +
    `skewX(${r2(s.skx + l.skx)}deg) scale(${r2(s.sx * l.sx)},${r2(s.sy * l.sy)})`);
  put(c, 'ht', c.ht, 'transform', s.tx || s.ty || s.tr ? `translate(${r2(s.tx)}px,${r2(s.ty)}px) rotate(${r2(s.tr)}deg)` : '');
  put(c, 'hb', c.hb, 'transform', s.bx || s.by || s.br ? `translate(${r2(s.bx)}px,${r2(s.by)}px) rotate(${r2(s.br)}deg)` : '');
  const hop = s.hop < 0.997 ? String(r2(Math.max(0, s.hop))) : '';
  put(c, 'hot', c.ht, 'opacity', hop); put(c, 'hob', c.hb, 'opacity', hop);
  // объём (тени основы) не умеет рваться вместе с половинками — гасим его, пока буква разъезжается
  const sep = Math.abs(s.tx) + Math.abs(s.ty) + Math.abs(s.bx) + Math.abs(s.by);
  const gop = sep > 0.5 || s.hop < 0.997 ? String(r2(clamp(1 - sep / 40, 0, 1) * clamp(s.hop, 0, 1))) : '';
  put(c, 'gop', c.gb, 'opacity', gop);
  let clip = '';
  if (s.clip < 0.999) {
    const q = clamp(s.clip, 0, 1);
    clip = `polygon(${FULL.map((p, k) => `${r2(mix(c.shard[k][0], p[0], q))}% ${r2(mix(c.shard[k][1], p[1], q))}%`).join(',')})`;
  }
  put(c, 'cp', c.ch, 'clipPath', clip);
  // жирность: база блока → волна/таймлайн → курсор. каждая новая жирность — новый инстанс вариативного
  // шрифта (~10 мс раскладки, на телефоне ×4), поэтому квантуем и держим их число маленьким
  let W = l.w || s.w || c.bw;
  if (c.mo.mw > 0.001) W = Math.min(900, W + 40 * Math.min(1, c.mo.mw));   // курсор: мягкий вдох, а не скачок до 900
  W = c.bw + Math.round((W - c.bw) / 10) * 10;   // ступень 10 от базы; амплитуды маленькие, так что разных жирностей всё равно немного
  const wv = W === c.bw ? '' : String(W);
  if (c.k.w !== wv) { c.k.w = wv; if (wv) c.ch.style.setProperty('--w', wv); else c.ch.style.removeProperty('--w'); }
}

// ---------- фильтры: клон на секцию, атрибуты пишем с кэшем ----------
function cloneFilter(id, suf) {
  const base = document.getElementById(id);
  const el = base.cloneNode(true);
  el.id = `${id}-${suf}`;
  base.parentNode.append(el);
  const parts = {};
  el.querySelectorAll('[data-k]').forEach((n) => { parts[n.dataset.k] = n; });
  const cache = {};
  return {
    url: `url(#${el.id})`,
    set(k, attr, val) { const key = k + attr; val = String(val); if (cache[key] !== val) { cache[key] = val; parts[k].setAttribute(attr, val); } },
  };
}
function setFilter(el, val) { if (el._f !== val) { el._f = val; el.style.filter = val; } }

// ---------- угольки: лёгкий 2D-канвас, пул частиц ----------
class Embers {
  constructor(touch) {
    this.cv = document.createElement('canvas');
    this.cv.className = 'embers';
    this.cv.setAttribute('aria-hidden', 'true');
    document.body.append(this.cv);
    this.ctx = this.cv.getContext('2d');
    this.p = [];
    this.on = false;
    this.acc = 0;
    this.max = touch ? 150 : 340;
    // искра = готовый спрайт (ядро + ореол) в трёх накалах: один drawImage вместо двух arc+fill на частицу
    this.spr = [[255, 120, 60], [255, 175, 95], [255, 235, 170]].map(([r, g, b]) => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,240,1)');
      gr.addColorStop(0.12, `rgba(${r},${g},${b},0.95)`);
      gr.addColorStop(0.22, `rgba(${r},${g},${b},0.22)`);
      gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
      x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
      return c;
    });
    this.resize();
  }
  resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 1.5);
    this.cv.width = Math.round(innerWidth * this.dpr);
    this.cv.height = Math.round(innerHeight * this.dpr);
  }
  // вспышка: искры веером во все стороны из точки (клик / тап по финалу)
  burst(x, y, n) {
    for (let i = 0; i < n && this.p.length < this.max; i++) {
      const a = rnd(0, 6.283), v = rnd(60, 340), life = rnd(0.7, 1.9);
      this.p.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life, max: life, s: rnd(0.9, 2.8), ph: rnd(0, 6.28), f: rnd(2, 6) });
    }
  }
  emit(x, y, vx, vy, n = 1) {
    for (let i = 0; i < n && this.p.length < this.max; i++) {
      const life = rnd(1.1, 2.8);
      this.p.push({ x: x + rnd(-6, 6), y: y + rnd(-6, 6), vx: vx + rnd(-30, 30), vy: vy + rnd(-110, -30),
        life, max: life, s: rnd(0.8, 2.6), ph: rnd(0, 6.28), f: rnd(2, 6) });
    }
  }
  step(dt, t) {
    const { ctx, cv } = this;
    // пусто — чистим один раз и прячем слой, чтобы пустой полноэкранный канвас не композитился
    if (!this.p.length) { if (this.dirty) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); this.dirty = false; cv.classList.remove('on'); } return; }
    if (!this.dirty) { this.dirty = true; cv.classList.add('on'); }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalCompositeOperation = 'lighter';
    const P = this.p;
    for (let i = P.length - 1; i >= 0; i--) {
      const e = P[i];
      e.life -= dt;
      if (e.life <= 0) { P[i] = P[P.length - 1]; P.pop(); continue; }
      const k = e.life / e.max;
      e.vy -= 26 * dt;                                    // жар тянет вверх
      e.vx += Math.sin(t * 2.3 + e.ph) * 40 * dt;         // турбулентность
      e.vx *= 1 - 0.6 * dt; e.vy *= 1 - 0.35 * dt;
      e.x += e.vx * dt; e.y += e.vy * dt;
      ctx.globalAlpha = k * (0.65 + 0.35 * Math.sin(t * e.f * 3 + e.ph));
      const r = e.s * 4.5 * (0.75 + 0.25 * k);
      ctx.drawImage(this.spr[k > 0.66 ? 2 : k > 0.33 ? 1 : 0], e.x - r, e.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }
}

// ======================================================================
export function initKinetic({ lenis, reduced, touch, onExit }) {
  const sections = [...document.querySelectorAll('.sec')];
  const blocks = [];
  let vs = 0, lastY = scrollY;
  const mouse = { x: -9999, y: -9999, vx: 0, vy: 0, dirty: false, down: false, t: 0 };
  const embers = reduced ? null : new Embers(touch);

  const S = (arr) => arr.map((c) => c.s);
  const win = (isFinal) => ({ start: 'top 15%', end: isFinal ? 'bottom bottom' : 'bottom 85%' });
  const makeTL = (b, st) => {
    const tl = gsap.timeline({ scrollTrigger: { trigger: b.sec, ...st, scrub: 0.6, invalidateOnRefresh: true } });
    tl.to({}, { duration: 1 }, 0);                 // шкала = 1: позиции в долях прогресса секции
    b.tl = tl;
    return tl;
  };
  // выход: fromTo без немедленного рендера, чтобы не затирать вход
  const X = { immediateRender: false };

  // ---------- финал: клик / тап — вспышка искр, удержание — раздувание углей ----------
  const press = { on: false, x: 0, y: 0 };
  const finalOn = () => blocks[6] && blocks[6].active && (blocks[6].v.heat || 0) > 0.5;
  if (!reduced) {
    addEventListener('pointerdown', (e) => {
      if (!finalOn() || e.target.closest('.exit')) return;
      press.on = true; press.x = e.clientX; press.y = e.clientY;
      if (embers) embers.burst(e.clientX, e.clientY, touch ? 40 : 64);
      gsap.fromTo(blocks[6].v, { flare: 1 }, { flare: 0, duration: 0.9, ease: 'power2.out', overwrite: true });
    });
    addEventListener('pointermove', (e) => { if (press.on) { press.x = e.clientX; press.y = e.clientY; } }, { passive: true });
    const up = () => { press.on = false; };
    addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }

  // ---------- секции ----------
  const build = {
    // 00 сборка из осколков стекла → разрыв по горизонтали
    hero(b) {
      // появление: буквы по очереди поднимаются из-под базовой линии (h1 обрезан снизу clip-path),
      // чисто, без вращений и разлёта. наверху страницы их не видно — капсула чистая. всё по скроллу и обратимо
      const g = b.v; g.punch = 0;
      const tl = makeTL(b, { start: 0, end: () => innerHeight * 0.75 });
      const LOCK = 0.3, T0 = 0.42;   // LOCK·0.75 = 0.225 экрана: подъём кончается до того, как поедет камера (0.25)
      tl.fromTo(S(b.H), { yp: 135 }, { yp: 0, duration: 0.2, ease: 'power3.out', stagger: { amount: 0.1, from: 'start' } }, 0);
      tl.fromTo(S(b.M), { yp: 60, op: 0 }, { yp: 0, op: 1, duration: 0.12, ease: 'power2.out', stagger: { amount: 0.06 } }, LOCK - 0.12);
      // разрыв: верхние половины влево, нижние вправо — проход для камеры
      const tear = (arr, dist, at) => {
        tl.fromTo(S(arr), { tx: 0, ty: 0, tr: 0, bx: 0, by: 0, br: 0 }, {
          tx: (i, s) => -innerWidth * dist * mix(0.7, 1.1, s.r[0]), ty: (i, s) => mix(-50, 10, s.r[1]), tr: (i, s) => mix(-18, -3, s.r[2]),
          bx: (i, s) => innerWidth * dist * mix(0.7, 1.1, s.r[3]), by: (i, s) => mix(-10, 20, s.r[2]), br: (i, s) => mix(3, 18, s.r[1]),
          duration: 0.42, ease: 'power3.in', stagger: { amount: 0.06, from: 'center' }, ...X }, at);
        tl.fromTo(S(arr), { hop: 1 }, { hop: 0, duration: 0.14, ease: 'power1.in', stagger: { amount: 0.06, from: 'center' }, ...X }, at + 0.12);   // гаснут на лету, не висят крошками у края
      };
      tear(b.H, 1, T0);
      tear(b.M, 0.75, T0 - 0.04);
      // без стеклянного фильтра: радужный разнос каналов на forest читался как дешёвый глитч
    },

    // 01 живая линза: волна жирности + строка выгнута по стеклу
    glass(b) {
      b.ownW = true;
      const g = b.v; g.pulse = 0; g.arc = 0;
      const tl = makeTL(b, win());
      tl.fromTo(S(b.H), { op: 0, yp: -90, rx: 75 }, { op: 1, yp: 0, rx: 0, duration: 0.2, ease: 'expo.out', stagger: { each: 0.016 } }, 0.08);
      tl.fromTo(g, { pulse: 0 }, { pulse: 1, duration: 0.22, ease: 'power2.out' }, 0.1);
      tl.fromTo(S(b.M), { op: 0 }, { op: 1, duration: 0.16, stagger: { each: 0.004, from: 'center' } }, 0.14);
      tl.fromTo(g, { arc: 0 }, { arc: 1, duration: 0.24, ease: 'expo.out' }, 0.12);
      tl.fromTo(g, { arc: 1 }, { arc: 2.05, duration: 0.2, ease: 'power2.in', ...X }, 0.76);
      tl.fromTo(S(b.M), { op: 1 }, { op: 0, duration: 0.1, stagger: { amount: 0.06, from: 'edges' }, ...X }, 0.84);
      tl.fromTo(S(b.H), { op: 1, yp: 0, rx: 0 }, { op: 0, yp: 90, rx: -75, duration: 0.18, ease: 'power2.in', stagger: { amount: 0.06, from: 'end' }, ...X }, 0.76);
      tl.fromTo(g, { pulse: 1 }, { pulse: 0, duration: 0.2, ...X }, 0.76);
      b.live = (b, t, dt, p) => {
        // пульс организма: волна 300 → 800 бежит по слову
        b.H.forEach((c, i) => { c.l.w = mix(700, 488 + 125 * (0.5 + 0.5 * Math.sin(t * 3.4 - i * 0.9 + p * 16)), g.pulse); });
        // строка наклеена изнутри на круглое стекло: края ближе к камере и развёрнуты к центру
        b.M.forEach((c, i) => {
          const th = mix(-45, 45, c.u) * g.arc;
          c.l.ry = -th;
          c.l.z = 170 * (1 - Math.cos((th * Math.PI) / 180));
          c.l.w = mix(300, 300 + 95 * (0.5 + 0.5 * Math.sin(t * 2.6 - i * 0.32)), g.pulse);
        });
      };
      const F = cloneFilter('glass-refract', 'glass');
      b.fx = (b, t) => {
        const k = clamp(0.16 * g.pulse * (0.7 + 0.3 * Math.sin(t * 2.1)) + Math.abs(vs) * 0.012, 0, 0.9);
        const on = k > 0.015;
        setFilter(b.h, on ? F.url : ''); setFilter(b.m, on ? F.url : '');
        if (!on) return;
        F.set('disp', 'scale', r2(60 * k));
        F.set('offR', 'dx', r2(-10 * k)); F.set('offB', 'dx', r2(10 * k));
      };
    },

    // 02 турбулентный вихрь от скорости скролла, уход — ураганом вбок
    crown(b) {
      const g = b.v; g.wind = 1;
      const tl = makeTL(b, win());
      const blowIn = (arr, dist, at) => tl.fromTo(S(arr), {
        op: 0, x: (i, s) => -innerWidth * dist * mix(0.5, 1, s.r[0]), y: (i, s) => mix(-140, 140, s.r[1]),
        rz: (i, s) => mix(-80, 80, s.r[2]), skx: 40, sx: 2.5,
      }, { op: 1, x: 0, y: 0, rz: 0, skx: 0, sx: 1, duration: 0.22, ease: 'expo.out', stagger: { each: 0.02, from: 'end' } }, at);
      blowIn(b.H, 0.7, 0.06);
      blowIn(b.M, 0.5, 0.1);
      tl.fromTo(g, { wind: 1 }, { wind: 0, duration: 0.24, ease: 'power2.out' }, 0.06);
      tl.fromTo(S(b.all), { x: 0, y: 0, rz: 0, skx: 0, sx: 1 }, {
        x: (i, s) => innerWidth * mix(0.9, 1.5, s.r[3]), y: (i, s) => mix(-90, 90, s.r[0]), rz: (i, s) => mix(-30, 30, s.r[1]),
        skx: -35, sx: 2.5, duration: 0.18, ease: 'power3.in', stagger: { amount: 0.06, from: 'end' }, ...X }, 0.76);
      tl.fromTo(S(b.all), { op: 1 }, { op: 0, duration: 0.08, stagger: { amount: 0.06, from: 'end' }, ...X }, 0.86);
      tl.fromTo(g, { wind: 0 }, { wind: 1, duration: 0.2, ease: 'power2.in', ...X }, 0.76);
      const K = 150, D = 8.5;   // пружина: недодемпфирована → буквы возвращаются в строй с отскоком
      const spring = (o, k, vk, target, dt) => { o[vk] += ((target - o[k]) * K - o[vk] * D) * dt; o[k] += o[vk] * dt; };
      b.live = (b, t, dt, p) => {
        const V = clamp(vs / 26, -1.7, 1.7);
        const inK = clamp((p - 0.1) / 0.18, 0, 1) * (1 - clamp((p - 0.74) / 0.06, 0, 1));
        b.all.forEach((c, i) => {
          const A = V * inK * (c.isH ? 1 : 0.6), a = Math.abs(A), r = c.r;
          // ветер треплет строку, но буквы остаются на своих местах (раньше их разбрасывало по экрану)
          spring(c.l, 'x', 'vx', (r[0] - 0.5) * 2 * 13 * A + Math.sin(t * 7 + i) * 2 * a, dt);
          spring(c.l, 'y', 'vy', (r[1] - 0.5) * 2 * 8 * A, dt);
          spring(c.l, 'r', 'vr', (r[2] - 0.5) * 2 * 4 * A, dt);
          spring(c.l, 'skx', 'vk', 7 * A, dt);
        });
      };
      const F = cloneFilter('wind-blur', 'crown');
      b.fx = () => {
        const sd = clamp(g.wind * 13 + Math.min(Math.abs(vs) * 0.11, 3.5), 0, 17);
        const on = sd > 0.6;
        setFilter(b.h, on ? F.url : ''); setFilter(b.m, on ? F.url : '');
        if (on) F.set('blur', 'stdDeviation', `${r2(sd)} 0`);
      };
    },

    // 03 морозный раскол: кристаллизация шумом + ледяная огранка, уход — колотый лёд
    frost(b) {
      const g = b.v; g.frost = -0.9; g.ice = 0;
      const tl = makeTL(b, win());
      tl.fromTo(g, { frost: -0.9 }, { frost: 0.35, duration: 0.24, ease: 'steps(7)' }, 0.06);
      tl.fromTo(g, { ice: 0 }, { ice: 1.4, duration: 0.12, ease: 'steps(3)' }, 0.06);
      tl.fromTo(g, { ice: 1.4 }, { ice: 0.35, duration: 0.14, ease: 'power2.out', ...X }, 0.22);
      tl.fromTo(S(b.all), { clip: 0, op: 0 }, { clip: 1, op: 1, duration: 0.16, ease: 'steps(4)', stagger: { each: 0.012, from: 'random' } }, 0.06);
      // трещина: вспышка, половинки расходятся и осыпаются с гравитацией
      tl.fromTo(g, { ice: 0.35 }, { ice: 1.6, duration: 0.04, ease: 'steps(2)', ...X }, 0.74);
      tl.fromTo(g, { ice: 1.6 }, { ice: 0, duration: 0.2, ...X }, 0.78);
      tl.fromTo(S(b.all), { ty: 0, by: 0 }, { ty: -6, by: 7, duration: 0.04, ease: 'steps(2)', stagger: { amount: 0.06, from: 'random' }, ...X }, 0.74);
      tl.fromTo(S(b.all), { tx: 0, ty: -6, tr: 0 }, {
        tx: (i, s) => mix(-70, 70, s.r[0]), ty: (i, s) => innerHeight * mix(0.45, 0.8, s.r[1]), tr: (i, s) => mix(-60, 60, s.r[2]),
        duration: 0.14, ease: 'power2.in', stagger: { amount: 0.06, from: 'random' }, ...X }, 0.8);
      tl.fromTo(S(b.all), { bx: 0, by: 7, br: 0 }, {
        bx: (i, s) => mix(-90, 90, s.r[3]), by: (i, s) => innerHeight * mix(0.6, 1, s.r[0]), br: (i, s) => mix(-140, 140, s.r[1]),
        duration: 0.16, ease: 'power3.in', stagger: { amount: 0.06, from: 'random' }, ...X }, 0.78);
      tl.fromTo(S(b.all), { hop: 1 }, { hop: 0, duration: 0.08, stagger: { amount: 0.06, from: 'random' }, ...X }, 0.84);
      const F = cloneFilter('frost-shatter', 'frost');
      b.fx = (b, t, p) => {
        const iv = String(r2(g.ice * (0.85 + 0.15 * Math.sin(t * 9))));
        if (b.stick._ice !== iv) { b.stick._ice = iv; b.stick.style.setProperty('--ice', iv); }
        const on = p > 0.04 && p < 0.74;   // на осыпании фильтр не нужен — экономим кадр
        setFilter(b.h, on ? F.url : ''); setFilter(b.m, on ? F.url : '');
        if (!on) return;
        F.set('cut', 'k4', r2(g.frost + 0.03 * Math.sin(t * 5)));
        F.set('flood', 'flood-opacity', r2(clamp(0.35 + g.ice * 0.5, 0, 1)));
      };
    },

    // 04 вязкое плавление: буквы стекают сверху, блик катится, уход — капают за экран
    resin(b) {
      const g = b.v; g.melt = 1;
      const tl = makeTL(b, win());
      tl.fromTo(g, { melt: 1 }, { melt: 0.06, duration: 0.3, ease: 'power2.out' }, 0.06);
      tl.fromTo(S(b.H), { sy: 3.5, y: -70, op: 0 }, { sy: 1, y: 0, op: 1, duration: 0.26, ease: 'power3.out', stagger: { each: 0.025, from: 'random' } }, 0.06);
      tl.fromTo(S(b.M), { sy: 3, y: -30, op: 0 }, { sy: 1, y: 0, op: 1, duration: 0.22, ease: 'power3.out', stagger: { each: 0.008, from: 'random' } }, 0.12);
      tl.fromTo(g, { melt: 0.06 }, { melt: 1, duration: 0.24, ease: 'power2.in', ...X }, 0.76);
      tl.fromTo(S(b.all), { sy: 1, y: 0 }, { sy: 4, y: 200, duration: 0.18, ease: 'power2.in', stagger: { amount: 0.06, from: 'random' }, ...X }, 0.76);
      tl.fromTo(S(b.all), { op: 1 }, { op: 0, duration: 0.08, stagger: { amount: 0.06, from: 'random' }, ...X }, 0.86);
      const F = cloneFilter('liquid-resin', 'resin');
      b.fx = (b, t) => {
        setFilter(b.h, F.url); setFilter(b.m, F.url);
        F.set('disp', 'scale', r2(120 * g.melt + 6 + Math.min(Math.abs(vs) * 0.9, 40)));
        F.set('blur', 'stdDeviation', r2(0.6 + 5 * g.melt));
        F.set('turb', 'baseFrequency', `0.009 ${(0.05 + 0.012 * Math.sin(t * 0.8)).toFixed(4)}`);
      };
    },

    // 05 гидроудар: центральная буква падает, от центра к краям расходится 3D-волна
    drop(b) {
      const g = b.v; g.splash = 0; g.shake = 0; g.out = 0;
      const tl = makeTL(b, win());
      const ci = Math.floor(b.H.length / 2), C = b.H[ci];
      const others = b.H.filter((c) => c !== C);
      const IMPACT = 0.32;   // капля падает, когда камера уже прилетела
      tl.fromTo(C.s, { op: 0 }, { op: 1, duration: 0.03 }, 0.18);
      tl.fromTo(C.s, { y: -220, sy: 1.6, sx: 0.8 }, { y: 0, sy: 1, sx: 1, duration: IMPACT - 0.18, ease: 'power4.in' }, 0.18);
      tl.fromTo(S(others), { op: 0, sy: 0.4, y: 18 }, { op: 1, sy: 1, y: 0, duration: 0.1, ease: 'power3.out', stagger: { amount: 0.04, from: 'center' } }, IMPACT);
      tl.fromTo(S(b.M), { op: 0, sy: 0.5, y: 20 }, { op: 1, sy: 1, y: 0, duration: 0.12, ease: 'power3.out', stagger: { amount: 0.05, from: 'center' } }, IMPACT + 0.03);
      tl.fromTo(S(b.all), { yp: 0, sy: 1, sx: 1 }, { yp: 260, sy: 2.4, sx: 0.7, duration: 0.18, ease: 'power3.in', stagger: { amount: 0.06, from: 'edges' }, ...X }, 0.76);
      tl.fromTo(S(b.all), { op: 1 }, { op: 0, duration: 0.08, stagger: { amount: 0.06, from: 'edges' }, ...X }, 0.8);
      tl.fromTo(g, { out: 0 }, { out: 1, duration: 0.22, ease: 'power2.in', ...X }, 0.76);
      const shock = () => {
        gsap.fromTo(g, { splash: 1 }, { splash: 0, duration: 1.2, ease: 'power2.out', overwrite: true });
        gsap.fromTo(g, { shake: 1 }, { shake: 0, duration: 0.5, ease: 'power2.out', overwrite: false });
        gsap.timeline()
          .to(C.l, { sy: 0.55, sx: 1.35, duration: 0.07, ease: 'power2.out', overwrite: 'auto' })
          .to(C.l, { sy: 1, sx: 1, duration: 1, ease: 'elastic.out(1,0.3)' });
        b.all.forEach((c) => {
          if (c === C) return;
          const d = c.isH ? Math.abs(c.i - ci) / Math.max(1, ci) : 0.5 + Math.abs(c.u - 0.5);
          const amp = (c.isH ? 34 : 14) * (1 - 0.35 * Math.min(1, d));
          gsap.timeline({ delay: d * 0.3 })   // stagger от центра к краям, amount ≈ 0.3 с
            .to(c.l, { y: -amp, sy: 1.15, sx: 0.94, rx: -14, duration: 0.13, ease: 'power2.out', overwrite: 'auto' })
            .to(c.l, { y: 0, sy: 1, sx: 1, rx: 0, duration: 1.15, ease: 'elastic.out(1,0.3)' });
        });
      };
      b.onP = (p, lp) => { if (lp < IMPACT && p >= IMPACT) shock(); };
      const F = cloneFilter('liquid-resin', 'drop');
      b.fx = (b, t) => {
        const k = 38 * g.splash + 50 * g.out + Math.min(Math.abs(vs) * 0.4, 14);   // всплеск рябит, но слово читается
        const on = k > 1;
        setFilter(b.h, on ? F.url : ''); setFilter(b.m, on ? F.url : '');
        if (!on) return;
        F.set('disp', 'scale', r2(k));
        F.set('blur', 'stdDeviation', r2(0.6 + 1 * g.splash + 2.5 * g.out));
        F.set('turb', 'baseFrequency', `${(0.012 + 0.02 * g.splash).toFixed(4)} ${(0.03 + 0.03 * g.splash).toFixed(4)}`);
      };
    },

    // 06 тление: проявление из жара, буквы дышат, вокруг летят угольки
    final(b) {
      b.ownW = true;
      const g = b.v; g.heat = 0;
      const tl = makeTL(b, win(true));
      // камера встаёт на финальный кадр только к ~0.62 прогресса секции — разгораемся под её прилёт, а не на перелёте.
      // ровное разгорание по буквам, без случайного мерцания (оно читалось как глюк)
      tl.fromTo(g, { heat: 0 }, { heat: 1, duration: 0.24, ease: 'power2.out' }, 0.3);
      tl.fromTo(S(b.H), { op: 0, y: 40, sx: 0.92, sy: 0.92 }, { op: 1, y: 0, sx: 1, sy: 1, duration: 0.2, ease: 'power3.out', stagger: { each: 0.016, from: 'start' } }, 0.36);
      tl.fromTo(S(b.M), { op: 0, y: 16 }, { op: 1, y: 0, duration: 0.16, ease: 'power2.out', stagger: { each: 0.004, from: 'center' } }, 0.48);
      b.br = 0;
      b.live = (b, t, dt) => {
        // жар = разгорание + вспышка от клика + раздувание, пока держишь палец / кнопку мыши
        g.stoke = clamp((g.stoke || 0) + (press.on ? dt * 0.9 : -dt * 0.6), 0, 1);
        b.br = g.heat * (0.8 + 0.14 * Math.sin(t * 1.7) + 0.06 * Math.sin(t * 5.3)) + (g.flare || 0) * 0.45 + g.stoke * 0.35;
        b.H.forEach((c, i) => { c.l.w = mix(700, 715 + 28 * Math.sin(t * 1.6 + i * 0.7), g.heat); c.l.y = Math.sin(t * 2.2 + i * 1.3) * 0.8 * g.heat; });
      };
      b.fx = (b) => {
        const k = b.br;
        const hv = String(r2(k));   // --heat нужен только строке манифеста — не пересчитываем стиль всей секции
        if (b.m._heat !== hv) { b.m._heat = hv; b.m.style.setProperty('--heat', hv); }
        setFilter(b.h, k > 0.01
          ? `brightness(${r2(0.8 + 0.25 * k)}) drop-shadow(0 0 ${r2(3 + 9 * k)}px rgba(255,150,60,${r2(0.85 * k)})) drop-shadow(0 0 ${r2(16 + 36 * k)}px rgba(255,60,110,${r2(0.5 * k)}))`
          : '');
        // кнопка выхода проступает, когда forest разгорелся
        const bo = clamp((g.heat - 0.55) / 0.4, 0, 1);
        const bs = bo > 0.01 ? String(r2(bo)) : '0';
        if (btn._o !== bs) { btn._o = bs; btn.style.opacity = bs; btn.style.pointerEvents = bo > 0.5 ? 'auto' : 'none'; btn.tabIndex = bo > 0.5 ? 0 : -1; }
      };
      const btn = b.stick.querySelector('.exit');
      if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); if (onExit) onExit(); });
      b.embers = true;
    },
  };

  // reduced-motion: только прозрачность
  const buildReduced = (b, si, last) => {
    if (si === 0) { b.opMul = 0; return; }
    const tl = makeTL(b, win(si === last));
    tl.fromTo(S(b.all), { op: 0 }, { op: 1, duration: 0.2 }, 0.1);
    if (si !== last) tl.fromTo(S(b.all), { op: 1 }, { op: 0, duration: 0.2, ...X }, 0.7);
  };

  const KINDS = ['hero', 'glass', 'crown', 'frost', 'resin', 'drop', 'final'];
  sections.forEach((sec, si) => {
    const stick = sec.querySelector('.stick');
    const h = sec.querySelector('h1, h2'), m = sec.querySelector('.manifesto');
    const H = split(h), M = split(m);
    H.forEach((c) => { c.isH = true; });
    const bwH = parseFloat(getComputedStyle(h).getPropertyValue('--bw')) || 700, bwM = parseFloat(getComputedStyle(m).getPropertyValue('--bw')) || 300;
    H.forEach((c) => { c.bw = bwH; }); M.forEach((c) => { c.bw = bwM; });
    const b = { sec, stick, h, m, H, M, all: [...H, ...M], v: {}, opMul: 1, active: false, lastP: 0, kind: KINDS[si], idx: m.querySelector('.idx') };
    if (reduced) buildReduced(b, si, sections.length - 1);
    else (build[b.kind] || build.glass)(b);
    if (!b.tl) b.tl = gsap.timeline();
    b.lastP = b.tl.progress();
    // активна только секция в кадре: фильтры, живой слой и will-change — только у неё
    // герой включается по scrollY прямо в кадре (триггер с start: 0 не всегда шлёт onToggle)
    if (si > 0) ScrollTrigger.create({ trigger: sec, start: 'top 30%', end: si === sections.length - 1 ? 'bottom top' : 'bottom 70%', onToggle: (self) => setActive(b, self.isActive) });
    blocks.push(b);
    for (const c of b.all) drawChar(c, b.opMul);   // начальное состояние сразу, а не при первом показе
    setActive(b, si === 0);
  });

  function setActive(b, on) {
    b.active = on;
    // сначала буквы получают своё состояние, и только потом секция показывается: иначе на один кадр
    // всплывает голый текст на месте (целый «forest» поверх капли, одиночные буквы не там)
    if (on) for (const c of b.all) drawChar(c, b.opMul);
    b.stick.style.visibility = on ? '' : 'hidden';
    b.stick.classList.toggle('is-active', on);
    if (!on) { setFilter(b.h, ''); setFilter(b.m, ''); if (embers && b.embers) embers.on = false; }
    else if (embers && b.embers) embers.on = true;
  }

  // ширина строк и смещения букв — для блика смолы, бегущего через всю строку
  function measure() {
    blocks.forEach((b) => {
      [b.h, b.m].forEach((el) => { el.style.setProperty('--lw', `${Math.max(200, el.offsetWidth)}px`); });
      b.all.forEach((c) => {
        const el = c.isH ? b.h : b.m;
        c.ch.style.setProperty('--ox', `${c.cw.offsetLeft - el.offsetLeft}px`);
      });
    });
  }
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { measure(); ScrollTrigger.refresh(); layoutProgress(); });
  // на телефоне resize летит при каждом показе/скрытии адресной строки — пересчитываем раз в кадр, не чаще
  let rz = 0;
  addEventListener('resize', () => { if (!rz) rz = requestAnimationFrame(() => { rz = 0; measure(); layoutProgress(); if (embers) embers.resize(); }); });

  // ---------- шкала прохождения: раздел, засечки разделов, проценты ----------
  const prog = document.querySelector('.progress');
  const P = prog && {
    lbl: prog.querySelector('.progress__lbl'), fill: prog.querySelector('.progress__fill'),
    pct: prog.querySelector('.progress__pct'), bar: prog.querySelector('.progress__bar'),
    names: blocks.map((b) => (b.idx ? b.idx.textContent.trim() : '')), centers: [], ticks: [], k: {},
  };
  function layoutProgress() {
    if (!P) return;
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    P.max = max;
    P.centers = sections.map((sec, i) => (i === sections.length - 1 ? max : Math.max(0, sec.offsetTop + sec.offsetHeight / 2 - innerHeight / 2)));
    P.centers[0] = 0;
    if (!P.ticks.length) {
      P.ticks = P.centers.map((_, i) => {
        const t = document.createElement('button');
        t.type = 'button'; t.className = 'progress__tick';
        t.setAttribute('aria-label', P.names[i] || `раздел ${i + 1}`);
        t.addEventListener('click', () => { if (lenis) lenis.scrollTo(P.centers[i], { duration: 1.6 }); else scrollTo({ top: P.centers[i], behavior: 'smooth' }); });
        P.bar.append(t);
        return t;
      });
    }
    P.ticks.forEach((t, i) => { t.style.left = `${(P.centers[i] / max) * 100}%`; });
  }
  function drawProgress() {
    if (!P || !P.max) return;
    const y = clamp(scrollY / P.max, 0, 1);
    let cur = 0, best = Infinity;
    P.centers.forEach((c, i) => { const d = Math.abs(scrollY - c); if (d < best) { best = d; cur = i; } });
    const f = y.toFixed(4), pc = `${Math.round(y * 100)}%`;
    if (P.k.f !== f) { P.k.f = f; P.fill.style.transform = `scaleX(${f})`; }
    if (P.k.pc !== pc) { P.k.pc = pc; P.pct.textContent = pc; }
    if (P.k.cur !== cur) {
      P.k.cur = cur; P.lbl.textContent = P.names[cur];
      P.ticks.forEach((t, i) => t.classList.toggle('on', i === cur));
      prog.classList.toggle('warm', cur === blocks.length - 1);
    }
  }

  // ---------- мышь ----------
  if (!touch && !reduced) {
    addEventListener('pointermove', (e) => {
      const dt = Math.max(1, e.timeStamp - mouse.t) / 1000;
      if (mouse.x > -9000) { mouse.vx = (e.clientX - mouse.x) / dt; mouse.vy = (e.clientY - mouse.y) / dt; }
      mouse.x = e.clientX; mouse.y = e.clientY; mouse.t = e.timeStamp; mouse.dirty = true;
    }, { passive: true });
    addEventListener('pointerdown', () => { mouse.down = true; mouse.dirty = true; });
    addEventListener('pointerup', () => { mouse.down = false; mouse.dirty = true; });
    document.addEventListener('pointerleave', () => { mouse.x = mouse.y = -9999; mouse.dirty = true; });
  }
  const RADIUS = 140;
  function magnet() {
    // кнопка зажата — притяжение, иначе отталкивание
    const dir = mouse.down ? -0.7 : 1;
    for (const b of blocks) {
      if (!b.active) continue;
      // курсор далеко от строк блока — не трогаем буквы (и не читаем раскладку 40 раз)
      const near = [b.h, b.m].some((el) => {
        const r = el.getBoundingClientRect(), pad = RADIUS + 80;
        return mouse.x > r.left - pad && mouse.x < r.right + pad && mouse.y > r.top - pad && mouse.y < r.bottom + pad;
      });
      if (!near) { for (const c of b.all) if (c.m.on) release(c); continue; }
      // позиции букв читаем пачкой раз в ~120 мс (или при скролле), а не на каждое движение мыши
      const now = performance.now();
      if (!b.rT || now - b.rT > 120 || Math.abs(vs) > 0.3) {
        b.rT = now;
        for (const c of b.all) { const r = c.cw.getBoundingClientRect(); c.cx = r.left + r.width / 2 - (c.m.x || 0); c.cy = r.top + r.height / 2 - (c.m.y || 0); }
      }
      for (const c of b.all) {
        if (c.k.v === 'hidden') { if (c.m.on) release(c); continue; }
        const dx = c.cx - mouse.x, dy = c.cy - mouse.y, d = Math.hypot(dx, dy);
        if (d < RADIUS) {
          const f = Math.pow(1 - d / RADIUS, 1.3), nx = dx / (d || 1), ny = dy / (d || 1);
          c.m.x = nx * 7 * f * dir; c.m.y = ny * 7 * f * dir;
          gsap.to(c.cw, { x: c.m.x, y: c.m.y, rotation: nx * 1.5 * f * dir, duration: 0.6, ease: 'power3.out', overwrite: 'auto' });
          gsap.to(c.mo, { mw: f, duration: 0.5, ease: 'sine.out', overwrite: 'auto' });
          c.m.on = true;
        } else if (c.m.on) release(c);
      }
    }
  }
  function release(c) {
    c.m.on = false; c.m.x = 0; c.m.y = 0;
    gsap.to(c.cw, { x: 0, y: 0, rotation: 0, duration: 1.1, ease: 'elastic.out(0.5,0.6)', overwrite: 'auto' });
    gsap.to(c.mo, { mw: 0, duration: 0.9, ease: 'sine.inOut', overwrite: 'auto' });
  }

  // ---------- параллакс заголовков ----------
  // тот же сигнал, что у сцены (main.js): мышь −1..1 + медленный дрейф, чтобы на телефоне объём тоже жил
  const par = { x: 0, y: 0 };
  function parStep(time, dt) {
    const mx = mouse.x > -9000 ? (mouse.x / innerWidth - 0.5) * 2 : 0, my = mouse.x > -9000 ? (mouse.y / innerHeight - 0.5) * 2 : 0;
    const k = Math.min(1, dt * 6);
    par.x += (mx + Math.sin(time * 0.21) * 0.45 - par.x) * k;
    par.y += (my + Math.cos(time * 0.17) * 0.3 - par.y) * k;
  }
  function parallax(b) {
    // ближний план едет вслед за мышью сильнее манифеста; объём (задняя грань) — в обратную сторону
    const hx = String(r2(par.x * 11)) + 'px ' + String(r2(par.y * 6)) + 'px';
    const mxs = String(r2(par.x * 4.5)) + 'px ' + String(r2(par.y * 2.5)) + 'px';
    if (b.h._tr !== hx) { b.h._tr = hx; b.h.style.translate = hx; }
    if (b.m._tr !== mxs) { b.m._tr = mxs; b.m.style.translate = mxs; }
    const q = (v) => String(Math.round(v * 40) / 40);   // ступень 0.025: тени объёма перерисовываются не каждый кадр
    const ex = q(clamp(-par.x * 0.5, -0.7, 0.7));
    const ey = q(clamp(0.45 - par.y * 0.4 + clamp(vs * 0.006, -0.25, 0.25), -0.3, 1.0));
    if (b.h._ex !== ex) { b.h._ex = ex; b.h.style.setProperty('--ex', ex); }
    if (b.h._ey !== ey) { b.h._ey = ey; b.h.style.setProperty('--ey', ey); }
  }

  // ---------- кадр ----------
  let rectsAt = 0, emberRects = [];
  function frame(time, dtMs) {
    const dt = Math.min(dtMs / 1000, 0.05);
    const v = lenis ? lenis.velocity || 0 : scrollY - lastY;
    lastY = scrollY;
    vs += (v - vs) * Math.min(1, dt * 10);
    if (Math.abs(vs) < 0.01) vs = 0;

    const a0 = scrollY < innerHeight * 0.85;
    if (blocks[0].active !== a0) setActive(blocks[0], a0);

    if (mouse.dirty || (Math.abs(vs) > 0.3 && mouse.x > -9000)) { mouse.dirty = false; magnet(); }

    if (!reduced) parStep(time, dt);
    for (const b of blocks) {
      if (!b.active) continue;
      const p = b.tl.progress();
      if (b.onP) b.onP(p, b.lastP);
      b.lastP = p;
      if (b.live) b.live(b, time, dt, p);
      // дыхание: жирность заголовка медленно гуляет ±10 (у «под стеклом» и финала своя волна)
      // (у героя во время разрыва не дышим: смена жирности перерисовала бы летящие половинки)
      if (!reduced && !b.ownW && !(b.kind === 'hero' && p > 0.38)) b.H.forEach((c, i) => { c.l.w = c.bw + 10 * Math.sin(time * 1.25 + i * 0.75); });
      if (b.fx) b.fx(b, time, p);
      if (!reduced) parallax(b);
      for (const c of b.all) drawChar(c, b.opMul);
      // метка секции (00 // CAPSULE …) появляется и уходит вместе со строкой манифеста, а не висит одна
      if (b.idx) { const io = String(r2(clamp(b.M[0].s.op * b.opMul, 0, 1) * clamp(1 - b.M[0].s.yp / 120, 0, 1))); if (b.idx._o !== io) { b.idx._o = io; b.idx.style.opacity = io; } }
      // весь блок кренится и тянется от скорости скролла (+ щелчок / тряска секции)
      const g = b.v, sk = reduced ? 0 : clamp(-vs * 0.055, -5.5, 5.5), sy = reduced ? 1 : 1 + clamp(Math.abs(vs) * 0.00225, 0, 0.15);
      const pun = 1 + (g.punch || 0) * 0.025, sh = g.shake || 0;
      const T = sk || sy !== 1 || pun !== 1 || sh
        ? `translate(${r2(Math.sin(time * 83) * 3.5 * sh)}px,${r2(Math.cos(time * 71) * 2.5 * sh)}px) skewY(${r2(sk)}deg) scale(${r2(pun)},${r2(sy * pun)})`
        : '';
      if (b.stick._t !== T) { b.stick._t = T; b.stick.style.transform = T; }

      // угольки: от раскалённых букв, больше при скролле и движении мыши
      if (embers && b.embers && embers.on) {
        if (time - rectsAt > 0.25) { rectsAt = time; emberRects = b.all.filter((c) => c.k.v !== 'hidden').map((c) => c.cw.getBoundingClientRect()); }
        const heat = b.v.heat || 0;
        if (emberRects.length && heat > 0.05) {
          embers.acc += dt * heat * (16 + Math.min(Math.abs(vs) * 6, 160));
          while (embers.acc >= 1) {
            embers.acc -= 1;
            const r = emberRects[(Math.random() * emberRects.length) | 0];
            embers.emit(r.left + Math.random() * r.width, r.top + Math.random() * r.height, -vs * 2, -vs * 4);
          }
          if (press.on) embers.emit(press.x, press.y, rnd(-40, 40), rnd(-120, -40), 2);   // держишь — сыплются искры
          const ms = Math.hypot(mouse.vx, mouse.vy);
          if (ms > 300 && mouse.x > -9000) embers.emit(mouse.x, mouse.y, mouse.vx * 0.15, mouse.vy * 0.15, Math.min(4, (ms / 600) | 0) + 1);
        }
      }
    }
    mouse.vx *= 0.85; mouse.vy *= 0.85;
    drawProgress();
    if (embers) embers.step(dt, time);
  }
  gsap.ticker.add(frame);
  if (/[?&]debug(&|=|$)/.test(location.search)) window.__kin = blocks;

  // прогрев фильтров: Chrome компилирует шейдеры SVG/CSS-фильтров при первом показе (100–200 мс фриза на входе
  // в иней, смолу, финал). рисуем под лоадером крошечный образец каждого типа фильтра пару кадров — дальше без фризов
  function warmFilters() {
    const set = (id, k, attr, v) => { const n = document.querySelector(`#${id} [data-k="${k}"]`); if (n) n.setAttribute(attr, v); };
    set('liquid-resin', 'disp', 'scale', 60); set('liquid-resin', 'blur', 'stdDeviation', 3);
    set('frost-shatter', 'cut', 'k4', 0);
    set('glass-refract', 'disp', 'scale', 40); set('glass-refract', 'offR', 'dx', -8); set('glass-refract', 'offB', 'dx', 8);
    set('wind-blur', 'blur', 'stdDeviation', '10 0');
    const box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'position:fixed;left:0;top:0;z-index:100;opacity:0.01;pointer-events:none;display:flex;font:800 40px/1 var(--display)';
    const looks = ['url(#liquid-resin)', 'url(#frost-shatter)', 'url(#glass-refract)', 'url(#wind-blur)',
      'brightness(1.05) drop-shadow(0 0 12px rgba(255,150,60,.85)) drop-shadow(0 0 52px rgba(255,60,110,.5))'];
    looks.forEach((f) => {
      const h = document.createElement('h2');
      h.style.cssText = `font-size:40px;filter:${f}`;
      h.innerHTML = '<span class="cw"><span class="char"><span class="gb">ф</span><span class="hl ht">ф</span><span class="hl hb">ф</span></span></span>';
      box.append(h);
    });
    document.body.append(box);
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => box.remove())));
  }
  if (!reduced) warmFilters();

  // интро: в обычном режиме буквы героя собирает скролл; при reduced-motion — плавное проявление
  return () => {
    layoutProgress();
    document.documentElement.classList.add('ready');   // шкала прохождения проступает после лоадера
    const hb = blocks[0];
    if (reduced) gsap.to(hb, { opMul: 1, duration: 1.8, delay: 0.6, ease: 'power2.out' });   // reduced-motion: просто проявление
  };
}
