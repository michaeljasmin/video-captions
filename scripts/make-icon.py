"""Génère assets/Captions.icns (à relancer seulement si on change le design de l'icône)."""
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
S = 1024 * 4  # dessin en 4x puis réduction : bords lisses


def rounded_mask(size, box, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle(box, radius, fill=255)
    return m


img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# Fond : carré arrondi façon macOS, dégradé bleu vers violet.
margin = int(S * 0.098)
box = (margin, margin, S - margin, S - margin)
grad = Image.new("RGBA", (S, S))
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / S
    gd.line([(0, y), (S, y)], fill=(int(70 + 60 * t), int(120 - 50 * t), int(255 - 25 * t), 255))
shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle((box[0], box[1] + S * 0.012, box[2], box[3] + S * 0.012), int(S * 0.18), fill=(0, 0, 0, 90))
img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(S * 0.012)))
img.paste(grad, (0, 0), rounded_mask((S, S), box, int(S * 0.18)))

d = ImageDraw.Draw(img)
# Bouton lecture discret en haut.
cx, cy, r = S * 0.5, S * 0.38, S * 0.12
d.polygon([(cx - r * 0.6, cy - r), (cx - r * 0.6, cy + r), (cx + r * 0.95, cy)], fill=(255, 255, 255, 110))

# Deux lignes de sous-titres blanches avec ombre.
bars = Image.new("RGBA", (S, S), (0, 0, 0, 0))
bd = ImageDraw.Draw(bars)
h = S * 0.075
lines = [(S * 0.24, S * 0.60, S * 0.76), (S * 0.32, S * 0.60 + h * 1.6, S * 0.68)]
for x0, y0, x1 in lines:
    bd.rounded_rectangle((x0, y0, x1, y0 + h), h / 2, fill=(0, 0, 0, 120))
bars = bars.filter(ImageFilter.GaussianBlur(S * 0.012))
img = Image.alpha_composite(img, bars)
d = ImageDraw.Draw(img)
for x0, y0, x1 in lines:
    d.rounded_rectangle((x0, y0 - S * 0.008, x1, y0 + h - S * 0.008), h / 2, fill=(255, 255, 255, 255))

base = img.resize((1024, 1024), Image.LANCZOS)
base.save(ROOT / "assets" / "icon-1024.png")

with tempfile.TemporaryDirectory() as tmp:
    iconset = Path(tmp) / "Captions.iconset"
    iconset.mkdir()
    for size in (16, 32, 128, 256, 512):
        base.resize((size, size), Image.LANCZOS).save(iconset / f"icon_{size}x{size}.png")
        base.resize((size * 2, size * 2), Image.LANCZOS).save(iconset / f"icon_{size}x{size}@2x.png")
    subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(ROOT / "assets" / "Captions.icns")], check=True)
print("ok")
