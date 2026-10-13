import fitz
from pathlib import Path
pdf = Path('attached_assets/screencapture-getcompanysync-GeneralSettings-2026-09-13-03_01__1789284022050.pdf')
out = Path('.agents/outputs/general_settings_latest')
out.mkdir(parents=True, exist_ok=True)
doc = fitz.open(pdf)
print('pages', doc.page_count)
for i, page in enumerate(doc):
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    target = out / f'page-{i+1}.png'
    pix.save(target)
    print(i+1, page.rect, target)
