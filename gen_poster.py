#!/usr/bin/env python3
"""
Generate the Alter Isle cover poster on the AlterU palette.

txt2img via aiservice.wdabuliu.com:8019/genl_image — no ref image, so the
output aspect comes from the API default. We re-encode to 1024×1024 (the
AlterU poster convention) regardless.

Run several candidates; reviewer picks. The third pass overlays the
"Alter Isle" wordmark in PIL — necessary because the API's typography is
unreliable.

Requires:
  ~/miniconda3/bin/python3  (arm64, has PIL)

Usage:
  ~/miniconda3/bin/python3 gen_poster.py            # generate 1 candidate
  ~/miniconda3/bin/python3 gen_poster.py --n 4      # batch
  ~/miniconda3/bin/python3 gen_poster.py --overlay candidate_0.png  # only stamp
"""

import argparse
import json
import os
import ssl
import sys
import time
import urllib.request

API_URL = "http://aiservice.wdabuliu.com:8019/genl_image"
USER_ID = 618336286   # ghostpixel, per memory — numeric required
RATE_LIMIT_S = 78
TIMEOUT_S = 360
OUT_DIR = os.path.join(os.path.dirname(__file__), "poster_candidates")
FINAL = os.path.join(os.path.dirname(__file__), "poster.png")

_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE


# Bone background, coral foreground island, violet shadow island, spark
# accent. Ink for the architectural silhouette. We tell the model "poster
# design", "flat vector", "geometric" to push it away from the soft pastel
# rendering it usually defaults to for "island" prompts.
PROMPT = (
    "minimalist editorial poster, large flat geometric isometric island silhouette, "
    "stacked cubic chapel and windmill shapes, two small cypress trees, "
    "bone off-white background (hex F4F1EA), "
    "coral red-orange (hex FF6B5B) used for the main island mass, "
    "deep violet (hex 9D8DFF) used as a soft offset shadow island behind it, "
    "tiny acid-yellow accent dots (hex E7FF5A) for highlights, "
    "ink-black (hex 14141A) used only for small contour lines and one mark, "
    "swiss design, art-deco modernist composition, balanced negative space, "
    "no gradients, no realism, no photo, no people, no text, no letters, no words, "
    "1024x1024 square crop, centered composition, high-contrast print aesthetic"
)


def call_api(prompt: str) -> str:
    payload = {"query": "", "params": {"prompt": prompt, "user_id": USER_ID}}
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        API_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_S, context=_SSL_CTX) as r:
        result = json.loads(r.read().decode())
    if result.get("code") == 200:
        return result["url"]
    if result.get("code") == 100:
        raise RuntimeError(f"API code=100 (rate limit or transient): {result}")
    raise RuntimeError(f"API error: {result}")


def download(url: str, dest: str) -> str:
    print(f"  ↓ {url}")
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    })
    with urllib.request.urlopen(req, timeout=60, context=_SSL_CTX) as r:
        data = r.read()
    raw = dest + ".raw"
    with open(raw, "wb") as f:
        f.write(data)
    # API often returns .webp — convert with sips if not already PNG.
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        os.rename(raw, dest)
    else:
        os.system(f'sips -s format png "{raw}" --out "{dest}" >/dev/null 2>&1')
        os.remove(raw)
    return dest


def stamp_wordmark(in_path: str, out_path: str) -> None:
    """Clean AI-generated corner garbage, then overlay 'ALTER ISLE' + mark."""
    from PIL import Image, ImageDraw, ImageFont

    im = Image.open(in_path).convert("RGB")
    # Normalize to 1024 square (centre-crop the longer side).
    w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2))
    im = im.resize((1024, 1024), Image.LANCZOS)

    # Sample the inner border colour at a few points to derive the cover-
    # rectangle colour. The model tends to draw a violet/coral border with
    # tiny garbled "AlterU"-style text in the 4 corners; we wipe them by
    # painting violet rectangles on top using the corner sample.
    samples = [im.getpixel((24, 24)), im.getpixel((1000, 24)),
               im.getpixel((24, 1000)), im.getpixel((1000, 1000))]
    avg = tuple(sum(c[i] for c in samples) // 4 for i in range(3))

    draw = ImageDraw.Draw(im, "RGBA")
    ink = (20, 20, 26, 255)
    bone = (244, 241, 234, 235)

    # Cover the four corner badge areas (where AI scrawled text).
    pad = 96
    for x0, y0 in [(0, 0), (1024 - pad, 0), (0, 1024 - pad), (1024 - pad, 1024 - pad)]:
        draw.rectangle([(x0, y0), (x0 + pad, y0 + pad)], fill=avg + (255,))

    # Font search — Helvetica → SF Pro → Arial.
    font_paths = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/Library/Fonts/Arial.ttf",
    ]
    title_font = None
    for p in font_paths:
        if os.path.exists(p):
            try:
                title_font = ImageFont.truetype(p, 88)
                break
            except OSError:
                continue
    if title_font is None:
        title_font = ImageFont.load_default()

    # Title plate — bone band, set well inside the violet poster border so
    # the type sits on a clean field without fighting the frame.
    band_top, band_bot = 858, 970
    draw.rectangle([(56, band_top), (968, band_bot)], fill=bone)

    text = "ALTER ISLE"
    bbox = draw.textbbox((0, 0), text, font=title_font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(
        ((1024 - tw) // 2, (band_top + band_bot) // 2 - th // 2 - 8),
        text,
        font=title_font,
        fill=ink,
    )

    # Tiny AlterU collection-mark — architectural "A" — top-left corner.
    mx, my, mw, mh = 56, 56, 40, 40
    draw.polygon(
        [(mx + mw // 2, my + 4), (mx + 4, my + mh - 6), (mx + mw - 4, my + mh - 6)],
        fill=ink,
    )
    draw.rectangle([(mx + 6, my + mh - 4), (mx + mw - 6, my + mh - 1)], fill=ink)

    im.save(out_path, "PNG", optimize=True)
    print(f"  ✔ stamped → {out_path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=1, help="number of candidates")
    ap.add_argument("--overlay", type=str, default=None,
                    help="skip generation, just stamp this file → poster.png")
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)

    if args.overlay:
        stamp_wordmark(args.overlay, FINAL)
        return

    for i in range(args.n):
        if i > 0:
            print(f"⏳ waiting {RATE_LIMIT_S}s for rate limit…")
            time.sleep(RATE_LIMIT_S)
        print(f"▶ candidate {i}")
        try:
            url = call_api(PROMPT)
        except Exception as e:
            print(f"  ✗ {e}")
            continue
        raw_path = os.path.join(OUT_DIR, f"candidate_{i}_raw.png")
        stamped_path = os.path.join(OUT_DIR, f"candidate_{i}.png")
        download(url, raw_path)
        stamp_wordmark(raw_path, stamped_path)

    print()
    print(f"All candidates in {OUT_DIR}.")
    print(f"Pick one and copy it to {FINAL}:")
    print(f"  cp {OUT_DIR}/candidate_N.png poster.png")


if __name__ == "__main__":
    sys.exit(main() or 0)
