/**
 * UIManager.js — mobile-first variant.
 *
 * Owns:
 *   • Bottom dock (category tabs + swatch scroller)
 *   • Top toolbar (build/pan/erase mode + rotate action)
 *   • Top-left "•••" settings popover (grid / shadows / fill / reset)
 *   • First-run hint card (shown once per browser, dismissible)
 *
 * No keyboard, no flip-preview menu, no manual Save button. The toolbar
 * mode and the dock are the two persistent UI surfaces.
 */

import { BottomDock } from './BottomDock.js';
import { playUiClick } from './Audio.js';

const HINT_SEEN_KEY = 'alteru.alter-isle-mini.hint.seen';

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
        this._wireToolbar();
        this._wireHintCard();

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

        // Outside-click closes the popover. Capture phase so the popover
        // buttons stop propagation first.
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
        if (!this.settingsPop) return;
        const r = this.game.renderer;
        for (const item of this.settingsPop.querySelectorAll('button')) {
            const action = item.dataset.action;
            if (action === 'grid')         item.classList.toggle('active', !!r.showGrid);
            else if (action === 'shadows') item.classList.toggle('active', !!r.ambientOcclusion);
        }
    }

    _wireToolbar() {
        const modeBtns = Array.from(document.querySelectorAll('.tool-mode'));
        this.modeBtns = modeBtns;
        for (const b of modeBtns) {
            b.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                playUiClick();
                const mode = b.dataset.mode;
                this.game.setTool(mode);
            });
        }

        const shuffleBtn = document.getElementById('tool-shuffle');
        if (shuffleBtn) {
            shuffleBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                playUiClick();
                this.game.randomizeScene();
                // Little tactile flourish — same idea as the old rotate
                // micro-tween, but as a quarter spin matching the dice roll.
                shuffleBtn.animate(
                    [{ transform: 'rotate(0deg)' }, { transform: 'rotate(180deg)' }],
                    { duration: 320, easing: 'cubic-bezier(0.2, 1.1, 0.3, 1)' }
                );
            });
        }
    }

    _syncToolbar() {
        if (!this.modeBtns) return;
        for (const b of this.modeBtns) {
            const on = b.dataset.mode === this.game.tool;
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
    }

    _wireHintCard() {
        const card = document.getElementById('hint-card');
        const dismiss = document.getElementById('hint-dismiss');
        if (!card || !dismiss) return;
        // Show once per browser. Cleared if the user resets via dev tools.
        let seen = false;
        try { seen = localStorage.getItem(HINT_SEEN_KEY) === '1'; } catch {}
        if (!seen) {
            card.classList.remove('hidden');
            card.setAttribute('aria-hidden', 'false');
        }
        const close = () => {
            card.classList.add('hidden');
            card.setAttribute('aria-hidden', 'true');
            try { localStorage.setItem(HINT_SEEN_KEY, '1'); } catch {}
        };
        dismiss.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            playUiClick();
            close();
        });
        // Tapping the dim background also closes — quick escape.
        card.addEventListener('pointerdown', (e) => {
            if (e.target === card) close();
        });
    }

    update() {
        this.dock.update();
        this._syncToolbar();
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
