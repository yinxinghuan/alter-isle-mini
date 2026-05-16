/**
 * UIManager.js — mobile-first variant.
 *
 * Owns the bottom dock (category tabs + swatch scroller) and the top-left
 * "•••" settings popover (grid / shadows / fill-grass / reset).
 *
 * No left toolbar, no right palette, no HUD, no instructions panel —
 * those were all desktop affordances. On mobile every gesture is direct:
 * tap to place, long-press to erase, pinch + two-finger drag for camera.
 */

import { BottomDock } from './BottomDock.js';
import { playUiClick } from './Audio.js';

export class UIManager {
    constructor(game) {
        this.game = game;
        this.dock = new BottomDock(
            document.getElementById('dock-tabs'),
            document.getElementById('dock-swatches'),
            game,
        );
        this.toast = document.getElementById('toast');

        this._wireSettings();

        // Expose for sibling modules.
        game.dock = this.dock;
    }

    _wireSettings() {
        const btn = document.getElementById('settings-btn');
        const pop = document.getElementById('settings-pop');
        if (!btn || !pop) return;
        this.settingsBtn = btn;
        this.settingsPop = pop;

        const close = () => {
            pop.classList.add('hidden');
            btn.classList.remove('open');
        };
        const open = () => {
            pop.classList.remove('hidden');
            btn.classList.add('open');
            this._syncSettings();
        };

        btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            playUiClick();
            if (pop.classList.contains('hidden')) open();
            else close();
        });

        // Tap anywhere outside the popover (incl. the canvas) closes it.
        // We listen on document with the capture phase so the popover's
        // own button taps stop propagation first.
        document.addEventListener('pointerdown', (e) => {
            if (pop.classList.contains('hidden')) return;
            if (pop.contains(e.target) || btn.contains(e.target)) return;
            close();
        }, true);

        pop.addEventListener('pointerdown', (e) => e.stopPropagation());

        for (const item of pop.querySelectorAll('button')) {
            item.addEventListener('click', () => {
                playUiClick();
                const action = item.dataset.action;
                switch (action) {
                    case 'grid':    this.game.toggleGrid();    this._syncSettings(); break;
                    case 'shadows': this.game.toggleShadows(); this._syncSettings(); break;
                    case 'fill':    this.game.fillGrass();     close(); break;
                    case 'reset':   this.game.reset();         close(); break;
                }
            });
        }
    }

    _syncSettings() {
        const r = this.game.renderer;
        for (const item of this.settingsPop.querySelectorAll('button')) {
            const action = item.dataset.action;
            if (action === 'grid')         item.classList.toggle('active', !!r.showGrid);
            else if (action === 'shadows') item.classList.toggle('active', !!r.ambientOcclusion);
        }
    }

    update() {
        this.dock.update();
    }

    showToast(text, ms = 1600) {
        if (!this.toast) return;
        this.toast.textContent = text;
        this.toast.classList.add('show');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            this.toast.classList.remove('show');
        }, ms);
    }
}
