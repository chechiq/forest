// все GLSL-шейдеры сцены

const common = /* glsl */ `
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
`;

export const quadVert = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// ---------- след мыши (flowmap, как в OGL): скорость курсора с затуханием ----------
export const flowFrag = /* glsl */ `
precision highp float;
uniform sampler2D tMap;
uniform float uFalloff, uDissipation, uAspect;
uniform vec2 uMouse, uVelocity;
varying vec2 vUv;
void main(){
  vec4 color = texture2D(tMap, vUv) * uDissipation;
  vec2 cursor = vUv - uMouse;
  cursor.x *= uAspect;
  vec3 stamp = vec3(uVelocity, 1.0 - pow(1.0 - min(1.0, length(uVelocity)), 3.0));
  float falloff = smoothstep(uFalloff, 0.0, length(cursor));
  color.rgb = mix(color.rgb, stamp, vec3(falloff));
  gl_FragColor = color;
}
`;

// ---------- фон: 2.5D-кадры с глубиной, зум, переходы ----------
export const quadFrag = /* glsl */ `
precision highp float;
uniform sampler2D tA, dA, tB, dB, tFlow, tStudio, tCut, tFgA, tFgB, dFgA, dFgB;
uniform float uLoA, uLoB, uLoFA, uLoFB;   // на сколько мипов текстура ужата под телефон (0 на компьютере)
uniform float uAspA, uAspB;
uniform vec2 uRes;
uniform vec2 uCen;              // точка кадра A в центре экрана (uv, y вниз)
uniform float uHv;              // какая высота кадра A видна на экране (в долях A)
uniform vec4 uRect;             // где кадр B лежит внутри A: центр.xy, размер.zw
uniform float uMixB;            // насколько проявлен вложенный кадр B
uniform float uLodB;
uniform float uEnd;
uniform float uDefA, uDefB;     // расфокус кадров на стыке (0 = резко, 1 = максимально мягко)             // конец перехода: B закрывает всё сам, без остатков A по краям            // сдвиг мипа B, чтобы размытые копии A и B были одного масштаба
uniform float uTime, uBlur, uGlass, uFade, uMotion;
uniform vec2 uMouse;            // 0..1, y вниз
uniform vec2 uPar;              // -1..1, сглаженная мышь
uniform vec2 uIdle;             // медленный дрейф
uniform float uFxA, uFxB;       // сила макро-эффектов
uniform float uSheenA, uBgA, uBgB; // блик на стекле, студия за краем кадра (кадры капсулы)
uniform float uCutA, uCutB;     // капсула вырезана по маске и лежит отдельным слоем поверх студии
uniform vec4 uCutRect;          // где вырезанная капсула лежит в кадре анфаса: центр.xy, размер.zw
// передний план, два слоя на кадр (ближний / средний): x,y = прозрачность, z,w = масштаб
uniform vec4 uFgA, uFgB;
uniform vec4 uFgL;   // размытие (мип) слоёв: x — A, z — B (y, w не используются)
varying vec2 vUv;

const float PAR_STRENGTH = 0.12;  // сила параллакса: больше = сильнее 3D
const float RIPPLE = 0.5;         // сила мелкой ряби листвы: 1 = сильно, 0 = нет
const float DEFOCUS = 2.0;        // насколько сильно уходит фокус на стыке кадров
${common}

vec2 coverScale(float asp){ float va = uRes.x / uRes.y; return va > asp ? vec2(1.0, asp / va) : vec2(va / asp, 1.0); }

// uv0 — точка кадра, k — сколько uv кадра в одной единице экрана
vec3 frame(sampler2D tex, sampler2D dep, vec2 uv0, vec2 k, float asp, float fx, float sheen, float bgFill, float cut, float defocus, vec2 s, float lo, out float depth){
  vec2 uvc = clamp(uv0, 0.0, 1.0);
  float ds = textureLod(dep, uvc, 1.5).r;      // сглаженная глубина: двигаем без рваных краёв
  // отражение капсулы на полу (кадр анфаса ниже ~0.81): жёсткое — без качания и ряби,
  // и едет в параллаксе вместе с основанием капсулы, а не по своей (ложной) глубине
  float refl = cut > 0.0 ? smoothstep(0.805, 0.83, uv0.y) : 0.0;
  if (refl > 0.0) ds = mix(ds, textureLod(dep, vec2(uvc.x, 0.79), 1.5).r, refl);
  float t = uTime;

  // параллакс: близкое уезжает сильно -> объёмный 3D-размаз
  vec2 par = (uPar + uIdle) * (ds - 0.32) * PAR_STRENGTH;

  // жидкий след мыши
  vec3 fl = texture2D(tFlow, vUv).rgb;
  vec2 flow = vec2(fl.x, -fl.y) * fl.z * 0.045 * (0.35 + ds) * (1.0 - 0.4 * bgFill) * (1.0 - refl);

  vec2 uv = uv0 - (par + flow) * k;

  // живое движение: ветки качаются, ножки гнутся
  float veg = clamp(length(textureLod(tex, uvc, max(1.2 - lo, 0.0)).rgb - textureLod(tex, uvc, 4.0 - lo).rgb) * 2.5, 0.0, 1.0);
  float nn = vnoise(uv0 * 3.0);
  vec2 sway = vec2(sin(t * 0.9 + uv0.y * 7.0 + nn * 6.0), 0.5 * cos(t * 0.7 + uv0.x * 6.0 + nn * 5.0)) * 0.006 * (0.35 + veg * RIPPLE);
  vec2 wob = (vec2(vnoise(uv0 * 4.0 + t * 0.3), vnoise(uv0 * 4.0 + 31.0 - t * 0.27)) - 0.5) * 0.014;
  vec2 tri = vec2(sin(t * 1.5 + uv0.x * 16.0 + uv0.y * 5.0), 0.6 * cos(t * 1.2 + uv0.y * 14.0 + uv0.x * 3.0)) * 0.007 * fx;
  uv += (sway + wob + tri) * ds * ds * uMotion * k.y * (1.0 - refl);

  vec2 uvs = clamp(uv, 0.001, 0.999);
  vec3 c;
  if (defocus > 0.01) {
    // мягкий расфокус: несколько размытых выборок по кругу, как боке объектива
    float bias = defocus * DEFOCUS;
    vec2 r = k * 0.004 * defocus;
    c = texture(tex, uvs, bias).rgb * 0.28;
    c += texture(tex, clamp(uvs + vec2( r.x, 0.0), 0.001, 0.999), bias).rgb * 0.18;
    c += texture(tex, clamp(uvs + vec2(-r.x, 0.0), 0.001, 0.999), bias).rgb * 0.18;
    c += texture(tex, clamp(uvs + vec2(0.0,  r.y), 0.001, 0.999), bias).rgb * 0.18;
    c += texture(tex, clamp(uvs + vec2(0.0, -r.y), 0.001, 0.999), bias).rgb * 0.18;
  } else {
    c = texture2D(tex, uvs).rgb;
  }
  if (fl.z > 0.02 && defocus < 0.01) {                           // расслоение цвета, только когда мышь тянет
    vec2 ca = flow * k * 0.2;
    c.r = texture2D(tex, clamp(uvs + ca, 0.001, 0.999)).r;
    c.b = texture2D(tex, clamp(uvs - ca, 0.001, 0.999)).b;
  }

  // размытие движения к центру экрана
  if (uBlur > 0.01) {
    vec2 toC = (s - 0.5) * k;
    vec3 acc = vec3(0.0);
    for (int i = 1; i <= 4; i++) acc += textureLod(tex, clamp(uvs - toC * (float(i) / 4.0 * 0.07 * uBlur), 0.001, 0.999), max(1.5 - lo, 0.0)).rgb;
    c = mix(c, acc / 4.0, uBlur * 0.7);
  }

  // свечение: мягкий bloom из мипов, неон на макро «дышит»
  vec3 bl = textureLod(tex, uvs, 4.5 - lo).rgb;
  vec3 hl = max(bl - 0.62, 0.0);
  float pulse = 0.55 + 0.45 * sin(t * 1.1 + vnoise(uvs * 6.0) * 6.283);
  c += hl * (0.05 + 0.45 * fx);
  c += hl * vec3(1.0, 0.3, 0.85) * fx * 0.45 * pulse;

  // искры на самых ярких бликах
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  vec2 cell = floor(uvs * vec2(asp, 1.0) * 40.0);
  float tw = pow(0.5 + 0.5 * sin(t * (1.2 + 2.0 * hash(cell)) + hash(cell + 3.1) * 6.283), 4.0);
  c += smoothstep(0.8, 0.97, lum) * tw * fx * vec3(1.0, 0.85, 1.0) * 0.16;

  // свет под курсором на макро
  vec2 dm = s - uMouse; dm.x *= uRes.x / uRes.y;
  float ml = exp(-dot(dm, dm) * 10.0);
  c += (c * 0.22 + hl * 1.2) * ml * fx * 0.45;

  // блик по краю стекла капсулы
  if (sheen > 0.0) {
    float e = 0.004;
    float l = textureLod(dep, uvs - vec2(e, 0.0), 0.0).r, r = textureLod(dep, uvs + vec2(e, 0.0), 0.0).r;
    float u = textureLod(dep, uvs - vec2(0.0, e), 0.0).r, d = textureLod(dep, uvs + vec2(0.0, e), 0.0).r;
    float rim = smoothstep(0.03, 0.1, length(vec2(r - l, d - u))) * step(min(min(l, r), min(u, d)), 0.2) * step(0.25, max(max(l, r), max(u, d)));
    rim *= 1.0 - smoothstep(0.82, 0.88, uvs.y);
    float band = exp(-pow(uvs.y - (0.45 + 0.3 * sin(t * 0.35) + uPar.y * 0.12), 2.0) * 25.0);
    c += vec3(0.88, 1.0, 0.92) * rim * (0.08 + 0.3 * band) * sheen;
  }

  // студия: дальний план со своим (слабым) параллаксом
  if (bgFill > 0.0) {
    vec2 parBg = (uPar + uIdle) * (0.04 - 0.32) * PAR_STRENGTH;
    // одна цельная студия на весь экран (без стыка двух фонов), со своим слабым параллаксом
    vec2 sst = coverScale(0.6667);
    vec3 bg = texture2D(tStudio, clamp(0.5 + (s - 0.5) * sst - parBg * 0.6 * sst, 0.001, 0.999)).rgb;
    // надпись стоит в сцене между студией и капсулой: капсула её перекрывает, стекло пропускает
    float m;
    vec3 rimC = vec3(0.0);
    if (cut > 0.0) {
      // капсула по маске: края стекла честно перекрывают студию, а не тянут её за собой
      vec2 uh = (uv - uCutRect.xy) / uCutRect.zw + 0.5;
      float inside = step(0.0, uh.x) * step(uh.x, 1.0) * step(0.0, uh.y) * step(uh.y, 1.0);
      vec2 ch = clamp(uh, 0.0, 1.0);
      m = texture2D(tCut, ch).a * inside;
      // контурный свет: нормаль края из размытой маски, два источника (холодный ключ + тёплый контр) и гало наружу
      if (sheen > 0.001) {
        float e = 0.01;
        vec2 g = vec2(textureLod(tCut, ch + vec2(e, 0.0), 2.5).a - textureLod(tCut, ch - vec2(e, 0.0), 2.5).a,
                      textureLod(tCut, ch + vec2(0.0, e), 2.5).a - textureLod(tCut, ch - vec2(0.0, e), 2.5).a);
        vec2 nrm = -g / max(length(g), 1e-4);                         // наружу от капсулы (uv, y вниз)
        float a = 0.18 * sin(t * 0.33) + uPar.x * 0.35;               // свет медленно обходит капсулу и тянется за мышью
        vec2 L1 = normalize(vec2(cos(-0.8 + a), sin(-0.8 + a) + uPar.y * 0.25));
        vec2 L2 = -vec2(L1.x, -L1.y * 0.6);
        float band = m * (1.0 - textureLod(tCut, ch, 2.0).a) * 2.2;  // тонкая полоса по самому краю изнутри
        float wide = m * (1.0 - textureLod(tCut, ch, 4.0).a);         // мягкий объём вглубь стекла
        float halo = max(textureLod(tCut, ch, 5.0).a - m, 0.0) * inside;
        float k1 = pow(max(dot(nrm, L1), 0.0), 1.2), k2 = pow(max(dot(nrm, L2), 0.0), 1.8);
        float flick = 0.92 + 0.08 * sin(t * 2.3 + uh.y * 9.0);
        // блик, который медленно обегает контур
        float ang = atan(nrm.y, nrm.x);
        float run = pow(0.5 + 0.5 * cos(ang - t * 0.55), 14.0);
        rimC = vec3(0.82, 1.0, 0.93) * (band * 2.0 + wide * 0.55 + halo * 0.95) * k1 * flick
             + vec3(1.0, 0.72, 0.48) * (band * 1.15 + wide * 0.3 + halo * 0.5) * k2
             + vec3(0.95, 1.0, 0.97) * (band * 1.6 + halo * 0.6) * run;
        rimC *= sheen;
      }
    } else {
      m = smoothstep(0.0, 0.22, uv.x) * smoothstep(0.0, 0.22, 1.0 - uv.x) * smoothstep(0.0, 0.04, uv.y) * smoothstep(0.0, 0.08, 1.0 - uv.y);
    }
    c = mix(bg, c, mix(1.0, m, bgFill));
    c += rimC;
  }

  depth = ds;
  return c;
}

// слой переднего плана: масштаб от камеры, параллакс и размытие по собственной глубине слоя
vec3 fgLayer(vec3 col, sampler2D tex, sampler2D dtex, vec2 ch, vec2 s, vec2 sc, float scale, float a, float lod, vec2 disp, vec3 env, float envL, float lo) {
  if (a < 0.002) return col;
  // настоящая глубина слоя (Depth Anything): каждый шарик, ножка и рыльце едут и размываются по своей глубине,
  // как пиксели кадра -> объёмный 3D-размаз вместо плоской текстуры. Два шага, как в parallax mapping.
  vec2 u0 = 0.5 + (s - 0.5) * sc / scale;
  float dd = dot(textureLod(dtex, clamp(u0 - disp * sc / scale, 0.0, 1.0), 2.0).rg, ch);
  vec2 dsp = disp * mix(0.15, 1.6, dd);
  dd = dot(textureLod(dtex, clamp(u0 - dsp * sc / scale, 0.0, 1.0), 2.0).rg, ch);
  dsp = disp * mix(0.15, 1.6, dd);
  lod = max(lod + (dd - 0.4) * 1.4, 0.0);
  vec2 u = u0 - dsp * sc / scale;
  // мягкий край текстуры: никаких полос от растянутых крайних пикселей
  vec2 e = smoothstep(vec2(0.0), vec2(0.06), u) * smoothstep(vec2(0.0), vec2(0.06), 1.0 - u);
  a *= e.x * e.y;
  if (a < 0.002) return col;
  // расфокус как у объектива: диск по спирали золотого угла (Catlike Coding / GPU Gems 28),
  // радиус растёт с близостью к камере; мип снимает остаточный шум между выборками
  // пусто рядом -> выходим одной выборкой с крупного мипа (бережём видеокарту)
  if (textureLod(tex, clamp(u, 0.0, 1.0), max(lod + 2.0 - lo, 0.0)).a < 0.004) return col;
  vec2 r = exp2(lod - lo) / vec2(textureSize(tex, 0));   // радиус в uv как у полноразмерной текстуры
  float l = max(lod - 2.0 - lo, 0.0);
  vec4 f = textureLod(tex, clamp(u, 0.0, 1.0), l);
  float wsum = 1.0;
  if (lod > 0.8) {
    for (int k = 1; k < 14; k++) {
      float fk = float(k);
      float rad = sqrt(fk / 13.0);
      float ang = fk * 2.39996;
      vec2 o = vec2(cos(ang), sin(ang)) * rad * r;
      f += textureLod(tex, clamp(u + o, 0.0, 1.0), l);
      wsum += 1.0;
    }
  }
  f /= wsum;
  vec3 c = f.rgb;
  float L = dot(c, vec3(0.299, 0.587, 0.114));
  c = c * mix(vec3(1.0), env / envL, 0.08);          // чуть-чуть оттенка кадра
  c = c / (1.0 + c * 0.12);                           // только самые яркие блики
  return mix(col, c, f.a * a);
}

void main(){
  vec2 s = vec2(vUv.x, 1.0 - vUv.y);
  float ar = uRes.x / uRes.y;

  // линза: проходим сквозь стенку капсулы
  if (uGlass > 0.0) {
    vec2 q = s - 0.5; q.x *= ar;
    float r = length(q);
    s = 0.5 + (s - 0.5) * (1.0 - uGlass * 0.28 * exp(-r * r * 2.5));
  }

  // камера: кадр A целиком, кадр B вложен в его прямоугольник -> один непрерывный зум
  vec2 kA = vec2(uHv * ar / uAspA, uHv);
  vec2 uvA = uCen + (s - 0.5) * kA;
  float depA, depB;
  // в самом конце перехода B закрывает экран целиком — A не считаем (результат тот же, работы вдвое меньше)
  vec3 col = vec3(0.0);
  if (uEnd < 0.999) col = frame(tA, dA, uvA, kA, uAspA, uFxA, uSheenA, uBgA, uCutA, uDefA, s, uLoA, depA);

  if (uMixB > 0.001) {
    vec2 uvB = (uvA - uRect.xy) / uRect.zw + 0.5;
    vec2 e = min(uvB, 1.0 - uvB);
    // расстояние до края в одних единицах по обеим осям + рваный шумный край вместо ровной рамки
    float dEdge = min(e.x * uAspB, e.y);
    float n = vnoise(uvB * vec2(uAspB, 1.0) * 3.0 + 7.0) - 0.5;
    float edge = smoothstep(0.02, 0.45, dEdge + n * 0.14) * smoothstep(0.0, 0.04, dEdge);   // широкий мягкий край
    if (edge > 0.0 || uEnd > 0.0) {
      vec3 b = frame(tB, dB, uvB, kA / uRect.zw, uAspB, uFxB, 0.0, uBgB, uCutB, uDefB, s, uLoB, depB);
      // смена кадра на весь экран сразу, в момент расфокуса; мягкий край только у границы B
      edge = mix(edge * uMixB, 1.0, uEnd);
      // у края B берёт общий цвет и свет у A, свои детали оставляет -> тон на стыке совпадает
      vec3 aLow = textureLod(tA, clamp(uvA, 0.0, 1.0), 5.0 - uLoA).rgb;
      vec3 bLow = textureLod(tB, clamp(uvB, 0.0, 1.0), 5.0 + uLodB - uLoA).rgb;
      // подгонка цвета: пока B только наплывает, он целиком в тонах A (детали свои) — шва не видно;
      // по мере перехода подгонка остаётся лишь у края и к концу уходит
      float tone = mix(1.0 - smoothstep(0.1, 0.55, dEdge), 1.0, 0.75 * (1.0 - smoothstep(0.25, 0.9, uMixB)));
      b += (aLow - bLow) * tone * (1.0 - uEnd);
      col = mix(col, b, edge);
    }
  }

  // передний план у самого объектива: ездит от мыши сильнее всего и пролетает мимо камеры
  if (uFgA.x + uFgB.x > 0.001) {
    vec2 sc = coverScale(1.5);
    vec2 par = uPar + uIdle;
    // общий тон сцены: слои снимали в студийном свете, притягиваем их к цвету кадра, чтобы не били по глазам
    vec3 env = textureLod(tA, clamp(uvA, 0.0, 1.0), 7.0 - uLoA).rgb;
    float envL = max(dot(env, vec3(0.299, 0.587, 0.114)), 0.04);
    // от дальнего к ближнему: B средний, B ближний, A средний, A ближний
    // тот же след мыши, что у кадра, и лёгкое покачивание: слои живут вместе со сценой
    vec3 fl = texture2D(tFlow, vUv).rgb;
    vec2 flow = vec2(fl.x, -fl.y) * fl.z * 0.035;
    float t = uTime * uMotion;
    vec2 swN = vec2(sin(t * 0.55), cos(t * 0.43)) * 0.006;
    // масштаб = близость; сдвиг растёт вместе с ней (ближний ~0.17 экрана, средний ~0.11, кадр ~0.08)
    col = fgLayer(col, tFgB,  dFgB, vec2(1.0, 0.0), s, sc, uFgB.z * 1.15, uFgB.x, uFgL.z, par * 0.17 * uFgB.z + flow + swN, env, envL, uLoFB);
    col = fgLayer(col, tFgA,  dFgA, vec2(1.0, 0.0), s, sc, uFgA.z * 1.15, uFgA.x * 0.9, uFgL.x, par * 0.17 * uFgA.z + flow + swN, env, envL, uLoFA);
  }

  // виньетка + дизеринг против полос
  vec2 v = vec2(vUv.x, 1.0 - vUv.y) - 0.5;
  col *= 1.0 - dot(v, v) * 0.55;
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;

  gl_FragColor = vec4(col * uFade, 1.0);
}
`;

// ---------- частицы: пыльца в лесу, в макро — капельки, живут вместе с кадром ----------
export const ptsVert = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime, uTravel, uAspect, uDpr, uStage, uBright, uShock, uMacro, uFinal;
uniform vec2 uShockPos, uPar;
uniform vec2 uTrail[8];
uniform float uTrailS[8];
varying float vAlpha;
varying vec3 vCol;
varying float vMacro;
varying float vFinal;
void main(){
  // всегда летят на камеру вместе с зумом: разлетаются от центра и растут
  float z = fract(aSeed.z + uTravel * (0.6 + aSeed.w * 0.6));
  vec2 p = aSeed.xy * 2.0 - 1.0;
  p *= 0.35 + z * z * 1.6;
  p += vec2(sin(uTime * 0.3 + aSeed.w * 40.0), cos(uTime * 0.23 + aSeed.z * 30.0)) * 0.03 * (0.5 + z);
  p.y += sin(uTime * 0.15 + aSeed.x * 10.0) * 0.02;
  // в макро капли ещё и плавают, как в воде
  p += vec2(cos(uTime * 0.37 + aSeed.y * 21.0), sin(uTime * 0.29 + aSeed.x * 17.0)) * 0.025 * (0.4 + z) * uMacro;

  // тот же параллакс, что у картинки: точка на своей глубине едет вместе со слоем
  float dep = 0.2 + 0.8 * z;
  vec2 par = uPar * (dep - 0.32) * 0.12;
  p += vec2(par.x, -par.y) * 2.0;

  // в макро качаются как трихомы на ножках
  p += vec2(sin(uTime * 1.5 + p.x * 8.0 + p.y * 2.5), 0.6 * cos(uTime * 1.2 + p.y * 7.0 + p.x * 1.5)) * 0.008 * dep * uMacro;

  // в лесу разлетаются от курсора, в макро нет
  vec2 asp = vec2(uAspect, 1.0);
  for (int i = 0; i < 8; i++) {
    vec2 d = (p - uTrail[i]) * asp;
    float l = length(d);
    float f = exp(-l * l * 16.0) * uTrailS[i] * (1.0 - uMacro);
    p += d / max(l, 1e-3) / asp * f * 0.18 * (0.4 + z);
  }
  vec2 ds = (p - uShockPos) * asp; float ls = length(ds);
  float ring = exp(-pow((ls - uShock * 1.6) * 5.0, 2.0)) * (1.0 - uShock) * (1.0 - uMacro);
  p += ds / max(ls, 1e-3) / asp * ring * 0.15;

  gl_Position = vec4(p, 0.0, 1.0);
  float sz = mix(mix(3.0, 28.0, z * z), mix(4.0, 22.0, z * z), uMacro);
  sz = mix(sz, mix(14.0, 90.0, z * z), uFinal);           // финал: крупное боке объектива
  gl_PointSize = sz * (0.55 + aSeed.w * 0.9) * uDpr;
  vAlpha = smoothstep(0.05, 0.35, z) * (1.0 - smoothstep(0.8, 1.0, z)) * 0.7;
  // прореживаем по отдельному случайному числу (не по позиции, иначе выживает одна половина экрана)
  float keep = fract(aSeed.w * 7.31 + aSeed.z * 3.17);
  vAlpha *= mix(1.0, step(0.5, keep) * 0.9, uMacro);
  vAlpha *= mix(1.0, step(0.72, keep), uFinal);
  vMacro = uMacro;
  vFinal = uFinal;

  vec3 forest = mix(vec3(0.75, 0.95, 0.45), vec3(1.0, 0.85, 0.5), aSeed.x);
  vec3 macro = mix(vec3(1.0, 0.45, 0.9), vec3(0.7, 1.0, 0.5), step(0.8, aSeed.x));
  vec3 bokeh = mix(vec3(1.0, 0.3, 0.75), vec3(0.75, 0.35, 1.0), step(0.5, aSeed.x));
  bokeh = mix(bokeh, vec3(0.65, 1.0, 0.35), step(0.85, aSeed.y));
  vCol = mix(mix(forest, macro, uStage), bokeh, uFinal) * uBright;
}
`;

export const ptsFrag = /* glsl */ `
precision highp float;
varying float vAlpha;
varying vec3 vCol;
varying float vMacro;
varying float vFinal;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  float r = length(q) * 2.0;
  // мягкое боке
  float a = (exp(-r * r * 5.0) * 0.8 + exp(-r * r * 1.8) * 0.25) * (1.0 - smoothstep(0.85, 1.0, r));
  vec3 soft = vCol * a * a;
  // капелька: светлый ободок, прозрачное тело и мягкий серп света по краю сверху-слева
  // (раньше была жёсткая белая точка-блик — выглядела дёшево)
  float body = 1.0 - smoothstep(0.82, 1.0, r);
  float rim = smoothstep(0.55, 0.9, r) * body;
  float side = clamp(dot(normalize(q + 1e-4), normalize(vec2(-0.7, -0.75))), 0.0, 1.0);
  float crescent = smoothstep(0.45, 0.85, r) * body * side * side;
  vec3 drop = vCol * (rim * 0.45 + body * 0.07) + mix(vCol, vec3(1.0, 0.96, 1.0), 0.45) * crescent * 0.45;
  // боке как у фона финала: плоский мягкий диск с чуть светлее краем
  float disc = 1.0 - smoothstep(0.82, 1.0, r);
  vec3 bok = vCol * disc * (0.45 + 0.4 * smoothstep(0.5, 0.92, r)) * 0.55;
  vec3 c = mix(mix(soft, drop, vMacro), bok, vFinal);
  gl_FragColor = vec4(c * vAlpha, 1.0);
}
`;
