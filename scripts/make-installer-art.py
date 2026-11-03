"""The pictures the installers show, drawn from the mark in src-tauri/icons/tessera.svg.

    python scripts/make-installer-art.py

Both installers want 24-bit BMPs at fixed sizes, so these are generated rather than
drawn by hand, and committed, so a build needs neither Python nor this font.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "src-tauri" / "installer"
FONT = "C:/Windows/Fonts/seguisb.ttf"
LIGHT = "C:/Windows/Fonts/segoeui.ttf"
TOP = (26, 138, 224)
BOTTOM = (0, 96, 176)
TILE = (255, 255, 255)
LAST_TILE = (166, 220, 255)
SCALE = 4  # Drawn large and reduced, for smooth corners.


def gradient(width: int, height: int) -> Image.Image:
    image = Image.new("RGB", (width, height))
    pixels = image.load()
    for y in range(height):
        for x in range(width):
            share = (x / max(width - 1, 1) + y / max(height - 1, 1)) / 2
            pixels[x, y] = tuple(round(a + (b - a) * share) for a, b in zip(TOP, BOTTOM))
    return image


def mark(size: int) -> Image.Image:
    """The mark on its rounded ground, with an alpha channel, at `size` pixels."""
    big = size * SCALE
    unit = big / 256
    ground = gradient(big, big).convert("RGBA")
    shape = Image.new("L", (big, big), 0)
    ImageDraw.Draw(shape).rounded_rectangle((0, 0, big - 1, big - 1), radius=56 * unit, fill=255)
    ground.putalpha(shape)
    draw = ImageDraw.Draw(ground)
    for x, y, colour in [
        (56, 56, TILE),
        (136, 56, TILE),
        (56, 136, TILE),
        (142, 142, LAST_TILE),
    ]:
        draw.rounded_rectangle(
            (x * unit, y * unit, (x + 64) * unit, (y + 64) * unit), radius=14 * unit, fill=colour
        )
    return ground.resize((size, size), Image.LANCZOS)


def place(canvas: Image.Image, picture: Image.Image, x: int, y: int) -> None:
    canvas.paste(picture, (x, y), picture)


def save(image: Image.Image, name: str) -> None:
    image.convert("RGB").save(OUT / name, format="BMP")


def header() -> Image.Image:
    """The setup's top band: the mark at the right of its 150 x 57."""
    image = Image.new("RGB", (150, 57), (255, 255, 255))
    place(image, mark(41), 150 - 41 - 8, 8)
    return image


def sidebar() -> Image.Image:
    """The setup's welcome and finish pages: 164 x 314."""
    image = gradient(164, 314)
    # A white mark on the blue, so it does not disappear into its own ground.
    size = 72
    big = size * SCALE
    unit = big / 256
    tiles = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tiles)
    for x, y, colour in [
        (24, 24, TILE),
        (132, 24, TILE),
        (24, 132, TILE),
        (140, 140, LAST_TILE),
    ]:
        draw.rounded_rectangle(
            (x * unit, y * unit, (x + 96) * unit, (y + 96) * unit), radius=18 * unit, fill=colour
        )
    place(image, tiles.resize((size, size), Image.LANCZOS), (164 - size) // 2, 70)
    draw = ImageDraw.Draw(image)
    draw.text((82, 168), "Tessera", font=ImageFont.truetype(FONT, 24), fill="white", anchor="mm")
    draw.text(
        (82, 194),
        "Your week, tile by tile",
        font=ImageFont.truetype(LIGHT, 11),
        fill=(226, 240, 252),
        anchor="mm",
    )
    return image


def banner() -> Image.Image:
    """The MSI's top band: 493 x 58, with the mark at the top right."""
    image = Image.new("RGB", (493, 58), (255, 255, 255))
    place(image, mark(42), 493 - 42 - 8, 8)
    return image


def dialog() -> Image.Image:
    """The MSI's welcome and finish pages: 493 x 312. The text sits over the white part."""
    image = Image.new("RGB", (493, 312), (255, 255, 255))
    image.paste(sidebar().resize((164, 312)), (0, 0))
    return image


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    save(header(), "nsis-header.bmp")
    save(sidebar(), "nsis-sidebar.bmp")
    save(banner(), "wix-banner.bmp")
    save(dialog(), "wix-dialog.bmp")
    print(f"wrote 4 pictures to {OUT}")
