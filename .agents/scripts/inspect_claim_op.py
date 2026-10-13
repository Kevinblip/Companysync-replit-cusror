import fitz
from pathlib import Path

pdf = Path('attached_assets/Claims_letruce_1788298458145.pdf')
out = Path('.agents/outputs/claim_letruce_render')
out.mkdir(parents=True, exist_ok=True)
doc = fitz.open(pdf)
print('pages:', doc.page_count)
print('metadata:', doc.metadata)
for index, page in enumerate(doc):
    text = page.get_text('text')
    print(f'--- PAGE {index + 1} text ---')
    print(text[:12000])
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    path = out / f'page-{index + 1}.png'
    pix.save(path)
    print('rendered:', path)
