import fitz
import os

pdf_path = "attached_assets/screencapture-getcompanysync-AIEstimator-2026-08-04-09_39_17_1785850998710.pdf"
doc = fitz.open(pdf_path)
print(f"Pages: {len(doc)}")
os.makedirs(".agents/outputs", exist_ok=True)
for i, page in enumerate(doc):
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
    path = f".agents/outputs/siding_pdf_p{i+1}.png"
    pix.save(path)
    print(f"Saved {path} ({pix.width}x{pix.height})")
    # Also extract text
    text = page.get_text()
    print(f"--- Page {i+1} text ---")
    print(text[:3000])
