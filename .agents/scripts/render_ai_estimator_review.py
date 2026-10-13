from pathlib import Path
import fitz

source = Path("attached_assets/screencapture-getcompanysync-AIEstimator-2026-10-13-04_08_45_1791879022326.pdf")
output = Path(".agents/outputs/ai-estimator-review")
output.mkdir(parents=True, exist_ok=True)

document = fitz.open(source)
print(f"Pages: {document.page_count}")
for index, page in enumerate(document, start=1):
    pixmap = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
    path = output / f"page-{index}.png"
    pixmap.save(path)
    text = page.get_text().strip()
    print(f"{path}: {pixmap.width}x{pixmap.height}; extracted text chars={len(text)}")
    if text:
        print(text[:1200].replace("\n", " | "))
