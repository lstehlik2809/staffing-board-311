// Seeded pseudo-random numbers shared by the pipeline (Node) and the browser.
// sfc32 generator: 128-bit state, deterministic across JavaScript engines.
// Normal and gamma variates use only +, *, sqrt and log, so results match
// between V8 runtimes and agree to rounding error elsewhere.

export function hashSeed(...parts) {
  // FNV-1a over the string form of the parts; returns an unsigned 32-bit seed.
  let h = 0x811c9dc5;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function makeRng(seed) {
  let s = seed >>> 0;
  const mix = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
  let a = mix(), b = mix(), c = mix(), d = mix();

  function u32() {
    const t0 = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const t = (t0 + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  }
  for (let i = 0; i < 20; i++) u32();

  const uniform = () => (u32() + 0.5) / 4294967296;

  let spare = 0, hasSpare = false;
  function normal() {
    if (hasSpare) { hasSpare = false; return spare; }
    let u, v, q;
    do {
      u = 2 * uniform() - 1;
      v = 2 * uniform() - 1;
      q = u * u + v * v;
    } while (q >= 1 || q === 0);
    const f = Math.sqrt((-2 * Math.log(q)) / q);
    spare = v * f; hasSpare = true;
    return u * f;
  }

  // Gamma(shape, rate = 1), Marsaglia & Tsang (2000).
  function gamma(shape) {
    if (shape < 1) {
      const u = uniform();
      return gamma(shape + 1) * Math.exp(Math.log(u) / shape);
    }
    const dd = shape - 1 / 3;
    const cc = 1 / Math.sqrt(9 * dd);
    for (;;) {
      let x, v;
      do { x = normal(); v = 1 + cc * x; } while (v <= 0);
      v = v * v * v;
      const u = uniform();
      const x2 = x * x;
      if (u < 1 - 0.0331 * x2 * x2) return dd * v;
      if (Math.log(u) < 0.5 * x2 + dd * (1 - v + Math.log(v))) return dd * v;
    }
  }

  const beta = (p, q) => { const x = gamma(p), y = gamma(q); return x / (x + y); };
  // Inverse-gamma(shape, scale): scale / Gamma(shape, 1).
  const invGamma = (shape, scale) => scale / gamma(shape);

  return { uniform, normal, gamma, beta, invGamma };
}
