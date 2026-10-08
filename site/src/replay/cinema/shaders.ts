export const FULLSCREEN_VERT = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const BACKGROUND_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec2 u_offset;
uniform float u_intensity;
uniform float u_seed;
uniform vec2 u_aspect;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21) + u_seed); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec3 col = mix(vec3(0.035, 0.043, 0.063), vec3(0.047, 0.067, 0.11), v_uv.y);
  if (u_intensity > 0.0) {
    vec2 p = v_uv * u_aspect * 2.2 + u_offset;
    float n = fbm(p) * 0.7 + fbm(p * 1.7 + 4.0) * 0.5;
    col += vec3(0.18, 0.38, 0.87) * smoothstep(0.45, 0.85, n) * u_intensity;
  }
  outColor = vec4(col, 1.0);
}`;

export const QUAD_VERT = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_center;
layout(location = 2) in vec2 a_size;
layout(location = 3) in float a_angle;
layout(location = 4) in vec4 a_color;
layout(location = 5) in float a_shape;
uniform vec2 u_resolution;
out vec2 v_local;
out vec4 v_color;
flat out float v_shape;
void main() {
  v_local = a_corner;
  v_color = a_color;
  v_shape = a_shape;
  float c = cos(a_angle);
  float s = sin(a_angle);
  vec2 p = a_corner * a_size;
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  vec2 clip = (a_center + p) / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

export const QUAD_FRAG = `#version 300 es
precision highp float;
in vec2 v_local;
in vec4 v_color;
flat in float v_shape;
out vec4 outColor;
void main() {
  float d = length(v_local);
  float a;
  if (v_shape < 3.5 && v_shape > 2.5) {
    float across = abs(v_local.y);
    if (across > 1.0) discard;
    float along = (v_local.x + 1.0) * 0.5;
    a = pow(along, 2.5) * (1.0 - smoothstep(0.0, 1.0, across));
  } else {
    if (d > 1.0) discard;
    if (v_shape < 0.5) a = pow(1.0 - d, 2.2);
    else if (v_shape < 1.5) a = smoothstep(0.8, 0.9, d) * (1.0 - smoothstep(0.92, 1.0, d));
    else if (v_shape < 2.5) a = 1.0 - smoothstep(0.7, 1.0, d);
    else a = pow(1.0 - d, 4.0);
  }
  float alpha = v_color.a * a;
  outColor = vec4(v_color.rgb * alpha, alpha);
}`;

export const LINE_VERT = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in float a_alpha;
uniform vec2 u_resolution;
out float v_alpha;
void main() {
  v_alpha = a_alpha;
  vec2 clip = a_pos / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

export const LINE_FRAG = `#version 300 es
precision highp float;
in float v_alpha;
out vec4 outColor;
void main() { outColor = vec4(vec3(0.290, 0.498, 0.941) * v_alpha * 1.3, v_alpha); }`;

export const COIN_VERT = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_center;
layout(location = 2) in float a_size;
layout(location = 3) in float a_alpha;
layout(location = 4) in vec4 a_uv;
uniform vec2 u_resolution;
out vec2 v_local;
out vec2 v_uv;
out float v_alpha;
void main() {
  v_local = a_corner;
  v_alpha = a_alpha;
  v_uv = mix(a_uv.xy, a_uv.zw, a_corner * 0.5 + 0.5);
  vec2 clip = (a_center + a_corner * a_size * 0.5) / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

export const COIN_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
in vec2 v_local;
in vec2 v_uv;
in float v_alpha;
out vec4 outColor;
void main() {
  float d = length(v_local);
  if (d > 1.0) discard;
  vec4 c = texture(u_atlas, v_uv);
  float edge = 1.0 - smoothstep(0.92, 1.0, d);
  float ring = smoothstep(0.86, 0.92, d) * (1.0 - smoothstep(0.96, 1.0, d));
  vec3 rgb = c.rgb * edge + vec3(0.25) * ring;
  float a = max(c.a * edge, ring * 0.6);
  outColor = vec4(rgb * v_alpha, a * v_alpha);
}`;

export const BRIGHT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform float u_threshold;
void main() {
  vec3 c = texture(u_src, v_uv).rgb;
  float l = max(c.r, max(c.g, c.b));
  outColor = vec4(c * smoothstep(u_threshold, u_threshold + 0.5, l), 1.0);
}`;

export const DOWN_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform vec2 u_texel;
void main() {
  vec3 c = texture(u_src, v_uv + u_texel * vec2(-1.0, -1.0)).rgb
         + texture(u_src, v_uv + u_texel * vec2(1.0, -1.0)).rgb
         + texture(u_src, v_uv + u_texel * vec2(-1.0, 1.0)).rgb
         + texture(u_src, v_uv + u_texel * vec2(1.0, 1.0)).rgb;
  outColor = vec4(c * 0.25, 1.0);
}`;

export const UP_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform vec2 u_texel;
void main() {
  vec3 c = texture(u_src, v_uv).rgb * 4.0
         + texture(u_src, v_uv + u_texel * vec2(-1.0, 0.0)).rgb * 2.0
         + texture(u_src, v_uv + u_texel * vec2(1.0, 0.0)).rgb * 2.0
         + texture(u_src, v_uv + u_texel * vec2(0.0, -1.0)).rgb * 2.0
         + texture(u_src, v_uv + u_texel * vec2(0.0, 1.0)).rgb * 2.0
         + texture(u_src, v_uv + u_texel).rgb
         + texture(u_src, v_uv - u_texel).rgb
         + texture(u_src, v_uv + u_texel * vec2(1.0, -1.0)).rgb
         + texture(u_src, v_uv + u_texel * vec2(-1.0, 1.0)).rgb;
  outColor = vec4(c / 16.0, 1.0);
}`;

export const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform float u_bloomStrength;
uniform float u_exposure;
uniform float u_frame;
uniform vec2 u_resolution;
uniform vec4 u_shock;
uniform float u_feather;
const vec3 PAGE = vec3(12.0, 15.0, 20.0) / 255.0;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  vec2 uv = v_uv;
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 dir = uv - u_shock.xy;
  float dist = length(dir * aspect);
  float band = u_shock.w * exp(-pow((dist - u_shock.z * 0.9) * 12.0, 2.0));
  uv -= normalize(dir + 1e-6) * band * 0.02;
  float ca = 0.004 * u_shock.w;
  vec3 col = vec3(texture(u_scene, uv + dir * ca).r, texture(u_scene, uv).g, texture(u_scene, uv - dir * ca).b);
  col += texture(u_bloom, uv).rgb * u_bloomStrength;
  col = aces(col * u_exposure * 1.35);
  float vig = smoothstep(1.15, 0.35, length((v_uv - 0.5) * aspect));
  col *= mix(0.72, 1.0, vig);
  float g = fract(sin(dot(v_uv * u_resolution + u_frame, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  col += g * 0.025;
  if (u_feather > 0.0) {
    vec2 px = v_uv * u_resolution;
    float edge = min(min(px.x, u_resolution.x - px.x), min(px.y, u_resolution.y - px.y)) / min(u_resolution.x, u_resolution.y);
    col = mix(PAGE, col, smoothstep(0.0, u_feather, edge));
  }
  outColor = vec4(col, 1.0);
}`;
