import { shouldUseNativePhotoPicker } from './photoAccept';

function isCancel(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('cancel') || msg.includes('no image') || msg.includes('no photos');
}

async function blobToFile(source, name) {
  const response = await fetch(source);
  const blob = await response.blob();
  const type = blob.type || 'image/jpeg';
  const extension = type.includes('png') ? 'png' : 'jpg';
  return new File([blob], name || `photo-${Date.now()}.${extension}`, { type });
}

async function photoToFile(photo, index) {
  const source = photo?.dataUrl || photo?.webPath || photo?.path;
  if (!source) return null;
  return blobToFile(source, `photo-${Date.now()}-${index}.jpg`);
}

function assignFiles(input, files) {
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function chooseSource(multiple) {
  return new Promise((resolve) => {
    const sheet = document.createElement('div');
    sheet.setAttribute('data-testid', 'native-photo-sheet');
    sheet.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.45);display:flex;align-items:flex-end;justify-content:center;padding:16px;';
    sheet.innerHTML = `
      <div style="width:min(420px,100%);background:#fff;border-radius:16px;padding:8px;box-shadow:0 12px 40px rgba(0,0,0,.2);font-family:system-ui,sans-serif;">
        <button type="button" data-choice="camera" style="display:block;width:100%;padding:14px;border:0;background:transparent;font-size:16px;font-weight:600;">Take Photo</button>
        <button type="button" data-choice="library" style="display:block;width:100%;padding:14px;border:0;background:transparent;font-size:16px;font-weight:600;">Choose from Library</button>
        <button type="button" data-choice="cancel" style="display:block;width:100%;padding:14px;border:0;background:transparent;font-size:16px;color:#64748b;">Cancel</button>
      </div>`;
    const finish = (choice) => {
      sheet.remove();
      resolve(choice);
    };
    sheet.addEventListener('click', (event) => {
      const choice = event.target?.getAttribute?.('data-choice');
      if (choice) finish(choice === 'library' && multiple ? 'library-multi' : choice);
      else if (event.target === sheet) finish('cancel');
    });
    document.body.appendChild(sheet);
  });
}

async function pickFiles(input) {
  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
  const multiple = input.multiple;
  const capture = input.hasAttribute('capture');
  let choice = capture ? 'camera' : await chooseSource(multiple);
  if (choice === 'cancel') return [];

  if (choice === 'library-multi' || (choice === 'library' && multiple)) {
    const result = await Camera.pickImages({ quality: 85, limit: 20 });
    const photos = result?.photos || [];
    const files = [];
    for (let index = 0; index < photos.length; index += 1) {
      const file = await photoToFile(photos[index], index);
      if (file) files.push(file);
    }
    return files;
  }

  const photo = await Camera.getPhoto({
    quality: 85,
    allowEditing: false,
    resultType: CameraResultType.Uri,
    source: choice === 'camera' ? CameraSource.Camera : CameraSource.Photos,
    correctOrientation: true,
  });
  const file = await photoToFile(photo, 0);
  return file ? [file] : [];
}

let picking = false;

export async function openNativePhotoPicker(input) {
  if (picking) return;
  picking = true;
  try {
    const files = await pickFiles(input);
    if (files.length > 0) assignFiles(input, files);
  } catch (err) {
    if (!isCancel(err)) console.warn('[Native] Photo picker failed:', err?.message || err);
  } finally {
    picking = false;
  }
}

export async function initPhotoPicker() {
  const originalClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function click() {
    if (shouldUseNativePhotoPicker(this)) {
      openNativePhotoPicker(this);
      return;
    }
    return originalClick.call(this);
  };

  document.addEventListener('click', (event) => {
    const input = event.target?.closest?.('input[type="file"]');
    if (!input || !shouldUseNativePhotoPicker(input)) return;
    event.preventDefault();
    event.stopPropagation();
    openNativePhotoPicker(input);
  }, true);
}
