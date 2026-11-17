// Mobile: opaque source frames, four texture reads per transition pixel.
// No cutout/half-float flow buffers or derivative-dependent sampling in branches.
export const mobileFrag = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D tA, tB, dA, dB, tStudio;
uniform vec2 uRes, uCen;
uniform float uHv, uAspA, uMixB, uEnd, uFade, uTime, uMotion;
uniform float uStudio;
uniform vec4 uRect;
varying vec2 vUv;
vec3 frame(sampler2D tex, sampler2D dep, vec2 uv, vec2 scale) {
  float d = texture2D(dep, clamp(uv, 0.001, 0.999)).r;
  vec2 drift = vec2(sin(uTime * .21), cos(uTime * .17)) * .003 * uMotion;
  vec3 col = texture2D(tex, clamp(uv - drift * (d - .32) * scale, .001, .999)).rgb;
  // Fill outside the portrait hero instead of stretching its edge into stripes
  // when the phone rotates into landscape.
  vec2 edge = min(uv, 1.0 - uv);
  float feather = max(scale.x, scale.y) > 1.0 ? .12 : .035;
  float inside = smoothstep(0.0, feather, min(edge.x, edge.y));
  vec3 bg = vec3(.015, .055, .04);
  if (uStudio > .5 && inside < .999) {
    vec2 s = vec2(vUv.x, 1.0 - vUv.y);
    float aspect = uRes.x / uRes.y;
    vec2 cover = aspect > .6667 ? vec2(1.0, .6667 / aspect) : vec2(aspect / .6667, 1.0);
    bg = texture2D(tStudio, .5 + (s - .5) * cover).rgb;
  }
  return mix(bg, col, inside);
}
void main() {
  vec2 s = vec2(vUv.x, 1.0 - vUv.y);
  vec2 k = vec2(uHv * uRes.x / uRes.y / uAspA, uHv);
  vec2 a = uCen + (s - .5) * k;
  vec3 col = frame(tA, dA, a, k);
  if (uMixB > .001) {
    vec2 b = (a - uRect.xy) / uRect.zw + .5;
    vec2 e = min(b, 1.0 - b);
    float edge = smoothstep(0.0, .18, min(e.x, e.y));
    col = mix(col, frame(tB, dB, b, k / uRect.zw), mix(edge * uMixB, 1.0, uEnd));
  }
  gl_FragColor = vec4(col * uFade, 1.0);
}
`;
