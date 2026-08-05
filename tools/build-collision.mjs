#!/usr/bin/env node
/**
 * Derive walkable-floor collision from a Gaussian splat, with no per-scene tuning.
 *
 *   node tools/build-collision.mjs <input.ply> --out public/<scene>/ [--cell 0.15]
 *   node tools/build-collision.mjs --self-test
 *
 * Everything that was hand-fitted for hall-3 is measured here instead:
 *   up-axis        <- dominant gaussian surface normal (Manhattan-world)
 *   level rotation <- normal of the fitted floor plane
 *   floor height   <- strongest horizontal layer, ranked by AREA not point count
 *   ceiling/height <- next strong layer above the floor
 *   thresholds     <- percentiles of this scene's own histograms
 *   walkable seed  <- largest connected component, so nothing is asked per scene
 *
 * Emits collision.json (levelling rotation + walkable bitmask) and prints an
 * ASCII plan plus a QA report with pass/fail gates, so an unattended run tells
 * you when it is unsure instead of silently producing bad collision.
 *
 * The splat itself is never rewritten: the rotation is reported so the runtime
 * can apply it to the splat layer, which keeps this a read-only analysis pass.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Small maths helpers
// ---------------------------------------------------------------------------

/** Quaternion (w,x,y,z) -> column-major-ish 3x3 as [c0, c1, c2] unit axes. */
export function quatAxes(w, x, y, z) {
    const n = Math.hypot(w, x, y, z) || 1;
    w /= n;
    x /= n;
    y /= n;
    z /= n;
    return [
        [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)],
        [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)],
        [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)],
    ];
}

/** Symmetric 3x3 eigen-decomposition by Jacobi rotation. Returns sorted desc. */
export function eigenSym3(m) {
    const a = m.map((r) => r.slice());
    let v = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
    ];
    for (let sweep = 0; sweep < 24; sweep++) {
        let off = 0;
        for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
        if (off < 1e-18) break;
        for (let p = 0; p < 3; p++) {
            for (let q = p + 1; q < 3; q++) {
                if (Math.abs(a[p][q]) < 1e-20) continue;
                const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
                const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
                const c = 1 / Math.sqrt(t * t + 1);
                const s = t * c;
                for (let k = 0; k < 3; k++) {
                    const akp = a[k][p];
                    const akq = a[k][q];
                    a[k][p] = c * akp - s * akq;
                    a[k][q] = s * akp + c * akq;
                }
                for (let k = 0; k < 3; k++) {
                    const apk = a[p][k];
                    const aqk = a[q][k];
                    a[p][k] = c * apk - s * aqk;
                    a[q][k] = s * apk + c * aqk;
                }
                for (let k = 0; k < 3; k++) {
                    const vkp = v[k][p];
                    const vkq = v[k][q];
                    v[k][p] = c * vkp - s * vkq;
                    v[k][q] = s * vkp + c * vkq;
                }
            }
        }
    }
    const out = [0, 1, 2].map((i) => ({ value: a[i][i], vector: [v[0][i], v[1][i], v[2][i]] }));
    out.sort((p, q) => q.value - p.value);
    return out;
}

/** Rotation matrix taking unit vector `from` onto unit vector `to`. */
export function rotationBetween(from, to) {
    const d = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
    if (d > 0.999999) {
        return [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
        ];
    }
    if (d < -0.999999) {
        // 180 degrees: rotate about any axis perpendicular to `from`.
        const axis = Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        const p = cross(from, axis);
        return rodrigues(normalize(p), Math.PI);
    }
    const axis = normalize(cross(from, to));
    return rodrigues(axis, Math.acos(Math.max(-1, Math.min(1, d))));
}

function rodrigues([x, y, z], angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const t = 1 - c;
    return [
        [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
        [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
        [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
    ];
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a) => {
    const n = Math.hypot(...a) || 1;
    return [a[0] / n, a[1] / n, a[2] / n];
};
const apply = (m, v) => [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
const matmul = (a, b) =>
    [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));

/** Largest connected component of a boolean grid, 4-connected. */
export function largestComponent(mask, nx, nz) {
    const label = new Int32Array(nx * nz).fill(-1);
    const stack = [];
    let best = [];
    let bestId = -1;
    let id = 0;
    for (let start = 0; start < mask.length; start++) {
        if (!mask[start] || label[start] >= 0) continue;
        const cells = [];
        stack.push(start);
        label[start] = id;
        while (stack.length) {
            const c = stack.pop();
            cells.push(c);
            const cx = c % nx;
            const cz = (c / nx) | 0;
            const push = (x, z) => {
                if (x < 0 || z < 0 || x >= nx || z >= nz) return;
                const n = z * nx + x;
                if (!mask[n] || label[n] >= 0) return;
                label[n] = id;
                stack.push(n);
            };
            push(cx - 1, cz);
            push(cx + 1, cz);
            push(cx, cz - 1);
            push(cx, cz + 1);
        }
        if (cells.length > best.length) {
            best = cells;
            bestId = id;
        }
        id++;
    }
    return { cells: best, componentCount: id, id: bestId };
}

/** Otsu threshold over a numeric histogram, so density cutoffs are data-driven. */
export function otsu(counts) {
    const total = counts.reduce((s, c) => s + c, 0);
    if (!total) return 0;
    let sum = 0;
    for (let i = 0; i < counts.length; i++) sum += i * counts[i];
    let sumB = 0;
    let wB = 0;
    let bestVar = -1;
    let ties = [];
    for (let t = 0; t < counts.length; t++) {
        wB += counts[t];
        if (!wB) continue;
        const wF = total - wB;
        if (!wF) break;
        sumB += t * counts[t];
        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;
        const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > bestVar * (1 + 1e-9)) {
            bestVar = between;
            ties = [t];
        } else if (between >= bestVar * (1 - 1e-9)) {
            ties.push(t);
        }
    }
    // Empty histogram bins between two modes all tie; take the middle of the gap
    // rather than its first bin, which would sit right against the lower mode.
    return ties.length ? ties[Math.floor(ties.length / 2)] : 0;
}

// ---------------------------------------------------------------------------
// Self test — the maths above is the part that fails silently, so check it.
// ---------------------------------------------------------------------------

function selfTest() {
    const assert = (cond, msg) => {
        if (!cond) throw new Error(`self-test failed: ${msg}`);
    };
    const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

    // Identity quaternion gives identity axes.
    const ax = quatAxes(1, 0, 0, 0);
    assert(near(ax[0][0], 1) && near(ax[1][1], 1) && near(ax[2][2], 1), 'identity quaternion');

    // Eigen: diagonal matrix returns its diagonal, sorted descending.
    const e = eigenSym3([
        [5, 0, 0],
        [0, 1, 0],
        [0, 0, 3],
    ]);
    assert(near(e[0].value, 5) && near(e[1].value, 3) && near(e[2].value, 1), 'eigen ordering');
    assert(Math.abs(Math.abs(e[0].vector[0]) - 1) < 1e-6, 'eigen vector');

    // rotationBetween maps `from` onto `to`, including the 180-degree case.
    for (const [from, to] of [
        [[0, 0, 1], [0, 1, 0]],
        [[0, 1, 0], [0, -1, 0]],
        [[0.3, 0.9, 0.31], [0, 1, 0]],
    ]) {
        const f = normalize(from);
        const t = normalize(to);
        const r = apply(rotationBetween(f, t), f);
        assert(near(r[0], t[0], 1e-5) && near(r[1], t[1], 1e-5) && near(r[2], t[2], 1e-5), `rotationBetween ${from}`);
    }

    // Connected components: two blobs, the larger one wins.
    const nx = 5;
    const nz = 3;
    const mask = new Uint8Array(nx * nz);
    [0, 1, 5, 6].forEach((i) => (mask[i] = 1)); // 4 cells
    [4, 9].forEach((i) => (mask[i] = 1)); // 2 cells
    const cc = largestComponent(mask, nx, nz);
    assert(cc.cells.length === 4, `largest component size ${cc.cells.length}`);
    assert(cc.componentCount === 2, `component count ${cc.componentCount}`);

    // Otsu separates a clean bimodal histogram.
    const hist = new Array(10).fill(0);
    hist[1] = 100;
    hist[8] = 100;
    const t = otsu(hist);
    assert(t > 1 && t < 8, `otsu threshold ${t}`);

    console.log('self-test OK');
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

const SPLAT_TRANSFORM = ['--yes', '@playcanvas/splat-transform@3.2.0'];
/** Enough points for stable statistics; keeps a 163 MB scan under a few seconds. */
const TARGET_POINTS = 250_000;

function toCsv(input, workDir) {
    const small = join(workDir, 'small.ply');
    const csv = join(workDir, 'small.csv');
    // -H 0 drops spherical harmonics (irrelevant to geometry) and shrinks the CSV.
    // NOTE: splat-transform does not apply -r/-t to CSV output, so all transforms
    // in this tool are done here in JS, never via the CLI.
    execFileSync('npx', [...SPLAT_TRANSFORM, '-w', '-q', input, '-N', '-H', '0', '--decimate-uniform', `${TARGET_POINTS}`, small], {
        stdio: 'inherit',
    });
    execFileSync('npx', [...SPLAT_TRANSFORM, '-w', '-q', small, csv], { stdio: 'inherit' });
    return csv;
}

function parseCsv(path) {
    const text = readFileSync(path, 'utf8');
    const nl = text.indexOf('\n');
    const header = text.slice(0, nl).trim().split(',');
    const col = (name) => header.indexOf(name);
    const ix = col('x');
    const iy = col('y');
    const iz = col('z');
    const io = col('opacity');
    const is = [col('scale_0'), col('scale_1'), col('scale_2')];
    const ir = [col('rot_0'), col('rot_1'), col('rot_2'), col('rot_3')];
    if (ix < 0 || iy < 0 || iz < 0) throw new Error('CSV missing x/y/z columns');

    const pos = [];
    const normals = [];
    const weights = [];
    const opacities = [];
    let line = nl + 1;
    while (line < text.length) {
        let end = text.indexOf('\n', line);
        if (end < 0) end = text.length;
        const parts = text.slice(line, end).split(',');
        line = end + 1;
        if (parts.length < 4) continue;
        const x = +parts[ix];
        const y = +parts[iy];
        const z = +parts[iz];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        pos.push([x, y, z]);
        opacities.push(io >= 0 ? +parts[io] : 10);

        if (is[0] >= 0 && ir[0] >= 0) {
            const s = [+parts[is[0]], +parts[is[1]], +parts[is[2]]];
            const axes = quatAxes(+parts[ir[0]], +parts[ir[1]], +parts[ir[2]], +parts[ir[3]]);
            // Smallest scale axis approximates the surface normal (log-scale, so
            // argmin is the same before and after exp).
            let k = 0;
            if (s[1] < s[k]) k = 1;
            if (s[2] < s[k]) k = 2;
            normals.push(axes[k]);
            // Weight by approximate surface area, so big flat gaussians (floors,
            // walls) dominate the vote over tiny detail ones.
            const rest = [0, 1, 2].filter((i) => i !== k).map((i) => Math.exp(s[i]));
            weights.push(Math.min(rest[0] * rest[1], 1));
        }
    }
    return { pos, normals, weights, opacities };
}

const sigmoid = (v) => 1 / (1 + Math.exp(-v));

/** Dominant surface normal, sign-free, via the weighted normal covariance. */
function dominantAxes(normals, weights) {
    const m = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
    ];
    for (let i = 0; i < normals.length; i++) {
        const n = normals[i];
        const w = weights[i];
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) m[a][b] += w * n[a] * n[b];
    }
    return eigenSym3(m);
}

/** Per-(x,z)-cell lowest surface, used for both floor detection and the fit. */
function cellFloors(points, cell, minCount) {
    const cells = new Map();
    for (const [x, y, z] of points) {
        const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
        let arr = cells.get(key);
        if (!arr) cells.set(key, (arr = []));
        arr.push(y);
    }
    const out = [];
    for (const [key, ys] of cells) {
        if (ys.length < minCount) continue;
        ys.sort((a, b) => a - b);
        const [i, j] = key.split(',').map(Number);
        out.push({ x: (i + 0.5) * cell, z: (j + 0.5) * cell, y: ys[Math.floor(ys.length * 0.05)], n: ys.length });
    }
    return out;
}

function fitPlane(points) {
    let n = points.length,
        Sx = 0,
        Sz = 0,
        Sy = 0,
        Sxx = 0,
        Szz = 0,
        Sxz = 0,
        Sxy = 0,
        Szy = 0;
    for (const p of points) {
        Sx += p.x;
        Sz += p.z;
        Sy += p.y;
        Sxx += p.x * p.x;
        Szz += p.z * p.z;
        Sxz += p.x * p.z;
        Sxy += p.x * p.y;
        Szy += p.z * p.y;
    }
    const A = [
        [Sxx, Sxz, Sx],
        [Sxz, Szz, Sz],
        [Sx, Sz, n],
    ];
    const B = [Sxy, Szy, Sy];
    for (let i = 0; i < 3; i++) {
        let m = i;
        for (let r = i + 1; r < 3; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
        [A[i], A[m]] = [A[m], A[i]];
        [B[i], B[m]] = [B[m], B[i]];
        for (let r = 0; r < 3; r++) {
            if (r === i) continue;
            const f = A[r][i] / A[i][i];
            for (let c = i; c < 3; c++) A[r][c] -= f * A[i][c];
            B[r] -= f * B[i];
        }
    }
    return [B[0] / A[0][0], B[1] / A[1][1], B[2] / A[2][2]];
}

function robustPlane(points) {
    let pts = points.slice();
    let m = fitPlane(pts);
    for (let it = 0; it < 8 && pts.length > 12; it++) {
        const res = pts.map((p) => Math.abs(m[0] * p.x + m[1] * p.z + m[2] - p.y)).sort((a, b) => a - b);
        const cut = Math.max(0.08, res[Math.floor(res.length * 0.7)]);
        const kept = pts.filter((p) => Math.abs(m[0] * p.x + m[1] * p.z + m[2] - p.y) <= cut);
        if (kept.length < 12) break;
        pts = kept;
        m = fitPlane(pts);
    }
    const res = pts.map((p) => m[0] * p.x + m[1] * p.z + m[2] - p.y);
    const rms = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / Math.max(1, res.length));
    return { plane: m, inliers: pts, rms, tiltDeg: (Math.atan(Math.hypot(m[0], m[1])) * 180) / Math.PI };
}

/**
 * Rank horizontal layers by AREA (distinct cells), not point count — that is what
 * separates a floor from a dense piece of furniture.
 */
function horizontalLayers(points, cell, band) {
    const layers = new Map();
    for (const [x, y, z] of points) {
        const b = Math.round(y / band);
        let s = layers.get(b);
        if (!s) layers.set(b, (s = new Set()));
        s.add(`${Math.floor(x / cell)},${Math.floor(z / cell)}`);
    }
    return [...layers.entries()]
        .map(([b, s]) => ({ y: b * band, area: s.size }))
        .sort((a, b) => b.area - a.area);
}

function main(argv) {
    if (argv.includes('--self-test')) return selfTest();

    const input = argv.find((a) => !a.startsWith('--'));
    if (!input) {
        console.error('usage: build-collision.mjs <input.ply> --out <dir> [--cell 0.15]');
        process.exit(2);
    }
    const outDir = argv[argv.indexOf('--out') + 1] ?? 'public/collision';
    const cell = Number(argv[argv.indexOf('--cell') + 1]) || 0.15;

    const workDir = join(tmpdir(), `build-collision-${process.pid}`);
    mkdirSync(workDir, { recursive: true });
    const report = { input, cell, warnings: [] };

    try {
        console.log(`[1/6] sampling ${input}`);
        const csv = toCsv(input, workDir);
        const { pos, normals, weights, opacities } = parseCsv(csv);
        report.sampledPoints = pos.length;
        if (!normals.length) report.warnings.push('no scale/rot columns; up-axis detection unavailable');

        // Opacity gate from this scene's own distribution, not a fixed constant.
        const alphas = opacities.map(sigmoid);
        const sorted = [...alphas].sort((a, b) => a - b);
        const alphaGate = Math.min(0.15, sorted[Math.floor(sorted.length * 0.35)]);
        report.opacityGate = +alphaGate.toFixed(3);
        const solid = pos.filter((_, i) => alphas[i] >= alphaGate);
        report.solidPoints = solid.length;

        console.log('[2/6] detecting up-axis');
        let up = [0, 1, 0];
        let rot = [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
        ];
        if (normals.length) {
            const eig = dominantAxes(normals, weights);
            report.normalEigenvalues = eig.map((e) => +e.value.toFixed(1));
            // Try each candidate axis; keep whichever yields the strongest
            // horizontal layer, which is what a real floor looks like.
            let bestScore = -1;
            for (const cand of eig) {
                const axis = normalize(cand.vector);
                const r = rotationBetween(axis, [0, 1, 0]);
                const rotated = solid.map((p) => apply(r, p));
                const layers = horizontalLayers(rotated, cell * 4, 0.2);
                const score = layers[0]?.area ?? 0;
                if (score > bestScore) {
                    bestScore = score;
                    up = axis;
                    rot = r;
                }
            }
            report.upAxis = up.map((v) => +v.toFixed(4));
        }

        let rotated = solid.map((p) => apply(rot, p));

        console.log('[3/6] locating floor and ceiling');
        let layers = horizontalLayers(rotated, cell * 4, 0.2);
        const strongest = layers[0];
        // Sign: the floor has the scene above it. If most volume sits below the
        // strongest layer, we are upside down.
        const above = rotated.filter((p) => p[1] > strongest.y).length;
        if (above < rotated.length * 0.5) {
            rot = matmul(rotationBetween([0, 1, 0], [0, -1, 0]), rot);
            rotated = solid.map((p) => apply(rot, p));
            layers = horizontalLayers(rotated, cell * 4, 0.2);
            report.flipped = true;
        }

        /**
         * Locate the floor. Rotating about the origin shifts every height by up
         * to (distance from origin) x sin(tilt) — metres across a large room — so
         * `anchor` carries the floor's centroid through each rotation and the
         * search band follows it. Without that the band drifts off the floor and
         * the levelling loop oscillates instead of converging.
         */
        const findFloor = (pts, anchor) => {
            const ls = horizontalLayers(pts, cell * 4, 0.2);
            let centre;
            if (anchor === undefined) {
                const hs = pts.map((p) => p[1]).sort((a, b) => a - b);
                const median = hs[Math.floor(hs.length * 0.5)];
                centre = (ls.find((l) => l.y <= median) ?? ls[0]).y;
            } else {
                centre = anchor;
            }
            const near = pts.filter((p) => Math.abs(p[1] - centre) < 0.5);
            const cells = cellFloors(near, cell * 3, 3);
            const fit = robustPlane(cells);
            // Centroid of the accepted floor cells, tracked through the next rotation.
            const cx = cells.reduce((s, p) => s + p.x, 0) / Math.max(1, cells.length);
            const cz = cells.reduce((s, p) => s + p.z, 0) / Math.max(1, cells.length);
            return { layers: ls, fit, centroid: [cx, fit.plane[0] * cx + fit.plane[1] * cz + fit.plane[2], cz] };
        };

        let found = findFloor(rotated, undefined);
        report.floor = {
            y: +found.fit.plane[2].toFixed(3),
            tiltDeg: +found.fit.tiltDeg.toFixed(2),
            rmsMeters: +found.fit.rms.toFixed(3),
            inlierCells: found.fit.inliers.length,
        };

        // Level iteratively: each correction shifts the heights, so the floor has
        // to be re-found and re-fitted rather than assumed.
        for (let iter = 0; iter < 8 && found.fit.tiltDeg > 0.2; iter++) {
            const n = normalize([-found.fit.plane[0], 1, -found.fit.plane[1]]);
            const r = rotationBetween(n, [0, 1, 0]);
            rot = matmul(r, rot);
            rotated = solid.map((p) => apply(rot, p));
            found = findFloor(rotated, apply(r, found.centroid)[1]);
            report.levellingIterations = iter + 1;
        }
        const levelled = found.fit;
        const floorY = levelled.plane[2];
        // Ceiling from a high percentile of scene height rather than the
        // largest-area layer above the floor — that picked counters and tables,
        // which are large and flat but are not the ceiling.
        const heights = rotated.map((p) => p[1]).sort((a, b) => a - b);
        const p98 = heights[Math.floor(heights.length * 0.98)];
        const ceilingY = Math.min(Math.max(p98, floorY + 2.0), floorY + 6.0);
        report.floorY = +floorY.toFixed(3);
        report.ceilingY = +ceilingY.toFixed(3);
        report.wallHeight = +(ceilingY - floorY).toFixed(2);
        report.residualTiltDeg = +levelled.tiltDeg.toFixed(2);

        console.log('[4/6] building floor and obstacle masks');
        const inBand = (y, lo, hi) => y >= floorY + lo && y <= floorY + hi;
        const pts = rotated;
        // Percentile bounds, not absolute: scans always carry distant floaters,
        // and a single stray point would otherwise inflate the grid enormously.
        const span = (axis) => {
            const v = pts.map((p) => p[axis]).sort((a, b) => a - b);
            return [v[Math.floor(v.length * 0.002)], v[Math.floor(v.length * 0.998)]];
        };
        const [minX, maxX] = span(0);
        const [minZ, maxZ] = span(2);
        const nx = Math.max(1, Math.ceil((maxX - minX) / cell));
        const nz = Math.max(1, Math.ceil((maxZ - minZ) / cell));
        if (nx * nz > 4_000_000) throw new Error(`grid too large (${nx}x${nz}); increase --cell`);

        const floorMask = new Uint8Array(nx * nz);
        const obstacleCount = new Int32Array(nx * nz);
        for (const [x, y, z] of pts) {
            const gx = Math.min(nx - 1, Math.max(0, Math.floor((x - minX) / cell)));
            const gz = Math.min(nz - 1, Math.max(0, Math.floor((z - minZ) / cell)));
            const i = gz * nx + gx;
            if (Math.abs(y - floorY) <= 0.10) floorMask[i] = 1;
            if (inBand(y, 0.3, 1.8)) obstacleCount[i]++;
        }

        // Obstacle threshold from this scene's own density histogram (Otsu).
        const maxCount = obstacleCount.reduce((m, c) => Math.max(m, c), 0);
        const hist = new Array(Math.min(64, maxCount + 1)).fill(0);
        const bucket = (c) => Math.min(hist.length - 1, Math.round((c / Math.max(1, maxCount)) * (hist.length - 1)));
        for (const c of obstacleCount) if (c > 0) hist[bucket(c)]++;
        const cut = Math.max(1, Math.round((otsu(hist) / (hist.length - 1)) * maxCount));
        report.obstacleThreshold = cut;
        const obstacle = new Uint8Array(nx * nz);
        for (let i = 0; i < obstacle.length; i++) obstacle[i] = obstacleCount[i] >= cut ? 1 : 0;

        console.log('[5/6] flood filling walkable region');
        // Close small gaps in floor coverage, but never across an obstacle, or
        // the closing would bridge a wall.
        const morph = (src, grow, radius) => {
            const dst = new Uint8Array(nx * nz);
            for (let z = 0; z < nz; z++) {
                for (let x = 0; x < nx; x++) {
                    const i = z * nx + x;
                    // Obstacles are never walkable and never bridged across.
                    if (obstacle[i]) continue;
                    let any = 0;
                    let all = 1;
                    for (let dz = -radius; dz <= radius; dz++) {
                        for (let dx = -radius; dx <= radius; dx++) {
                            const xx = x + dx;
                            const zz = z + dz;
                            const v = xx < 0 || zz < 0 || xx >= nx || zz >= nz ? 0 : src[zz * nx + xx];
                            if (v) any = 1;
                            else all = 0;
                        }
                    }
                    dst[i] = grow ? any : all;
                }
            }
            return dst;
        };
        // Morphological CLOSE (dilate then erode): fills holes left by patchy floor
        // coverage without growing the region outward, which a bare dilation would
        // do — that is what made the walkable area exceed the real floor.
        const candidate = morph(morph(floorMask, true, 2), false, 2);
        const cc = largestComponent(candidate, nx, nz);
        const walkable = new Uint8Array(nx * nz);
        for (const c of cc.cells) walkable[c] = 1;
        report.componentCount = cc.componentCount;
        report.walkableCells = cc.cells.length;
        report.walkableAreaM2 = +(cc.cells.length * cell * cell).toFixed(1);
        const floorCells = floorMask.reduce((s, v) => s + v, 0);
        report.floorCells = floorCells;
        report.walkableFractionOfFloor = +(cc.cells.length / Math.max(1, floorCells)).toFixed(2);

        console.log('[6/6] writing output and plan');
        mkdirSync(outDir, { recursive: true });
        const packed = Buffer.alloc(Math.ceil(walkable.length / 8));
        for (let i = 0; i < walkable.length; i++) if (walkable[i]) packed[i >> 3] |= 1 << (i & 7);
        writeFileSync(
            join(outDir, 'collision.json'),
            JSON.stringify(
                {
                    version: 1,
                    source: input,
                    // Apply this to the splat layer to level the scene; the grid
                    // below is expressed in the resulting frame.
                    rotation: rot,
                    floorY,
                    ceilingY,
                    wallHeight: ceilingY - floorY,
                    cell,
                    origin: [minX, minZ],
                    size: [nx, nz],
                    walkable: packed.toString('base64'),
                    report,
                },
                null,
                2,
            ),
        );

        // QA gates — an unattended run must say when it is unsure.
        const gate = (ok, msg) => {
            if (!ok) report.warnings.push(msg);
        };
        gate(levelled.rms < 0.08, `floor fit rms ${levelled.rms.toFixed(3)}m is high (>0.08) — floor may not be planar`);
        gate(report.floor.tiltDeg < 15, `pre-levelling tilt ${report.floor.tiltDeg}deg is large — up-axis may be wrong`);
        gate(levelled.tiltDeg < 1.0, `residual tilt ${levelled.tiltDeg.toFixed(2)}deg after levelling`);
        gate(
            report.wallHeight > 2.0 && report.wallHeight < 5.0,
            `ceiling height ${report.wallHeight}m outside 2-5m — scene may not be metric`,
        );
        gate(
            report.walkableFractionOfFloor > 0.4 && report.walkableFractionOfFloor < 3.0,
            `walkable/floor ratio ${report.walkableFractionOfFloor} looks wrong`,
        );
        gate(cc.componentCount < 400, `${cc.componentCount} components — thresholds may be off`);

        printPlan(walkable, obstacle, nx, nz, minX, minZ, cell);
        console.log('\n--- report ---');
        console.log(JSON.stringify(report, null, 2));
        console.log(
            report.warnings.length ? `\n${report.warnings.length} WARNING(S) above` : '\nall QA gates passed',
        );
        writeFileSync(join(outDir, 'collision-report.json'), JSON.stringify(report, null, 2));
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
}

/** ASCII plan: '#' walkable, '+' obstacle, '.' outside. Downsampled to fit a terminal. */
function printPlan(walkable, obstacle, nx, nz, minX, minZ, cell) {
    const cols = 100;
    const step = Math.max(1, Math.ceil(nx / cols));
    console.log(`\nplan (each char ~${(step * cell).toFixed(2)}m, origin x=${minX.toFixed(1)} z=${minZ.toFixed(1)})`);
    for (let z = 0; z < nz; z += step) {
        let row = '';
        for (let x = 0; x < nx; x += step) {
            let w = 0;
            let o = 0;
            for (let dz = 0; dz < step; dz++) {
                for (let dx = 0; dx < step; dx++) {
                    const zz = z + dz;
                    const xx = x + dx;
                    if (zz >= nz || xx >= nx) continue;
                    if (walkable[zz * nx + xx]) w++;
                    else if (obstacle[zz * nx + xx]) o++;
                }
            }
            row += w ? '#' : o ? '+' : '.';
        }
        console.log('  ' + row);
    }
}

main(process.argv.slice(2));
