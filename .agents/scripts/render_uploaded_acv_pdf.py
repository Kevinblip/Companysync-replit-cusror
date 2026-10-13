import fitz
import os

pdf_path = "attached_assets/061284978_1790076118942.pdf"
doc = fitz.open(pdf_path)
print(f"Pages: {len(doc)}")
os.makedirs(".agents/outputs/acv-source-pdf", exist_ok=True)
for index, page in enumerate(doc, start=1):
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2))
    output_path = f".agents/outputs/acv-source-pdf/page-{index}.png"
    pixmap.save(output_path)
    print(f"Saved {output_path} ({pixmap.width}x{pixmap.height})")