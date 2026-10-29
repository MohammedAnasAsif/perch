"""Draws Perch's app and tray icons (a blue teardrop buddy with two eyes).
Run: python3 scripts/make-icons.py   (needs Pillow)"""
from PIL import Image, ImageDraw, ImageFilter
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets')
os.makedirs(OUT, exist_ok=True)

def buddy(size, glow=True):
    S = 4  # supersample
    W = size * S
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    pad = W * (0.12 if glow else 0.04)
    box = (pad, pad, W - pad, W - pad)
    bw = box[2] - box[0]

    # Teardrop mask: a circle unioned with the top-left quarter square.
    mask = Image.new('L', (W, W), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse(box, fill=255)
    tip_r = bw * 0.06
    d.rounded_rectangle((box[0], box[1], box[0] + bw / 2, box[1] + bw / 2), radius=tip_r, fill=255)

    # Radial gradient fill (light at lower-right center, deep blue at edge).
    grad = Image.new('RGBA', (W, W))
    gp = grad.load()
    cx, cy = box[0] + bw * 0.62, box[1] + bw * 0.62
    c1, c2 = (109, 180, 255), (47, 107, 255)
    rmax = bw * 0.78
    for y in range(W):
        for x in range(W):
            t = min(1.0, ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 / rmax)
            gp[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)) + (255,)

    body = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    body.paste(grad, (0, 0), mask)

    if glow:
        g = Image.new('RGBA', (W, W), (64, 140, 255, 0))
        g.putalpha(mask.filter(ImageFilter.GaussianBlur(W * 0.06)).point(lambda a: int(a * 0.55)))
        img = Image.alpha_composite(img, g)
    img = Image.alpha_composite(img, body)

    # Eyes
    d = ImageDraw.Draw(img)
    ew, eh = bw * 0.13, bw * 0.24
    ey = box[1] + bw * 0.40
    for ex in (box[0] + bw * 0.40, box[0] + bw * 0.63):
        d.rounded_rectangle((ex, ey, ex + ew, ey + eh), radius=ew / 2, fill=(255, 255, 255, 255))

    return img.resize((size, size), Image.LANCZOS)

buddy(256).save(os.path.join(OUT, 'icon.png'))
buddy(16, glow=False).save(os.path.join(OUT, 'tray.png'))
buddy(32, glow=False).save(os.path.join(OUT, 'tray@2x.png'))
icon = buddy(256)
icon.save(os.path.join(OUT, 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('icons written to', os.path.abspath(OUT))
