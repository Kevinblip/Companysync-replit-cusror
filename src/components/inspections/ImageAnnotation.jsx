/**
 * Draws professional chalk-style annotations on an image based on detection boxes.
 * - Hail damage: Red chalk CIRCLES around impact points
 * - Wind damage: Yellow chalk HORIZONTAL LINES across affected shingles
 * - Other damage: Blue chalk BOXES around affected areas
 * 
 * @param {string} imageUrl - The URL of the source image
 * @param {Array} detections - Array of detection objects {type, box_2d: [ymin, xmin, ymax, xmax]} (0-1000 scale)
 * @returns {Promise<Blob>} - The annotated image as a Blob
 */
export const annotateImage = async (imageUrl, detections) => {
  const response = await fetch(imageUrl);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      
      const scaleFactor = Math.max(img.width, img.height) / 1000;
      
      detections.forEach(det => {
        if (!det.box_2d || det.box_2d.length !== 4) return;
        
        const [ymin, xmin, ymax, xmax] = det.box_2d;
        
        const y = (ymin / 1000) * img.height;
        const x = (xmin / 1000) * img.width;
        const h = ((ymax - ymin) / 1000) * img.height;
        const w = ((xmax - xmin) / 1000) * img.width;
        
        const centerX = x + w / 2;
        const centerY = y + h / 2;
        
        if (det.type === 'hail') {
          drawChalkCircle(ctx, centerX, centerY, Math.max(w, h) / 2, '#ef4444', scaleFactor);
        } else if (det.type === 'wind') {
          drawChalkLine(ctx, x, centerY, x + w, centerY, '#eab308', scaleFactor);
        } else {
          drawChalkBox(ctx, x, y, w, h, '#3b82f6', scaleFactor);
        }
      });
      
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas to Blob conversion failed"));
      }, 'image/jpeg', 0.92);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image for annotation"));
    };
    img.src = objectUrl;
  });
};

function drawChalkCircle(ctx, cx, cy, radius, color, scale) {
  const lineWidth = Math.max(4, 8 * scale);
  radius = Math.max(radius, 12 * scale);
  
  ctx.save();
  
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 4 * scale;
  ctx.shadowOffsetX = 2 * scale;
  ctx.shadowOffsetY = 2 * scale;
  
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.85;
  
  ctx.beginPath();
  const segments = 36;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const jitterR = radius + (Math.random() - 0.5) * 3 * scale;
    const px = cx + Math.cos(angle) * jitterR;
    const py = cy + Math.sin(angle) * jitterR;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = lineWidth * 1.8;
  ctx.shadowBlur = 0;
  ctx.stroke();
  
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = lineWidth * 0.5;
  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const jitterR = radius + (Math.random() - 0.5) * 2 * scale;
    const px = cx + Math.cos(angle) * jitterR;
    const py = cy + Math.sin(angle) * jitterR;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  
  ctx.restore();
}

function drawChalkLine(ctx, x1, y1, x2, y2, color, scale) {
  const lineWidth = Math.max(5, 10 * scale);
  
  ctx.save();
  
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 4 * scale;
  ctx.shadowOffsetX = 2 * scale;
  ctx.shadowOffsetY = 2 * scale;
  
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.85;
  
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const px = x1 + (x2 - x1) * t;
    const py = y1 + (y2 - y1) * t + (Math.random() - 0.5) * 3 * scale;
    ctx.lineTo(px, py);
  }
  ctx.stroke();
  
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = lineWidth * 2;
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const px = x1 + (x2 - x1) * t;
    const py = y1 + (y2 - y1) * t + (Math.random() - 0.5) * 2 * scale;
    ctx.lineTo(px, py);
  }
  ctx.stroke();
  
  ctx.restore();
}

function drawChalkBox(ctx, x, y, w, h, color, scale) {
  const lineWidth = Math.max(3, 6 * scale);
  
  ctx.save();
  
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 3 * scale;
  ctx.shadowOffsetX = 1.5 * scale;
  ctx.shadowOffsetY = 1.5 * scale;
  
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.8;
  
  const jitter = () => (Math.random() - 0.5) * 2 * scale;
  
  ctx.beginPath();
  ctx.moveTo(x + jitter(), y + jitter());
  ctx.lineTo(x + w + jitter(), y + jitter());
  ctx.lineTo(x + w + jitter(), y + h + jitter());
  ctx.lineTo(x + jitter(), y + h + jitter());
  ctx.closePath();
  ctx.stroke();
  
  ctx.restore();
}