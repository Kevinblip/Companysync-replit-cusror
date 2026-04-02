import { jsPDF } from 'jspdf';
import { getTranslations } from '@/utils/translations';

async function loadImageAsDataUrl(url) {
  if (!url) return null;

  const tryFetch = async (fetchUrl, options = {}) => {
    const resp = await fetch(fetchUrl, options);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    if (blob.size === 0) throw new Error('Empty blob');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
  };

  const tryCanvas = async (imgUrl, useCors) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (useCors) img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          if (dataUrl === 'data:,') throw new Error('Canvas toDataURL empty');
          resolve(dataUrl);
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = imgUrl;
    });
  };

  try { return await tryFetch(url); } catch {}
  try { return await tryFetch(url, { credentials: 'include' }); } catch {}
  try { return await tryCanvas(url, true); } catch {}
  try { return await tryCanvas(url, false); } catch {}
  return null;
}

function addPlaceholder(doc, x, y, w, h, text = 'Photo could not be loaded') {
  doc.setFillColor(240, 240, 240);
  doc.rect(x, y, w, h, 'F');
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.rect(x, y, w, h);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(150, 150, 150);
  doc.text(text, x + w / 2, y + h / 2, { align: 'center' });
  doc.setTextColor(0);
}

export async function generateInspectionPDF({
  job,
  myCompany,
  photoMedia,
  sectionNotes,
  linkedEstimate,
  inspectorSignature,
  language = 'en'
}) {
  const t = getTranslations(language);
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - (margin * 2);

  const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 30, g: 58, b: 138 };
  };

  const primaryColor = myCompany?.brand_primary_color 
    ? hexToRgb(myCompany.brand_primary_color) 
    : { r: 30, g: 58, b: 138 };

  let y = 20;
  if (myCompany?.logo_url) {
    const logoDataUrl = await loadImageAsDataUrl(myCompany.logo_url);
    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, 'PNG', 18, y, 60, 25);
        y += 30;
      } catch (error) {
        console.log('⚠️ Logo error');
      }
    }
  }

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(myCompany?.company_name || t.companyName, margin, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(60, 60, 60);

  if (myCompany?.address) {
    doc.text(myCompany.address, margin, y);
    y += 5;
  }

  if (myCompany?.city || myCompany?.state || myCompany?.zip) {
    const cityStateZip = [myCompany?.city, myCompany?.state, myCompany?.zip].filter(Boolean).join(', ');
    doc.text(cityStateZip, margin, y);
    y += 5;
  }

  if (myCompany?.phone) {
    doc.text(`${t.phone}: ${myCompany.phone}`, margin, y);
    y += 5;
  }

  if (myCompany?.email) {
    doc.text(`${t.email}: ${myCompany.email}`, margin, y);
    y += 5;
  }

  if (myCompany?.company_website) {
    doc.text(`${t.web}: ${myCompany.company_website}`, margin, y);
    y += 5;
  }

  y = 80;
  doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
  doc.rect(0, y, pageWidth, 25, 'F');
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(t.inspectionReport, pageWidth / 2, y + 16, { align: 'center' });

  y = 125;
  doc.setFillColor(245, 247, 250);
  doc.rect(margin, y, contentWidth, 50, 'F');
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(t.propertyInformation, margin + 5, y + 8);
  y += 15;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(60, 60, 60);
  doc.text(`${t.propertyAddress}: ${job.property_address || t.na}`, margin + 5, y);
  y += 5;
  doc.text(`${t.clientName}: ${job.client_name || t.na}`, margin + 5, y);
  y += 5;
  if (job.client_email) {
    doc.text(`${t.clientEmail}: ${job.client_email}`, margin + 5, y);
    y += 5;
  }
  if (job.client_phone) {
    doc.text(`${t.clientPhone}: ${job.client_phone}`, margin + 5, y);
    y += 5;
  }
  doc.text(`${t.inspectionDate}: ${new Date(job.inspection_date || job.created_date).toLocaleDateString(t.dateLocale, { month: 'long', day: 'numeric', year: 'numeric' })}`, margin + 5, y);
  y += 5;
  if (job.insurance_claim_number) {
    doc.text(`${t.claimNumber}: ${job.insurance_claim_number}`, margin + 5, y);
    y += 5;
  }
  if (job.insurance_company) {
    doc.text(`${t.insuranceCompany}: ${job.insurance_company}`, margin + 5, y);
  }

  const imagesBySection = {};
  photoMedia.forEach(item => {
    const section = item.section || 'Other';
    if (!imagesBySection[section]) {
      imagesBySection[section] = [];
    }
    imagesBySection[section].push(item);
  });

  for (const [section, images] of Object.entries(imagesBySection)) {
    doc.addPage();
    doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
    doc.rect(0, 10, pageWidth, 12, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text(section, pageWidth / 2, 18, { align: 'center' });

    let yPos = 30;

    if (sectionNotes && sectionNotes[section]) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60, 60, 60);
      const lines = doc.splitTextToSize(sectionNotes[section], contentWidth);
      doc.text(lines, margin, yPos);
      yPos += (lines.length * 4) + 8;
    }

    for (const item of images) {
      if (yPos > pageHeight - 100) {
        doc.addPage();
        doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
        doc.rect(0, 10, pageWidth, 12, 'F');
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 255, 255);
        doc.text(`${section} ${t.continued}`, pageWidth / 2, 18, { align: 'center' });
        yPos = 30;
      }

      try {
        const imgWidth = contentWidth;
        const imgHeight = 100;
        const imageDataUrl = await loadImageAsDataUrl(item.file_url);

        if (imageDataUrl) {
          doc.setDrawColor(200, 200, 200);
          doc.setLineWidth(0.3);
          doc.rect(margin, yPos, imgWidth, imgHeight);
          doc.addImage(imageDataUrl, 'JPEG', margin + 1, yPos + 1, imgWidth - 2, imgHeight - 2);
        } else {
          addPlaceholder(doc, margin, yPos, imgWidth, imgHeight, t.photoNotLoaded);
        }

        yPos += imgHeight + 5;
        if (item.caption) {
          doc.setFontSize(7);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(80, 80, 80);
          const captionLines = doc.splitTextToSize(item.caption, contentWidth);
          doc.text(captionLines, margin, yPos);
          yPos += (captionLines.length * 3) + 10;
          doc.setTextColor(0);
        } else {
          yPos += 10;
        }
      } catch (error) {
        console.error(`❌ Error adding image:`, error);
        addPlaceholder(doc, margin, yPos, contentWidth, 100, t.photoNotLoaded);
        yPos += 110;
      }
    }
  }

  if (linkedEstimate) {
    doc.addPage();
    doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
    doc.rect(0, 10, pageWidth, 12, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text(t.estimateSummary, pageWidth / 2, 18, { align: 'center' });

    let yPos = 35;

    if (myCompany?.logo_url) {
      const estLogoDataUrl = await loadImageAsDataUrl(myCompany.logo_url);
      if (estLogoDataUrl) {
        try {
          doc.addImage(estLogoDataUrl, 'PNG', margin, yPos, 40, 16);
          yPos += 20;
        } catch (error) {
          console.log('⚠️ Logo error on estimate');
        }
      }
    }

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(myCompany?.company_name || t.companyName, margin, yPos);
    yPos += 5;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    if (myCompany?.address) {
      doc.text(myCompany.address, margin, yPos);
      yPos += 4;
    }

    let rightY = yPos - 24;
    doc.setFontSize(20);
    doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
    doc.setFont('helvetica', 'bold');
    doc.text(t.estimate, pageWidth - margin, rightY, { align: 'right' });
    rightY += 6;
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.setFont('helvetica', 'normal');
    doc.text(`# ${linkedEstimate.estimate_number}`, pageWidth - margin, rightY, { align: 'right' });

    yPos = Math.max(yPos, rightY) + 10;

    const items = linkedEstimate.items || linkedEstimate.line_items || [];

    if (items.length > 0) {
      doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
      doc.rect(margin, yPos, contentWidth, 8, 'F');

      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text('#', margin + 2, yPos + 5.5);
      doc.text(t.description, margin + 10, yPos + 5.5);
      doc.text(t.qty, 115, yPos + 5.5, { align: 'right' });
      doc.text(t.unit, 130, yPos + 5.5);
      doc.text(t.unitPrice, 150, yPos + 5.5, { align: 'right' });
      doc.text(t.amount, pageWidth - margin - 2, yPos + 5.5, { align: 'right' });

      yPos += 10;

      let subtotal = 0;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0, 0, 0);

      items.forEach((item, index) => {
        if (yPos > pageHeight - 40) {
          doc.addPage();
          yPos = 20;
        }

        if (index % 2 === 0) {
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, yPos - 3, contentWidth, 6, 'F');
        }

        doc.setFontSize(7);
        doc.text(String(index + 1), margin + 2, yPos + 2);

        const desc = item.description || t.item;
        const descLines = doc.splitTextToSize(desc, 95);
        doc.text(descLines[0], margin + 10, yPos + 2);

        const qty = parseFloat(item.quantity) || 0;
        const rate = parseFloat(item.rate) || 0;
        const amount = parseFloat(item.amount) || 0;

        doc.text(qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(2), 115, yPos + 2, { align: 'right' });
        doc.text(item.unit || t.each, 130, yPos + 2);
        doc.text(`$${rate.toFixed(2)}`, 150, yPos + 2, { align: 'right' });
        doc.text(`$${amount.toFixed(2)}`, pageWidth - margin - 2, yPos + 2, { align: 'right' });

        subtotal += amount;
        yPos += 6;
      });

      yPos += 5;
      doc.setDrawColor(200, 200, 200);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 8;

      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
      doc.text(t.total.toUpperCase(), 145, yPos);
      doc.text(`$${subtotal.toFixed(2)}`, pageWidth - margin - 2, yPos, { align: 'right' });

      yPos += 15;
      if (yPos > pageHeight - 80) {
        doc.addPage();
        yPos = 20;
      }

      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text(t.disclaimer_label, margin, yPos);
      yPos += 5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(40, 40, 40);
      const disclaimerText = t.disclaimer(myCompany?.company_name || t.companyName);
      const disclaimerLines = doc.splitTextToSize(disclaimerText, contentWidth);
      disclaimerLines.forEach(line => {
        if (yPos > pageHeight - 20) {
          doc.addPage();
          yPos = 20;
        }
        doc.text(line, margin, yPos);
        yPos += 3.5;
      });
    }
  }

  if (inspectorSignature) {
    doc.addPage();
    doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
    doc.rect(0, 10, pageWidth, 12, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text(t.inspectorCertification, pageWidth / 2, 18, { align: 'center' });

    let yPos = 40;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    const certText = t.certificationText;
    const certLines = doc.splitTextToSize(certText, contentWidth);
    doc.text(certLines, margin, yPos);
    yPos += (certLines.length * 5) + 15;

    doc.setFillColor(245, 247, 250);
    doc.rect(margin, yPos, 90, 45, 'F');
    doc.setDrawColor(200, 200, 200);
    doc.rect(margin, yPos, 90, 45);

    yPos += 5;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text(`${t.inspectorSignature}:`, margin + 5, yPos + 3);

    try {
      doc.addImage(inspectorSignature, 'PNG', margin + 5, yPos + 6, 70, 25);
    } catch (error) {
      console.error('❌ Error adding signature:', error);
    }

    yPos += 35;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`${t.date}: ${new Date().toLocaleDateString(t.dateLocale, { month: 'long', day: 'numeric', year: 'numeric' })}`, margin + 5, yPos);
  }

  const totalPages = doc.internal.pages.length - 1;
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150, 150, 150);

    const footerText = `${myCompany?.company_name || t.inspectionReport} | ${myCompany?.phone || ''} | ${myCompany?.email || ''}`;
    doc.text(footerText, pageWidth / 2, pageHeight - 13, { align: 'center' });
    doc.text(t.pageOf(i, totalPages), pageWidth / 2, pageHeight - 8, { align: 'center' });
  }

  return doc;
}
