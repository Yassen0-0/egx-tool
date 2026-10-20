"""Read an official financial-statements PDF page by page.

WebFetch cannot read the compressed PDFs that EGX companies publish, and some
statement pages are scanned images. This prints the text of each page and saves
every image-only page as a PNG that the Read tool can look at.

    curl -sL -o "$SCRATCH/fs.pdf" "<official PDF url>"
    uv run --no-project --with pypdf --with pillow python -I tools/pdf_pages.py "$SCRATCH/fs.pdf" "$SCRATCH/pages" [first] [last]
"""
import sys
from pathlib import Path

import pypdf


def main() -> None:
    pdf, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    reader = pypdf.PdfReader(pdf)
    first = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    last = int(sys.argv[4]) if len(sys.argv) > 4 else min(len(reader.pages), 12)
    print(f"{pdf.name}: {len(reader.pages)} pages, showing {first}-{last}")
    for n in range(first, last + 1):
        page = reader.pages[n - 1]
        text = page.extract_text() or ""
        if text.strip():
            print(f"\n===== page {n} (text) =====\n{text}")
            continue
        try:
            images = list(page.images)
        except Exception as exc:  # e.g. JBIG2 scans pypdf cannot decode
            print(f"\n===== page {n}: no text layer and the image could not be decoded ({exc}). "
                  f"Look for the same statement in the company's earnings release or an LSE/RNS copy =====")
            continue
        for j, img in enumerate(images):
            image = img.image
            image.thumbnail((1200, 1700))
            path = out / f"page-{n}-{j}.png"
            image.save(path)
            print(f"\n===== page {n} (scanned image) -> {path} : open it with the Read tool =====")


if __name__ == "__main__":
    main()
