from pathlib import Path
import fitz

src = Path("attached_assets/210401AB-001_-_Symbility_1_1788354091550.pdf")
out = Path(".agents/outputs/uploaded-symbility")
out.mkdir(parents=True, exist_ok=True)

doc = fitz.open(src)
print(f"pages={doc.page_count} size={src.stat().st_size}")
for index, page in enumerate(doc, start=1):
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    dest = out / f"page-{index}.png"
    pix.save(dest)
    print(dest)