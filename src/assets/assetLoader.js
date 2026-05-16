/**
 * assetLoader.js
 *
 * Loads the AI-generated image asset pack from /assets/.
 *
 * For each manifest entry:
 *   1. Try to load /assets/<filename>.
 *   2. If that succeeds, run it through imageToAsset() to produce the
 *      canonical record.
 *   3. If it fails (image not yet generated), fall back to the procedural
 *      voxel builder so the editor still functions during dev.
 *
 * The eventual goal is for every entry to have a real image so the fallback
 * path is never taken at runtime.
 */

import { ASSET_MANIFEST } from './assetManifest.js';
import { imageToAsset, loadImageElement } from './imageToAsset.js';
import { renderVoxels } from './voxelRenderer.js';

let _assets = null;

/**
 * Quality knobs for asset pre-rendering.
 *
 * DISPLAY_SUPERSAMPLE: how many times the asset's display (CSS) size we
 *   bake into the per-asset draw canvas. The renderer always blits this
 *   canvas at the asset's display size, so the only resampling left at
 *   runtime is from `displayCanvas.size` (≈ display × SUPERSAMPLE) down to
 *   the on-screen pixel size at the current camera zoom × devicePixelRatio.
 *
 *   The effective worst-case factor we need to cover is
 *   `maxZoom × devicePixelRatio` (3.0 × 2 = 6 on a typical retina). We
 *   set SUPERSAMPLE to that max and let `buildDisplayCanvas` cap to the
 *   source PNG size so we never burn memory rendering above the source's
 *   own resolution. Result: assets stay pixel-sharp at every zoom level
 *   on retina, and the per-frame draw is still just a fast intermediate
 *   blit instead of a 2k-wide PNG downsample.
 *
 * SHADOW_SUPERSAMPLE / SHADOW_BLUR_PX: shadows are projected then blurred
 *   at draw time. We pre-blur a smaller silhouette once at load time and
 *   then just blit it transformed per frame, so the slow `ctx.filter`
 *   blur path is gone from the render loop entirely.
 */
const DEFAULT_DPR = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
const MAX_ZOOM    = 3.0;
const DISPLAY_SUPERSAMPLE = Math.max(2, Math.ceil(MAX_ZOOM * DEFAULT_DPR));
// Shadow used to be hard-coded to 1 — the upstream's perf bet that no
// one would notice. On DPR=3 phones that meant the shadow buffer was a
// quarter the device-pixel resolution of the main sprite, so each
// shadow pixel got stretched 3× → visible terracing.
//
// Tracking DPR keeps the shadow buffer at the same device-pixel
// density as the sprite it sits under. Blur radius is scaled with it
// so the soft edge stays the same width in CSS px regardless of DPR.
// Pre-blur happens once at load time, so the per-frame draw is still
// a flat drawImage — no runtime cost.
const SHADOW_SUPERSAMPLE  = Math.max(1, Math.ceil(DEFAULT_DPR));
const SHADOW_BLUR_PX      = 6 * SHADOW_SUPERSAMPLE;

/**
 * Pre-render an asset's source canvas down to a draw-ready canvas at the
 * asset's display resolution × SUPERSAMPLE. The render loop later blits
 * this canvas at `(width, height)` regardless of camera zoom, so the
 * browser only ever resamples a small intermediate instead of the full
 * 1k–2k px PNG, and only does it once per zoom-change effectively.
 *
 * Returns the original canvas as-is when the source is already small
 * enough — pre-rendering would be a net loss in that case.
 */
function buildDisplayCanvas(srcCanvas, displayW, displayH) {
    if (!srcCanvas || !srcCanvas.width || !srcCanvas.height) return srcCanvas;
    const targetW = Math.max(1, Math.ceil(displayW * DISPLAY_SUPERSAMPLE));
    const targetH = Math.max(1, Math.ceil(displayH * DISPLAY_SUPERSAMPLE));
    if (targetW >= srcCanvas.width && targetH >= srcCanvas.height) {
        // Source isn't bigger than the supersampled draw size, so the
        // browser would be upsampling either way. Skip the extra canvas.
        return srcCanvas;
    }
    const out = document.createElement('canvas');
    out.width  = targetW;
    out.height = targetH;
    const ctx = out.getContext('2d');
    if (!ctx) return srcCanvas;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(srcCanvas, 0, 0, targetW, targetH);
    return out;
}

/**
 * Build a black silhouette of an asset canvas for use as a cast shadow,
 * pre-resampled to display resolution and pre-blurred so the per-frame
 * shadow pass is just a transformed `drawImage` (no `ctx.filter` blur,
 * no full-resolution silhouette upload to the GPU each frame).
 */
function buildShadowCanvas(srcCanvas, displayW, displayH) {
    if (!srcCanvas || !srcCanvas.width || !srcCanvas.height) return null;
    const targetW = Math.max(1, Math.ceil(displayW * SHADOW_SUPERSAMPLE));
    const targetH = Math.max(1, Math.ceil(displayH * SHADOW_SUPERSAMPLE));
    const pad = Math.ceil(SHADOW_BLUR_PX * 2.5);
    const w = targetW + pad * 2;
    const h = targetH + pad * 2;

    const tmp = document.createElement('canvas');
    tmp.width  = w;
    tmp.height = h;
    const tctx = tmp.getContext('2d');
    if (!tctx) return null;
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(srcCanvas, pad, pad, targetW, targetH);
    tctx.globalCompositeOperation = 'source-in';
    tctx.fillStyle = '#000';
    tctx.fillRect(0, 0, w, h);

    // The renderer expects `padding` / `width` / `height` in *display
    // (CSS) px* — it scales the buffer at draw time via drawImage. So
    // we convert the supersampled buffer figures back down by
    // SUPERSAMPLE here. When SUPERSAMPLE was hard-coded to 1 they were
    // identical and nobody noticed; with DPR-tracking SUPERSAMPLE the
    // conversion becomes load-bearing.
    const cssPad     = pad     / SHADOW_SUPERSAMPLE;
    const cssTargetW = targetW / SHADOW_SUPERSAMPLE;
    const cssTargetH = targetH / SHADOW_SUPERSAMPLE;

    // We used to delegate the blur to `ctx.filter = blur(Npx)` once at
    // load time. That works fine on desktop Chrome but iOS Safari's
    // canvas-filter implementation is quality-degraded — for a black
    // silhouette it effectively box-blurs at a stride that leaves
    // visible terracing at high DPR (the "梯田" the user reported).
    //
    // Switch to a pure-JS three-pass box blur on the alpha channel.
    // Three boxes ≈ a Gaussian; the silhouette is single-channel
    // (alpha) so we don't pay for RGB work. Cost: O(W·H) for an
    // entire screen of shadows once at load. Cross-browser identical.
    boxBlurAlpha(tctx, w, h, SHADOW_BLUR_PX);
    return { canvas: tmp, padding: cssPad, width: cssTargetW, height: cssTargetH, blurred: true };
}

/**
 * In-place three-pass box blur on a canvas context's alpha channel.
 * Used for shadow silhouettes (R/G/B are constant — we only care about
 * alpha). Three boxes of width ~radius gives a near-Gaussian falloff.
 *
 * Radius here is the Gaussian sigma equivalent; we convert to box width
 * via the well-known `sqrt(12*sigma^2/3 + 1)` formula.
 */
function boxBlurAlpha(ctx, w, h, radius) {
    if (radius < 1) return;
    const img = ctx.getImageData(0, 0, w, h);
    const a = new Uint8ClampedArray(w * h);
    for (let i = 0; i < a.length; i++) a[i] = img.data[i * 4 + 3];

    // Two scratch buffers + the source, rotated round-robin to avoid
    // any aliasing between src/dst in the inner passes.
    const buffers = [a, new Uint8ClampedArray(a.length), new Uint8ClampedArray(a.length)];
    let srcIdx = 0;
    const boxes = boxesForGauss(radius, 3);
    for (const bw of boxes) {
        const r = (bw - 1) >> 1;
        const midIdx = (srcIdx + 1) % 3;
        boxBlurH(buffers[srcIdx], buffers[midIdx], w, h, r);
        const dstIdx = (midIdx + 1) % 3;
        boxBlurV(buffers[midIdx], buffers[dstIdx], w, h, r);
        srcIdx = dstIdx;
    }
    const final = buffers[srcIdx];
    for (let i = 0; i < final.length; i++) img.data[i * 4 + 3] = final[i];
    ctx.putImageData(img, 0, 0);
}

function boxesForGauss(sigma, n) {
    const wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
    let wl = Math.floor(wIdeal); if ((wl & 1) === 0) wl--;
    const wu = wl + 2;
    const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
    const m = Math.round(mIdeal);
    const out = [];
    for (let i = 0; i < n; i++) out.push(i < m ? wl : wu);
    return out;
}

function boxBlurH(src, dst, w, h, r) {
    const norm = 1 / (r + r + 1);
    for (let i = 0; i < h; i++) {
        let ti = i * w;
        let li = ti;
        let ri = ti + r;
        const fv = src[ti];
        const lv = src[ti + w - 1];
        let val = (r + 1) * fv;
        for (let j = 0; j < r; j++) val += src[ti + j];
        for (let j = 0; j <= r; j++) { val += src[ri++] - fv; dst[ti++] = val * norm; }
        for (let j = r + 1; j < w - r; j++) { val += src[ri++] - src[li++]; dst[ti++] = val * norm; }
        for (let j = w - r; j < w; j++) { val += lv - src[li++]; dst[ti++] = val * norm; }
    }
}

function boxBlurV(src, dst, w, h, r) {
    const norm = 1 / (r + r + 1);
    for (let i = 0; i < w; i++) {
        let ti = i;
        let li = ti;
        let ri = ti + r * w;
        const fv = src[ti];
        const lv = src[ti + w * (h - 1)];
        let val = (r + 1) * fv;
        for (let j = 0; j < r; j++) val += src[ti + j * w];
        for (let j = 0; j <= r; j++) { val += src[ri] - fv; dst[ti] = val * norm; ri += w; ti += w; }
        for (let j = r + 1; j < h - r; j++) { val += src[ri] - src[li]; dst[ti] = val * norm; li += w; ri += w; ti += w; }
        for (let j = h - r; j < h; j++) { val += lv - src[li]; dst[ti] = val * norm; li += w; ti += w; }
    }
}

/**
 * Find left/right foot points for low contact-shadow assets such as fences.
 * We look for tall opaque column clusters (the posts) and return their
 * bottom-center points scaled into the final draw size.
 */
function buildContactPoints(srcCanvas, displayW, displayH) {
    if (!srcCanvas || !srcCanvas.width || !srcCanvas.height) return [];
    const w = srcCanvas.width;
    const h = srcCanvas.height;
    const ctx = srcCanvas.getContext('2d');
    if (!ctx) return [];

    let data;
    try {
        data = ctx.getImageData(0, 0, w, h).data;
    } catch {
        return [];
    }

    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 20) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
    }
    if (maxX < minX || maxY < minY) return [];

    const visibleH = maxY - minY + 1;
    const threshold = visibleH * 0.45;
    const runs = [];
    let runStart = -1;
    for (let x = minX; x <= maxX; x++) {
        let count = 0;
        for (let y = minY; y <= maxY; y++) {
            if (data[(y * w + x) * 4 + 3] > 20) count++;
        }
        if (count >= threshold && runStart < 0) runStart = x;
        if ((count < threshold || x === maxX) && runStart >= 0) {
            const end = count < threshold ? x - 1 : x;
            if (end - runStart >= 5) runs.push({ start: runStart, end });
            runStart = -1;
        }
    }
    if (runs.length < 2) return [];

    const postRuns = [runs[0], runs[runs.length - 1]];
    const sx = displayW / w;
    const sy = displayH / h;
    return postRuns.map(run => {
        let bottomY = minY;
        for (let y = minY; y <= maxY; y++) {
            for (let x = run.start; x <= run.end; x++) {
                if (data[(y * w + x) * 4 + 3] > 20) {
                    if (y > bottomY) bottomY = y;
                    break;
                }
            }
        }
        return {
            x: ((run.start + run.end) / 2) * sx,
            y: bottomY * sy,
        };
    });
}

export async function loadAssets(onProgress = () => {}) {
    if (_assets) return _assets;
    const out = {};
    const total = ASSET_MANIFEST.length;
    let imageCount = 0;
    let fallbackCount = 0;

    for (let i = 0; i < total; i++) {
        const entry = ASSET_MANIFEST[i];
        const meta = {
            id: entry.id,
            name: entry.name,
            category: entry.category,
            kind: entry.kind,
            footprint: entry.footprint,
            tileLike: entry.tileLike === true,
            noShadow: entry.noShadow === true,
            flatBase: entry.flatBase === true,
            shadowStyle: entry.shadowStyle ?? 'cast',
        };

        let record = null;

        if (entry.filename) {
            try {
                const img = await loadImageElement(`assets/${entry.filename}`);
                record = imageToAsset(img, entry.footprint, entry.kind, {
                    sizeScale: entry.sizeScale ?? 1,
                    tileLike:  entry.tileLike === true,
                    fitCell:   entry.fitCell === true,
                    flatBase:  entry.flatBase === true,
                });
                record.source = 'image';
                imageCount++;
            } catch {
                /* fall through to procedural fallback */
            }
        }

        if (!record && entry.builder) {
            const voxels = entry.builder();
            record = renderVoxels(voxels, entry.footprint);
            record.source = 'procedural';
            fallbackCount++;
        }

        if (record) {
            // Pre-render a draw-ready canvas at display resolution so the
            // per-frame `drawImage` no longer downsamples a multi-megabyte
            // PNG every frame.
            record.displayCanvas = buildDisplayCanvas(
                record.canvas, record.width, record.height,
            );

            out[entry.id] = { ...meta, ...record };

            // Pre-render a silhouette shadow for objects that should cast a
            // ground shadow. Tile-like assets (terrain) and assets that bake
            // their own shadow into the PNG opt out via the manifest.
            if (
                entry.kind === 'object'
                && !meta.tileLike
                && !meta.noShadow
                && record.canvas
            ) {
                const shadow = buildShadowCanvas(record.canvas, record.width, record.height);
                if (shadow) {
                    out[entry.id].shadowCanvas  = shadow.canvas;
                    out[entry.id].shadowPadding = shadow.padding;
                    out[entry.id].shadowWidth   = shadow.width;
                    out[entry.id].shadowHeight  = shadow.height;
                    out[entry.id].shadowBlurred = shadow.blurred;
                }
                if (meta.shadowStyle === 'contact') {
                    out[entry.id].contactPoints = buildContactPoints(
                        record.canvas,
                        record.width,
                        record.height,
                    );
                }
            }
        }

        onProgress((i + 1) / total, entry.name);
        // Yield a frame periodically so the loading UI can paint. More
        // frequent than before (every asset) to keep the bar smooth even
        // though each step now does extra pre-render work.
        if (i % 2 === 0) await new Promise(r => requestAnimationFrame(r));
    }

    if (fallbackCount > 0) {
        console.info(`[assets] loaded ${imageCount} images, ${fallbackCount} procedural fallbacks.`);
    } else {
        console.info(`[assets] loaded ${imageCount} images (full pack).`);
    }

    _assets = out;
    return _assets;
}

export function getAsset(id) {
    if (!_assets) throw new Error('Assets not yet loaded');
    const a = _assets[id];
    if (!a) console.warn(`Unknown asset id: ${id}`);
    return a;
}

export function allAssets() {
    if (!_assets) throw new Error('Assets not yet loaded');
    return _assets;
}
