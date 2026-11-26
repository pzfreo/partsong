#!/usr/bin/env python3
"""Landscape test pages, made from the Huron Carol pages in testdata/ (there was
no landscape music to test with; the cam_* photos are portrait pages stored
sideways). Needs pdftoppm (poppler) and sips (macOS). Writes into testdata/:

  landscape-spread.pdf / .jpg      two pages side by side, like an open book
  landscape-frame-NN.pdf / .jpg    one page on a desk-coloured landscape sheet,
                                   NN per cent of the sheet's height

The .jpg files are the PDFs drawn at a phone camera's 4167 x 2959.
  python3 tests/make-landscape-fixtures.py
"""
import os, subprocess, sys, tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "testdata")
W, H = 842, 595  # A4 landscape, points
DESK = (0.54, 0.49, 0.42)


def jpeg(name):
    out = os.path.join(tempfile.gettempdir(), name + ".jpg")
    subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "90", os.path.join(ROOT, name + ".png"), "--out", out], check=True, capture_output=True)
    data = open(out, "rb").read()
    pw, ph = [int(l.split()[-1]) for l in subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", out], capture_output=True, text=True).stdout.splitlines()[1:3]]
    return data, pw, ph


def pdf(path, placements):
    """placements: [(jpeg_bytes, px_w, px_h, x, y, w, h)] on a W x H page over a desk-coloured sheet."""
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]
    xobjs = " ".join(f"/Im{i} {5 + i} 0 R" for i in range(len(placements)))
    content = f"{DESK[0]} {DESK[1]} {DESK[2]} rg 0 0 {W} {H} re f\n" + "".join(f"q {w} 0 0 {h} {x} {y} cm /Im{i} Do Q\n" for i, (_, _, _, x, y, w, h) in enumerate(placements))
    objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W} {H}] /Resources << /XObject << {xobjs} >> >> /Contents 4 0 R >>".encode())
    objs.append(f"<< /Length {len(content)} >>\nstream\n{content}endstream".encode())
    for data, pw, ph, *_ in placements:
        objs.append(f"<< /Type /XObject /Subtype /Image /Width {pw} /Height {ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {len(data)} >>\nstream\n".encode() + data + b"\nendstream")
    out = b"%PDF-1.5\n"
    offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    x = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode() + b"".join(f"{o:010d} 00000 n \n".encode() for o in offs)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF\n".encode()
    open(path, "wb").write(out)
    subprocess.run(["pdftoppm", "-jpeg", "-jpegopt", "quality=90", "-singlefile", "-scale-to-x", "4167", "-scale-to-y", "2959", path, path[:-4]], check=True)


a, b = jpeg("huron_0"), jpeg("huron_1")


def fit(img, height):
    data, pw, ph = img
    return data, pw, ph, height * pw / ph, height


# Two pages side by side filling the sheet (each page 96% of its height).
h = H * 0.96
wa = h * a[1] / a[2]
pdf(os.path.join(ROOT, "landscape-spread.pdf"), [
    (*a, (W / 2 - wa) / 2 + 0, (H - h) / 2, wa, h),
    (*b, W / 2 + (W / 2 - wa) / 2, (H - h) / 2, wa, h),
])
# One page, on the desk sheet, at a fraction of the sheet's height.
for pct in (96, 70, 50, 35):
    h = H * pct / 100
    w = h * a[1] / a[2]
    pdf(os.path.join(ROOT, f"landscape-frame-{pct}.pdf"), [(*a, (W - w) / 2, (H - h) / 2, w, h)])
print("done")
