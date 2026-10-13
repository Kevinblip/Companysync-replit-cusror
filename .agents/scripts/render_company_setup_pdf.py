import fitz
from pathlib import Path

src = Path('attached_assets/screencapture-getcompanysync-CompanySetup-2026-09-15-06_11_20_1789467351935.pdf')
out = Path('.agents/outputs/company_setup_pages')
out.mkdir(parents=True, exist_ok=True)
doc = fitz.open(src)
print('pages', doc.page_count)
for i, page in enumerate(doc):
    pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
    path = out / f'page-{i+1:02d}.png'
    pix.save(path)
    print(i+1, page.rect, path, pix.width, pix.height)
