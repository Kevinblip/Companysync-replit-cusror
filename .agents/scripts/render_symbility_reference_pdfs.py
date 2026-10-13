import fitz
from pathlib import Path

sources = [
    Path("attached_assets/210401AB-001_-_Symbility_1788351466301.pdf"),
    Path("attached_assets/Estimate_210401AB_1788351466302.pdf"),
]
output_dir = Path(".agents/outputs/symbility-reference")
output_dir.mkdir(parents=True, exist_ok=True)

for source in sources:
    document = fitz.open(source)
    stem = source.stem
    for index, page in enumerate(document):
        pixmap = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
        pixmap.save(output_dir / f"{stem}-page-{index + 1}.png")
    print(f"Rendered {len(document)} page(s): {source.name}")