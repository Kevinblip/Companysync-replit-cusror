from pathlib import Path
import fitz

pdf_path = Path("attached_assets/screencapture-getcompanysync-ClaimsAudit-2026-09-20-01_13_57_1789881284200.pdf")
output_dir = Path(".agents/outputs/claims-audit")
output_dir.mkdir(parents=True, exist_ok=True)

document = fitz.open(pdf_path)
print(f"pages={document.page_count}")
for index, page in enumerate(document):
    image_path = output_dir / f"page-{index + 1}.png"
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    pixmap.save(image_path)
    print(image_path)