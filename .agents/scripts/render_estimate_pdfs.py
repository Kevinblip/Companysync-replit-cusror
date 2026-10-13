from pathlib import Path
import pymupdf

inputs = [
    Path("attached_assets/061284978_1790123177234.pdf"),
    Path("attached_assets/joseph_estimate_(1)_1790123186510.PDF"),
]
output_root = Path(".agents/outputs/estimate_pdf_comparison")
output_root.mkdir(parents=True, exist_ok=True)

for source in inputs:
    document = pymupdf.open(source)
    target = output_root / source.stem
    target.mkdir(exist_ok=True)
    print(f"{source.name}: {len(document)} pages")
    for page_number, page in enumerate(document, start=1):
        image = page.get_pixmap(matrix=pymupdf.Matrix(1.75, 1.75), alpha=False)
        destination = target / f"page-{page_number:02}.png"
        image.save(destination)
        print(destination)