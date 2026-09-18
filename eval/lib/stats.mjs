// Small, dependency-free statistics helpers used by the evaluation suite.

export function mean(values) {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : NaN;
}

export function sd(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
}

/** Nearest-rank quantile (q in 0..1). P95 of 20 samples is therefore the 19th smallest. */
export function quantile(values, q) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(items, seed) {
  const rng = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Wilson score interval for a proportion. Honest about small samples, unlike k/n alone. */
export function wilson(successes, total, z = 1.96) {
  if (!total) return { lower: NaN, upper: NaN };
  const p = successes / total;
  const denom = 1 + z ** 2 / total;
  const centre = (p + z ** 2 / (2 * total)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / total + z ** 2 / (4 * total ** 2))) / denom;
  return { lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

/**
 * Weighted Cohen's kappa for ordinal ratings.
 * pairs: [[a, b], ...] of integers in [min, max]. weights: "quadratic" (QWK) or "linear".
 * Returns NaN when chance-expected disagreement is zero (e.g. both raters used one category).
 */
export function weightedKappa(pairs, { min, max, weights = "quadratic" }) {
  const k = max - min + 1;
  if (!pairs.length || k < 2) return NaN;
  const observed = Array.from({ length: k }, () => new Array(k).fill(0));
  const rows = new Array(k).fill(0);
  const cols = new Array(k).fill(0);
  for (const [a, b] of pairs) {
    const i = Math.min(max, Math.max(min, a)) - min;
    const j = Math.min(max, Math.max(min, b)) - min;
    observed[i][j] += 1;
    rows[i] += 1;
    cols[j] += 1;
  }
  const n = pairs.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const distance = Math.abs(i - j) / (k - 1);
      const w = weights === "linear" ? distance : distance ** 2;
      num += w * observed[i][j];
      den += (w * rows[i] * cols[j]) / n;
    }
  }
  return den === 0 ? NaN : 1 - num / den;
}

function ranks(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const rank = (i + j) / 2 + 1;
    for (let t = i; t <= j; t++) out[order[t][1]] = rank;
    i = j + 1;
  }
  return out;
}

export function spearman(xs, ys) {
  if (xs.length !== ys.length || xs.length < 3) return NaN;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? NaN : num / Math.sqrt(dx * dy);
}

/**
 * Percentile bootstrap that resamples whole clusters (essays), because the criterion scores
 * within one essay are not independent. statFn receives the flattened resampled items.
 */
export function clusterBootstrap(clusters, statFn, { iters = 1000, seed = 1 } = {}) {
  if (clusters.length < 2) return null;
  const rng = mulberry32(seed);
  const values = [];
  for (let i = 0; i < iters; i++) {
    const sample = [];
    for (let j = 0; j < clusters.length; j++) sample.push(...clusters[Math.floor(rng() * clusters.length)]);
    const value = statFn(sample);
    if (Number.isFinite(value)) values.push(value);
  }
  if (values.length < iters / 2) return null;
  values.sort((a, b) => a - b);
  return {
    lower: values[Math.floor(0.025 * (values.length - 1))],
    upper: values[Math.ceil(0.975 * (values.length - 1))],
  };
}
