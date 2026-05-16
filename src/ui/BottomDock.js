/**
 * BottomDock.js — mobile asset picker.
 *
 * Category tabs (3 chips) above a horizontal swatch scroller. Tapping a
 * swatch selects the asset and switches the game into place mode. The
 * dock is the *only* persistent UI surface in mini — there's no toolbar,
 * no palette panel, no HUD.
 *
 * Each swatch renders the asset's generated bitmap so the player sees
 * exactly what they'll be placing — no abstract icons.
 */

import { ASSET_MANIFEST, CATEGORIES } from '../assets/assetManifest.js';
import { allAssets } from '../assets/assetLoader.js';
import { playUiClick } from './Audio.js';

const CATEGORY_LABEL = {
    ground: 'Ground',
    nature: 'Nature',
    build:  'Build',
};

export class BottomDock {
    constructor(tabsEl, swatchesEl, game) {
        this.tabsEl = tabsEl;
        this.swatchesEl = swatchesEl;
        this.game = game;
        this.tabButtons = new Map();
        this._buildTabs();
        this._renderSwatches();
    }

    _buildTabs() {
        this.tabsEl.innerHTML = '';
        for (const c of CATEGORIES) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tab';
            btn.textContent = CATEGORY_LABEL[c] || c;
            btn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                playUiClick();
                this.game.setCategory(c);
                // Snap the horizontal scroller back to the start when
                // switching tabs — otherwise the previous category's
                // scroll position lingers and the user thinks they got
                // an empty section.
                this.swatchesEl.scrollLeft = 0;
            });
            this.tabsEl.appendChild(btn);
            this.tabButtons.set(c, btn);
        }
        this.update();
    }

    _renderSwatches() {
        this.swatchesEl.innerHTML = '';
        const generated = allAssets();
        const items = ASSET_MANIFEST.filter(a => a.category === this.game.category);
        for (const def of items) {
            const swatch = document.createElement('button');
            swatch.type = 'button';
            swatch.className = 'swatch';
            swatch.dataset.assetId = def.id;

            const gen = generated[def.id];
            if (gen) {
                const img = document.createElement('canvas');
                const max = 56;
                const scale = Math.min(max / gen.width, max / gen.height, 2);
                img.width  = Math.ceil(gen.width  * scale);
                img.height = Math.ceil(gen.height * scale);
                const ctx = img.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(gen.canvas, 0, 0, img.width, img.height);
                swatch.appendChild(img);
            }

            const name = document.createElement('span');
            name.className = 'name';
            name.textContent = def.name;
            swatch.appendChild(name);

            swatch.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                playUiClick();
                this.game.selectAsset(def.id);
            });
            this.swatchesEl.appendChild(swatch);
        }
        this.update();
    }

    update() {
        for (const [c, btn] of this.tabButtons) {
            btn.classList.toggle('active', c === this.game.category);
        }
        const visibleIds = Array.from(this.swatchesEl.querySelectorAll('.swatch'))
            .map(el => el.dataset.assetId);
        const expectedIds = ASSET_MANIFEST
            .filter(a => a.category === this.game.category)
            .map(a => a.id);
        const sameSet = visibleIds.length === expectedIds.length
            && visibleIds.every((id, i) => id === expectedIds[i]);
        if (!sameSet) this._renderSwatches();

        for (const sw of this.swatchesEl.querySelectorAll('.swatch')) {
            sw.classList.toggle('selected', sw.dataset.assetId === this.game.selectedAssetId);
        }
    }
}
