#!/usr/bin/env python3
"""Generate the Genealogy Logger icon set.

A parchment scroll on heritage green, matching the Archival Parchment theme in
styles/theme.css. Each size is drawn on a supersampled canvas and reduced with
LANCZOS, and small sizes are deliberately simplified — detail that reads at
128px turns to mud at 16px.

    python3 tools/make_icons.py
"""

from PIL import Image, ImageDraw, ImageFilter

SIZES = [16, 32, 48, 128]
SS = 16  # supersampling factor

# Palette — mirrors styles/theme.css
GREEN_TOP = (62, 138, 102)
GREEN_BOT = (28, 70, 51)
PARCHMENT = (247, 239, 221)
PARCHMENT_SHADE = (232, 219, 190)
ROLL = (223, 205, 166)
ROLL_EDGE = (188, 166, 122)
INK = (124, 106, 76)
GOLD = (176, 125, 43)


def vertical_gradient(size, top, bottom):
    """A 1px-wide gradient stretched to a square — cheaper than per-pixel work."""
    grad = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(size - 1, 1)
        grad.putpixel((0, y), tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return grad.resize((size, size), Image.BILINEAR)


def draw_icon(px):
    """Render one icon at `px` logical pixels.

    Proportions are tuned per size rather than scaled from one drawing: at 16px
    the silhouette is all that survives, so the scroll grows, the rolls thicken
    and the ruled lines are dropped entirely.
    """
    S = px * SS

    if px <= 16:
        w_frac, roll_frac, lines = 0.70, 0.135, 2
    elif px <= 32:
        w_frac, roll_frac, lines = 0.56, 0.10, 3
    elif px <= 48:
        w_frac, roll_frac, lines = 0.54, 0.09, 4
    else:
        w_frac, roll_frac, lines = 0.52, 0.085, 5

    # --- background: rounded square, green gradient ---
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.21), fill=255)
    canvas.paste(vertical_gradient(S, GREEN_TOP, GREEN_BOT), (0, 0), mask)

    d = ImageDraw.Draw(canvas)

    # --- scroll geometry ---
    w = w_frac * S
    x0, x1 = (S - w) / 2, (S + w) / 2
    top, bot = 0.11 * S, 0.89 * S
    roll_h = roll_frac * S
    overhang = 0.04 * S

    body_top, body_bot = top + roll_h / 2, bot - roll_h / 2

    # Soft shadow so the parchment separates from the green. Skipped at 16px,
    # where it only muddies the handful of pixels available.
    if px > 16:
        shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rectangle(
            [x0 - overhang, top + 0.02 * S, x1 + overhang, bot + 0.025 * S], fill=(16, 40, 29, 60)
        )
        canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(0.018 * S)))
        d = ImageDraw.Draw(canvas)

    d.rectangle([x0, body_top, x1, body_bot], fill=PARCHMENT)
    # A shaded right edge suggests the sheet curving away.
    d.rectangle([x1 - 0.05 * S, body_top, x1, body_bot], fill=PARCHMENT_SHADE)

    # --- ruled writing ---
    if lines:
        inset = 0.085 * S if px <= 16 else 0.10 * S
        lw = max(0.052 * S, SS) if px <= 16 else max(0.030 * S, SS * 0.75)
        span_top, span_bot = body_top + 0.085 * S, body_bot - 0.085 * S
        step = (span_bot - span_top) / (lines - 1) if lines > 1 else 0
        # Ragged right edge reads as handwriting rather than a printed form.
        widths = [1.0, 0.8, 0.94, 0.68, 0.88]
        for i in range(lines):
            y = span_top + step * i
            run = (x1 - inset - 0.05 * S) - (x0 + inset)
            d.rounded_rectangle(
                [x0 + inset, y - lw / 2, x0 + inset + run * widths[i % len(widths)], y + lw / 2],
                radius=lw / 2, fill=INK,
            )

    # --- rolled ends ---
    edge_w = max(int(0.014 * S), SS // 2)
    for cy in (top, bot - roll_h):
        box = [x0 - overhang, cy, x1 + overhang, cy + roll_h]
        d.ellipse(box, fill=ROLL, outline=ROLL_EDGE, width=edge_w)
        # Shade the lower half of the curl so it turns rather than reading flat.
        if px >= 32:
            d.arc([box[0] + edge_w, box[1] + edge_w, box[2] - edge_w, box[3] - edge_w],
                  start=10, end=170, fill=ROLL_EDGE, width=max(int(0.010 * S), 1))

    return canvas.resize((px, px), Image.LANCZOS)


if __name__ == "__main__":
    for px in SIZES:
        path = f"icons/icon-{px}.png"
        draw_icon(px).save(path)
        print(f"wrote {path}")
