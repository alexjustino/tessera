"""Every picture of the mark, drawn from src-tauri/icons/tessera.svg.

    python scripts/make-brand.py

The icon at each size the platform asks for, the .ico and .icns, the copy the
window shows, and the installers' pictures. Each raster is drawn from the vector
at its own size by Microsoft Edge (headless), not reduced from one large image, so
the tray's sixteen pixels are drawn for sixteen pixels.

The results are committed, so a build needs neither this script nor Edge. It runs
on Windows, where the product is built, and needs Pillow.
"""

from __future__ import annotations

import base64
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MARK = ROOT / "src-tauri" / "icons" / "tessera.svg"
ICONS = ROOT / "src-tauri" / "icons"
INSTALLER = ROOT / "src-tauri" / "installer"
WINDOW_COPY = ROOT / "src" / "assets" / "mark.svg"
EDGE = Path("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe")

#: The sizes Windows asks an .ico for: the tray, the title bar, Explorer's views.
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 256]
#: The loose PNGs the bundle declares in tauri.conf.json.
PNGS = {"32x32.png": 32, "64x64.png": 64, "128x128.png": 128, "128x128@2x.png": 256, "icon.png": 512}
ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024]

#: Edge does not open a window smaller than this, and waits forever when asked to.
MIN_WINDOW = (500, 400)

TAGLINE = "Tasks, notes and time,<br>tile by tile."


def render(html: str, width: int, height: int, work: Path, name: str) -> Image.Image:
    """Draw `html` at `width` x `height` with a transparent page, and return it.

    The window is never smaller than Edge allows one to be; the picture is cut from its corner.
    """
    page = work / f"{name}.html"
    shot = work / f"{name}.png"
    page.write_text(html, encoding="utf-8")
    subprocess.run(
        [
            str(EDGE),
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            "--default-background-color=00000000",
            f"--user-data-dir={work / 'profile'}",
            f"--window-size={max(width, MIN_WINDOW[0])},{max(height, MIN_WINDOW[1])}",
            f"--screenshot={shot}",
            page.as_uri(),
        ],
        check=True,
        capture_output=True,
        timeout=180,
    )
    return Image.open(shot).convert("RGBA").crop((0, 0, width, height))


def page(body: str, width: int, height: int, background: str = "transparent") -> str:
    return (
        '<!doctype html><meta charset="utf-8"><style>'
        f"html,body{{margin:0;width:{width}px;height:{height}px;overflow:hidden;background:{background}}}"
        "body{position:relative;font-family:'Segoe UI Variable Display','Segoe UI Variable','Segoe UI',sans-serif}"
        f"</style>{body}"
    )


def mark_uri() -> str:
    return "data:image/svg+xml;base64," + base64.b64encode(MARK.read_bytes()).decode()


def icons(sizes: list[int], work: Path) -> dict[int, Image.Image]:
    """Every size in one page, side by side, drawn once and cut apart.

    A window cannot be sixteen pixels wide, and one page is faster than one browser per size.
    """
    gap = 8
    lefts, x = {}, 0
    for size in sizes:
        lefts[size] = x
        x += size + gap
    width, height = x, max(sizes)
    body = "".join(
        f'<img src="{mark_uri()}" width="{size}" height="{size}" '
        f'style="position:absolute;left:{lefts[size]}px;top:0">'
        for size in sizes
    )
    sheet = render(page(body, width, height), width, height, work, "icons")
    return {size: sheet.crop((lefts[size], 0, lefts[size] + size, size)) for size in sizes}


SIDEBAR_STYLE = """
<style>
.ground{position:absolute;inset:0;background:
  radial-gradient(circle at 18% 8%, rgba(72,176,255,.60), transparent 52%),
  radial-gradient(circle at 92% 96%, rgba(38,206,160,.38), transparent 50%),
  linear-gradient(162deg,#1150c4 0%,#0b2d82 58%,#081c52 100%)}
.tiles{position:absolute;right:-26px;bottom:-22px;width:132px;height:132px;transform:rotate(-12deg)}
.tiles i{position:absolute;width:56px;height:56px;border-radius:14px;background:rgba(255,255,255,.07)}
.mark{position:absolute;left:50%;transform:translateX(-50%);filter:drop-shadow(0 10px 14px rgba(0,10,40,.45))}
.name{position:absolute;left:0;right:0;text-align:center;color:#fff;font-weight:600;letter-spacing:-.01em}
.tag{position:absolute;left:0;right:0;text-align:center;color:rgba(255,255,255,.80);line-height:1.38}
.foot{position:absolute;left:0;right:0;text-align:center;color:rgba(255,255,255,.55);
  text-transform:uppercase;letter-spacing:.14em;font-family:'Segoe UI Variable Text','Segoe UI',sans-serif}
</style>"""


def sidebar_html(width: int, height: int) -> str:
    """The welcome and finish pages' picture: the mark, the name, what it is for."""
    size = 76
    top = round(height * 0.2)
    body = (
        SIDEBAR_STYLE
        + '<div class="ground"></div>'
        + '<div class="tiles"><i style="left:0;top:0"></i><i style="left:66px;top:0"></i>'
        + '<i style="left:0;top:66px"></i><i style="left:66px;top:66px"></i></div>'
        + f'<img class="mark" src="{mark_uri()}" width="{size}" height="{size}" style="top:{top}px">'
        + f'<div class="name" style="top:{top + size + 18}px;font-size:26px">Tessera</div>'
        + f'<div class="tag" style="top:{top + size + 56}px;font-size:11.5px">{TAGLINE}</div>'
        + '<div class="foot" style="bottom:18px;font-size:8.5px">Local-first · No account</div>'
    )
    return page(body, width, height)


def band_html(width: int, height: int) -> str:
    """A setup's top band: white, the mark at the right, where the text is not."""
    size = height - 16
    body = (
        f'<img src="{mark_uri()}" width="{size}" height="{size}" '
        f'style="position:absolute;right:8px;top:8px;filter:drop-shadow(0 2px 3px rgba(0,25,77,.25))">'
    )
    return page(body, width, height, "#ffffff")


def dialog_html(width: int, height: int, panel: int) -> str:
    """The MSI's welcome and finish pages: the sidebar on the left, white where the text is."""
    inner = sidebar_html(panel, height)
    sidebar = base64.b64encode(inner.encode()).decode()
    body = (
        f'<iframe src="data:text/html;base64,{sidebar}" width="{panel}" height="{height}" '
        'style="position:absolute;left:0;top:0;border:0"></iframe>'
    )
    return page(body, width, height, "#ffffff")


def bmp(image: Image.Image, name: str) -> None:
    """Installers want 24-bit BMPs: flatten onto white."""
    flat = Image.new("RGB", image.size, (255, 255, 255))
    flat.paste(image, mask=image.getchannel("A"))
    flat.save(INSTALLER / name, format="BMP")


def main() -> int:
    if not EDGE.exists():
        print(f"Microsoft Edge was not found at {EDGE}", file=sys.stderr)
        return 1
    with tempfile.TemporaryDirectory(prefix="tessera-brand-") as temp:
        work = Path(temp)
        drawn = icons(sorted({*ICO_SIZES, *PNGS.values(), *ICNS_SIZES}), work)

        for name, size in PNGS.items():
            drawn[size].save(ICONS / name, format="PNG")
        largest = drawn[max(ICO_SIZES)]
        largest.save(
            ICONS / "icon.ico",
            format="ICO",
            sizes=[(s, s) for s in ICO_SIZES],
            append_images=[drawn[s] for s in ICO_SIZES if s != max(ICO_SIZES)],
        )
        drawn[1024].save(
            ICONS / "icon.icns",
            format="ICNS",
            append_images=[drawn[s] for s in ICNS_SIZES if s != 1024],
        )
        shutil.copyfile(MARK, WINDOW_COPY)

        bmp(render(sidebar_html(164, 314), 164, 314, work, "sidebar"), "nsis-sidebar.bmp")
        bmp(render(band_html(150, 57), 150, 57, work, "header"), "nsis-header.bmp")
        bmp(render(band_html(493, 58), 493, 58, work, "banner"), "wix-banner.bmp")
        bmp(render(dialog_html(493, 312, 164), 493, 312, work, "dialog"), "wix-dialog.bmp")

    print(f"wrote {len(PNGS)} icons, icon.ico ({len(ICO_SIZES)} sizes), icon.icns, the window's copy")
    print("and 4 installer pictures, all from tessera.svg")
    return 0


if __name__ == "__main__":
    sys.exit(main())
