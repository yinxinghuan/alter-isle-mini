# Alter Isle Mini

The mobile-first cousin of [Alter Isle](https://github.com/yinxinghuan/mykonos-island).
Same zen isometric island-builder soul, slimmed for the AlterU phone
audience: 35 curated assets instead of 75, a full-screen canvas with a
bottom-dock asset picker, and gestures-only controls.

## What's different from the desktop sibling

- **35 curated assets** (was 51) — repository down from 160MB to ~10MB.
  Compressed all PNGs with pngquant (~68% smaller) and dropped variants
  the mobile-first picker doesn't need.
- **3-tab dock** at the bottom (Ground / Nature / Build) instead of the
  five-category right-rail palette.
- **No tools, no toolbar, no HUD.** Place is the default; long-press to
  erase; pinch + two-finger pan for camera. Grid / shadows / fill /
  reset all live in a "•••" popover at top-left.
- **Auto-save** every 600ms after an action — there's no Save button.
- **No keyboard shortcuts.** Touch-only product.
- **No flip-preview, no right-click erase, no shift+drag pan.** The
  underlying engine still supports them — they're just not surfaced.

## Run it

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

No build step. Pure ES modules.

## License

MIT (inherited from upstream — see `LICENSE`).
