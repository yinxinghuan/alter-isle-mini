/**
 * Game.js
 *
 * Top-level game controller. Owns the world (TileMap), camera, renderer,
 * input manager, placement system, and UI. Exposes a small intent API
 * (setTool, selectAsset, save, reset, …) consumed by the UI.
 */

import { CONFIG } from '../config.js';
import { Camera } from './Camera.js';
import { Renderer } from './Renderer.js';
import { InputManager } from './InputManager.js';
import { TileMap } from '../grid/TileMap.js';
import { PlacementSystem } from '../building/PlacementSystem.js';
import { ASSET_INDEX, ASSET_MANIFEST } from '../assets/assetManifest.js';
import { SaveSystem } from '../storage/SaveSystem.js';
import { cellToScreen } from '../grid/IsoGrid.js';
import { playPlacementFor } from '../ui/Audio.js';

// Pick `n` distinct elements from `arr` uniformly at random. Used by
// the scene randomizer to choose which edges become sea.
function pickN(arr, n) {
    const pool = arr.slice();
    const out = [];
    while (out.length < n && pool.length > 0) {
        out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    return out;
}

export class Game {
    constructor(canvas, ui = null) {
        this.canvas = canvas;
        this.tileMap = new TileMap();
        this.camera = new Camera();
        this.renderer = new Renderer(canvas, this.camera, this.tileMap);
        this.placement = new PlacementSystem(this.tileMap);
        this.input = new InputManager(canvas, this.camera, this);

        // Any camera mutation (pan/zoom/recenter) needs the next frame
        // re-rendered. The renderer itself is otherwise idle.
        this.camera.onChange(() => this.renderer.markDirty());

        // Default selection
        this.tool = 'place';                  // 'place' | 'erase' | 'pan'
        this.category = 'ground';
        this.selectedAssetId = ASSET_MANIFEST.find(a => a.category === 'ground').id;
        this.ui = ui;

        // Preview-only flip state for the current selection. Toggled by the
        // user (H / V) before commit; the values are baked into the
        // PlacedObject when the asset is placed.
        this.flipH = false;
        this.flipV = false;

        // Center camera over grid
        this._centerCamera();

        // Animation loop
        this._loop = this._loop.bind(this);
        requestAnimationFrame(this._loop);
    }

    _centerCamera() {
        const c = cellToScreen(this.tileMap.width / 2, this.tileMap.height / 2);
        const { innerWidth: w, innerHeight: h } = window;
        this.camera.centerOn(c.x, c.y, w, h);
    }

    /* ── Intents from UI / input ──────────────────────────────── */

    setTool(t) {
        this.tool = t;
        this.renderer.eraseMode = (t === 'erase');
        this.canvas.style.cursor = t === 'pan' ? 'grab'
                                  : t === 'erase' ? 'crosshair'
                                  : 'crosshair';
        this.renderer.markDirty();
        this.ui?.update();
    }

    setCategory(cat) {
        if (this.category === cat) return;
        this.category = cat;
        // Auto-select first asset of that category.
        const first = ASSET_MANIFEST.find(a => a.category === cat);
        if (first) this.selectedAssetId = first.id;
        this._resetFlip();
        this.renderer.markDirty();
        this.ui?.update();
    }

    selectAsset(id) {
        const a = ASSET_INDEX[id];
        if (!a) return;
        const changed = this.selectedAssetId !== id;
        this.selectedAssetId = id;
        this.category = a.category;
        if (changed) this._resetFlip();
        // Picking a swatch always implies the player wants to build — pull
        // them out of pan / erase so the very next tap places the piece.
        if (this.tool !== 'place') this.setTool('place');
        this.renderer.markDirty();
        this.ui?.update();
    }

    toggleFlipH() {
        this.flipH = !this.flipH;
        this._syncPreviewFlip();
        this.renderer.markDirty();
        this.ui?.showToast('Rotated');
        this.ui?.update();
    }

    toggleFlipV() {
        this.flipV = !this.flipV;
        this._syncPreviewFlip();
        this.renderer.markDirty();
        this.ui?.showToast(`Flip vertical: ${this.flipV ? 'on' : 'off'}`);
        this.ui?.update();
    }

    _resetFlip() {
        this.flipH = false;
        this.flipV = false;
        this._syncPreviewFlip();
    }

    _syncPreviewFlip() {
        this.renderer.previewFlipH = this.flipH;
        this.renderer.previewFlipV = this.flipV;
    }

    toggleGrid() {
        this.renderer.showGrid = !this.renderer.showGrid;
        this.renderer.markDirty();
        this.ui?.update();
    }

    toggleShadows() {
        this.renderer.ambientOcclusion = !this.renderer.ambientOcclusion;
        this.renderer.markDirty();
        this.ui?.update();
    }

    /**
     * Debounced background save. On mobile there's no manual Save button —
     * every place / erase / reset / fill is committed after a short idle
     * window so the user's work survives an accidental refresh or app
     * switch. 600ms is long enough to coalesce a brush-painted stroke into
     * one localStorage write but short enough that a single tap-then-leave
     * still makes it to disk.
     */
    requestAutoSave() {
        clearTimeout(this._autoSaveTimer);
        this._autoSaveTimer = setTimeout(() => {
            SaveSystem.save(this.tileMap, this.camera);
        }, 600);
    }

    save() {
        const ok = SaveSystem.save(this.tileMap, this.camera);
        this.ui?.showToast(ok ? 'Saved your island' : 'Save failed');
    }

    load() {
        const ok = SaveSystem.load(this.tileMap, this.camera);
        if (ok) this.renderer.markDirty();
        return ok;
    }

    reset() {
        this.tileMap.clearAll();
        SaveSystem.clear();
        this._centerCamera();
        this.renderer.markDirty();
        this.ui?.showToast('World reset');
    }

    /**
     * Re-roll the whole island in one tap. Wipes the existing world,
     * lays down a fresh terrain composition with a beach + sea border,
     * scatters trees, props, and buildings, then triggers an auto-save.
     *
     * The composition uses the same staggered diagonal reveal as the
     * first-run starter scene so it feels coherent visually, but every
     * material and placement is randomised.
     */
    randomizeScene() {
        const W = this.tileMap.width;
        const H = this.tileMap.height;

        // Wipe — every cell, every object — so the new world doesn't
        // overlap leftover footprints.
        this.tileMap.clearAll();

        const STEP_MS = 24;
        const tDelay = (gx, gy) => (gx + gy) * STEP_MS;
        const oDelay = (gx, gy) => (gx + gy) * STEP_MS + 80;

        // 1) Choose two edges to be sea. The other two edges get a sand
        //    beach strip. This keeps the island visually "afloat" without
        //    every roll looking the same.
        const seaEdges = pickN(['top', 'bottom', 'left', 'right'], 2);
        const isSea = (gx, gy) =>
            (seaEdges.includes('top')    && gy === 0)
         || (seaEdges.includes('bottom') && gy === H - 1)
         || (seaEdges.includes('left')   && gx === 0)
         || (seaEdges.includes('right')  && gx === W - 1);
        const isBeach = (gx, gy) => {
            if (isSea(gx, gy)) return false;
            return (seaEdges.includes('top')    && gy === 1)
                || (seaEdges.includes('bottom') && gy === H - 2)
                || (seaEdges.includes('left')   && gx === 1)
                || (seaEdges.includes('right')  && gx === W - 2);
        };

        // 2) Carve 1–2 path streaks for character. A streak is a random
        //    walk that meanders 4–8 tiles inland from a non-sea edge.
        const pathCells = new Set();
        const streaks = 1 + Math.floor(Math.random() * 2);
        for (let s = 0; s < streaks; s++) {
            let len = 4 + Math.floor(Math.random() * 5);
            let x = 2 + Math.floor(Math.random() * (W - 4));
            let y = 2 + Math.floor(Math.random() * (H - 4));
            for (let i = 0; i < len; i++) {
                if (x > 1 && x < W - 2 && y > 1 && y < H - 2) {
                    pathCells.add(`${x},${y}`);
                }
                if (Math.random() < 0.5) x += (Math.random() < 0.5 ? -1 : 1);
                else                     y += (Math.random() < 0.5 ? -1 : 1);
            }
        }

        // 3) Lay down terrain over the whole grid.
        for (let gy = 0; gy < H; gy++)
        for (let gx = 0; gx < W; gx++) {
            let id;
            if (isSea(gx, gy))          id = 'water';
            else if (isBeach(gx, gy))   id = 'sand';
            else if (pathCells.has(`${gx},${gy}`)) id = 'path';
            else                        id = 'grass';
            this.placeAndAnimate(id, gx, gy, { delay: tDelay(gx, gy) });
        }

        // 4) Drop a handful of buildings on big interior tiles. A
        //    building's full footprint must fit inside the inland area
        //    and not overlap a path/beach/sea cell.
        const BUILDINGS = ['house', 'two_story', 'cube_house', 'villa', 'main_chapel', 'windmill'];
        const occupied = new Set(); // already-claimed cell keys
        for (const k of pathCells) occupied.add(k);
        const buildingCount = 2 + Math.floor(Math.random() * 3); // 2-4
        let placed = 0;
        for (let attempt = 0; attempt < 60 && placed < buildingCount; attempt++) {
            const id = BUILDINGS[Math.floor(Math.random() * BUILDINGS.length)];
            const def = ASSET_INDEX[id];
            if (!def) continue;
            const fw = def.footprint?.w ?? 1;
            const fd = def.footprint?.d ?? 1;
            // Inland-only: leave a 2-cell margin from grid edges + beach
            const gx = 2 + Math.floor(Math.random() * (W - fw - 3));
            const gy = 2 + Math.floor(Math.random() * (H - fd - 3));
            let ok = true;
            for (let dy = 0; dy < fd && ok; dy++)
            for (let dx = 0; dx < fw && ok; dx++) {
                const k = `${gx + dx},${gy + dy}`;
                if (occupied.has(k)) ok = false;
                if (isBeach(gx + dx, gy + dy) || isSea(gx + dx, gy + dy)) ok = false;
            }
            if (!ok) continue;
            for (let dy = 0; dy < fd; dy++)
            for (let dx = 0; dx < fw; dx++) {
                occupied.add(`${gx + dx},${gy + dy}`);
            }
            this.placeAndAnimate(id, gx, gy, { delay: oDelay(gx, gy) });
            placed++;
        }

        // 5) Scatter trees and small props on free grass cells.
        const TREES = ['cypress', 'olive', 'bougainvillea', 'agave', 'dry_grass'];
        const PROPS = ['flower_pot', 'terracotta_pot', 'lantern_post', 'stone_lantern',
                       'bench', 'banner', 'crate', 'hay_bale', 'large_rock'];
        const scatterCount = 14 + Math.floor(Math.random() * 8); // 14-21
        for (let i = 0; i < scatterCount; i++) {
            const gx = 1 + Math.floor(Math.random() * (W - 2));
            const gy = 1 + Math.floor(Math.random() * (H - 2));
            const k = `${gx},${gy}`;
            if (occupied.has(k)) continue;
            if (isBeach(gx, gy) || isSea(gx, gy)) continue;
            const pool = Math.random() < 0.6 ? TREES : PROPS;
            const id = pool[Math.floor(Math.random() * pool.length)];
            occupied.add(k);
            this.placeAndAnimate(id, gx, gy, { delay: oDelay(gx, gy) });
        }

        this.ui?.showToast('Re-rolled the island');
        this.requestAutoSave();
    }

    /**
     * Carpet the entire grid with grass in one click. Empty cells get a
     * fresh grass tile; cells whose terrain is already something else
     * (path, sand, water) are left alone so the user doesn't lose any
     * intentional terrain work. Each tile is queued through the same
     * staggered animation pipeline as the starter scene so the fill
     * ripples diagonally across the island instead of snapping in flat.
     *
     * Returns the number of cells that were actually filled.
     */
    fillGrass() {
        const W = this.tileMap.width;
        const H = this.tileMap.height;
        // Same wave timing as the starter scene reveal so the two feel
        // like one consistent visual language.
        const STEP_MS = 32;
        let filled = 0;
        for (let gy = 0; gy < H; gy++)
        for (let gx = 0; gx < W; gx++) {
            if (this.tileMap.getTerrain(gx, gy)) continue;
            if (this.placeAndAnimate('grass', gx, gy, { delay: (gx + gy) * STEP_MS })) {
                filled++;
            }
        }
        if (filled > 0) {
            // One sound at the start; the per-tile placement audio path
            // would fire ~196 times in a fraction of a second otherwise.
            playPlacementFor('grass');
            this.ui?.showToast(`Filled ${filled} ${filled === 1 ? 'tile' : 'tiles'} with grass`);
            this.requestAutoSave();
        } else {
            this.ui?.showToast('Grid already covered');
        }
        return filled;
    }

    /* ── Mouse callbacks (called by InputManager) ─────────────── */

    onHover(cell) {
        const prev = this.renderer.hoverCell;
        const sameCell = prev && prev.gx === cell.gx && prev.gy === cell.gy;
        this.renderer.hoverCell = cell;
        if (this.tool === 'erase') {
            this.renderer.previewAssetId = null;
            this.renderer.previewValid = !!this.tileMap.objectAt(cell.gx, cell.gy)
                || !!this.tileMap.getTerrain(cell.gx, cell.gy);
        } else if (this.tool === 'place') {
            this.renderer.previewAssetId = this.selectedAssetId;
            this.renderer.previewValid = this.placement.canPlace(this.selectedAssetId, cell.gx, cell.gy);
        } else {
            this.renderer.previewAssetId = null;
            this.renderer.previewValid = true;
        }
        // Only invalidate the next frame when the highlighted cell or its
        // validity actually changed. Hover events fire on every mousemove
        // pixel, so this matters.
        if (!sameCell) this.renderer.markDirty();
    }

    onPrimaryClick(gx, gy) {
        if (!this.tileMap.inBounds(gx, gy)) return;
        if (this.tool === 'erase') {
            // Capture what's about to be removed so we can pick the right
            // SFX (water erase splashes, everything else thuds).
            const objHere = this.tileMap.objectAt(gx, gy);
            const terrainHere = this.tileMap.getTerrain(gx, gy);
            const targetId = objHere ? objHere.assetId : terrainHere;
            if (this.placement.erase(gx, gy)) {
                this.renderer.markDirty();
                playPlacementFor(targetId);
                this.requestAutoSave();
            }
        } else if (this.tool === 'place') {
            const result = this.placement.place(this.selectedAssetId, gx, gy, {
                flipH: this.flipH,
                flipV: this.flipV,
            });
            if (result?.kind === 'object') {
                const o = result.object;
                this.renderer.spawnAnim(`obj-${o.id}`, {
                    gx: o.gx,
                    gy: o.gy,
                    w: o.footprint?.w ?? 1,
                    d: o.footprint?.d ?? 1,
                });
                playPlacementFor(o.assetId);
                this.requestAutoSave();
            } else if (result?.kind === 'terrain') {
                this.renderer.spawnAnim(`t-${result.gx},${result.gy}`, {
                    gx: result.gx,
                    gy: result.gy,
                    w: 1,
                    d: 1,
                });
                playPlacementFor(result.assetId);
                this.requestAutoSave();
            }
        }
    }

    onSecondaryClick(gx, gy) {
        // Long-press / right click always erases. Same code path as the
        // primary-click erase branch, plus auto-save.
        if (!this.tileMap.inBounds(gx, gy)) return;
        const objHere = this.tileMap.objectAt(gx, gy);
        const terrainHere = this.tileMap.getTerrain(gx, gy);
        const targetId = objHere ? objHere.assetId : terrainHere;
        if (this.placement.erase(gx, gy)) {
            this.renderer.markDirty();
            playPlacementFor(targetId);
            this.requestAutoSave();
        }
    }

    /**
     * Place an asset and queue its elastic placement animation, optionally
     * delayed by `opts.delay` milliseconds. Used by the starter-scene
     * reveal to ripple the seeded village in back-to-front so first-run
     * players see the world build itself instead of just appearing.
     *
     * Returns the placement result (or null if the placement was rejected).
     */
    placeAndAnimate(assetId, gx, gy, opts = {}) {
        const result = this.placement.place(assetId, gx, gy, {
            flipH: !!opts.flipH,
            flipV: !!opts.flipV,
        });
        if (!result) return null;
        const startAt = performance.now() + (opts.delay ?? 0);
        const duration = opts.duration ?? 460;
        if (result.kind === 'object') {
            const o = result.object;
            this.renderer.spawnAnim(`obj-${o.id}`, {
                gx: o.gx,
                gy: o.gy,
                w: o.footprint?.w ?? 1,
                d: o.footprint?.d ?? 1,
            }, duration, startAt);
        } else if (result.kind === 'terrain') {
            this.renderer.spawnAnim(`t-${result.gx},${result.gy}`, {
                gx: result.gx,
                gy: result.gy,
                w: 1,
                d: 1,
            }, duration, startAt);
        }
        return result;
    }

    /* ── Frame loop ───────────────────────────────────────────── */

    _loop() {
        // The renderer skips its own work when nothing has changed and
        // there are no animations running, so this loop is effectively
        // free at idle. We still keep `requestAnimationFrame` ticking so
        // we resume instantly when input or animations resume.
        this.renderer.draw();
        requestAnimationFrame(this._loop);
    }
}
