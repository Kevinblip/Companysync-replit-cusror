import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { jsPDF } from 'npm:jspdf@2.5.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobId, imagesData, sectionNotes, inspectorSignature } = await req.json();

    console.log(`📄 Generating CrewCam PDF for job ${jobId} with ${imagesData?.length || 0} images`);

    // Fetch job details
    const jobs = await base44.entities.InspectionJob.filter({ id: jobId });
    const job = jobs[0];

    if (!job) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    // Fetch company details
    const companies = await base44.entities.Company.filter({ id: job.company_id });
    const company = companies[0];

    // Fetch related storm event if linked
    let stormEvent = null;
    if (job.storm_event_id) {
      try {
        const stormEvents = await base44.entities.StormEvent.filter({ id: job.storm_event_id });
        if (stormEvents && stormEvents[0]) {
          stormEvent = stormEvents[0];
          console.log('✅ Storm event found:', stormEvent.title);
        }
      } catch (error) {
        console.log('⚠️ Could not fetch storm event:', error);
      }
    }

    // Fetch logo
    let logoBase64 = null;
    let logoFormat = 'PNG';

    if (company) {
      if (company.logo_base64) {
        logoBase64 = company.logo_base64;
      } else if (company.logo_url) {
        try {
          const logoRes = await fetch(company.logo_url);
          if (logoRes.ok) {
            const contentType = logoRes.headers.get('content-type') || '';
            if (contentType.includes('jpeg') || contentType.includes('jpg')) logoFormat = 'JPEG';
            const logoBuffer = await logoRes.arrayBuffer();
            const b64 = btoa(String.fromCharCode(...new Uint8Array(logoBuffer)));
            logoBase64 = `data:${contentType || 'image/png'};base64,${b64}`;
          }
        } catch (e) {
          console.warn('❌ Failed to fetch logo:', e);
        }
      }
    }

    // Parse image dimensions from raw bytes for aspect ratio
    let logoDimensions = null;
    if (logoBase64) {
      try {
        // Extract raw bytes from data URI
        const raw = logoBase64.includes(',') ? logoBase64.split(',')[1] : logoBase64;
        const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
        // PNG: width at bytes 16-19, height at bytes 20-23
        if (bytes[0] === 0x89 && bytes[1] === 0x50) {
          const w = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
          const h = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
          if (w > 0 && h > 0) logoDimensions = { w, h };
        }
        // JPEG: scan for SOF0 marker (0xFFC0)
        if (!logoDimensions && bytes[0] === 0xFF && bytes[1] === 0xD8) {
          for (let i = 2; i < bytes.length - 10; i++) {
            if (bytes[i] === 0xFF && (bytes[i+1] === 0xC0 || bytes[i+1] === 0xC2)) {
              const h = (bytes[i+5] << 8) | bytes[i+6];
              const w = (bytes[i+7] << 8) | bytes[i+8];
              if (w > 0 && h > 0) logoDimensions = { w, h };
              break;
            }
          }
        }
        if (logoDimensions) console.log(`📐 Logo dimensions: ${logoDimensions.w}x${logoDimensions.h}`);
      } catch (e) { console.warn('Could not parse logo dimensions:', e); }
    }

    const doc = new jsPDF();

    // --- HELPER FUNCTIONS (matching Drone Report style) ---
    const addHeader = () => {
      // Dark Header Background
      doc.setFillColor(31, 41, 55);
      doc.rect(0, 0, 210, 40, 'F');

      let logoX = 15;
      if (logoBase64) {
        try {
          // Calculate aspect-ratio-preserving size within 24x24 bounding box
          const maxLogoW = 24, maxLogoH = 24;
          let logoW = maxLogoW, logoH = maxLogoH;
          if (logoDimensions) {
            const ratio = Math.min(maxLogoW / logoDimensions.w, maxLogoH / logoDimensions.h);
            logoW = logoDimensions.w * ratio;
            logoH = logoDimensions.h * ratio;
          }
          const logoY = 8 + (maxLogoH - logoH) / 2; // vertically center
          doc.addImage(logoBase64, logoFormat, logoX, logoY, logoW, logoH);
          logoX = 15 + logoW + 5;
        } catch (e) {
          console.warn('Failed to add logo to PDF:', e);
        }
      }

      // Company Name
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text(company?.company_name || 'Inspection Report', logoX, 15);

      // Report Subtitle
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text('CREWCAM INSPECTION REPORT', logoX, 22);

      // Contact Info
      let contactInfo = '';
      if (company?.phone) contactInfo += company.phone;
      if (company?.email) contactInfo += (contactInfo ? ' • ' : '') + company.email;
      if (contactInfo) {
        doc.setFontSize(9);
        doc.text(contactInfo, logoX, 28);
      }

      // Address Info
      let addressInfo = '';
      if (company?.address) addressInfo += company.address;
      if (company?.city) addressInfo += (addressInfo ? ', ' : '') + company.city;
      if (company?.state) addressInfo += (addressInfo ? ', ' : '') + company.state;
      if (company?.zip) addressInfo += (addressInfo ? ' ' : '') + company.zip;
      if (addressInfo) {
        doc.text(addressInfo, logoX, 33);
      }

      // Customer Name & Job Ref (right side)
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);
      doc.text(`${job.client_name || 'Customer'}`, 190, 10, { align: 'right' });
      doc.setFontSize(9);
      doc.text(String(job.inspection_number || `Job #${jobId}`), 190, 18, { align: 'right' });
    };

    const addFooter = (pageNo) => {
      const pageCount = doc.internal.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`Page ${pageNo} of ${pageCount}`, 105, 290, { align: 'center' });
      const companyName = company?.company_name || '';
      const companyPhone = company?.phone ? ` • ${company.phone}` : '';
      const companyEmail = company?.email ? ` • ${company.email}` : '';
      doc.text(`${companyName}${companyPhone}${companyEmail}`, 20, 290);
      doc.text(new Date().toLocaleDateString(), 190, 290, { align: 'right' });
    };

    const printTextWithPagination = (textLines, startX, startY, lineHeight = 5, maxY = 270) => {
      let currentY = startY;
      if (!Array.isArray(textLines)) textLines = [textLines];
      for (const line of textLines) {
        if (currentY > maxY) {
          doc.addPage();
          addHeader();
          currentY = 50;
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(0, 0, 0);
        }
        doc.text(line, startX, currentY);
        currentY += lineHeight;
      }
      return currentY;
    };

    // === PAGE 1: SUMMARY ===
    addHeader();
    doc.setTextColor(0, 0, 0);
    let y = 55;

    // Property Details Box
    doc.setDrawColor(200);
    doc.setFillColor(250);
    doc.rect(20, y, 170, 45, 'FD');

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Property Information', 25, y + 10);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Customer: ${job.client_name || 'N/A'}`, 25, y + 20);
    doc.text(`Address: ${job.property_address || 'N/A'}`, 25, y + 27);
    doc.text(`Inspection Date: ${new Date(job.inspection_date || job.created_date).toLocaleDateString()}`, 25, y + 34);
    if (job.weather_conditions) {
      doc.text(`Weather: ${job.weather_conditions}`, 110, y + 20);
    }
    if (job.insurance_claim_number) {
      doc.text(`Claim #: ${job.insurance_claim_number}`, 110, y + 27);
    }

    y += 60;

    // Storm Event Card (if linked)
    if (stormEvent) {
      doc.setFillColor(37, 99, 235);
      doc.rect(20, y, 170, 35, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text(`${(stormEvent.event_type || 'STORM').toUpperCase()} - ${stormEvent.title}`, 25, y + 10);

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Event Type: ${stormEvent.event_type || 'N/A'}`, 25, y + 18);
      doc.text(`Status: ${stormEvent.status || 'N/A'}`, 25, y + 24);

      if (stormEvent.start_time) {
        doc.text(`Date/Time: ${new Date(stormEvent.start_time).toLocaleString()}`, 25, y + 30);
      }
      if (stormEvent.severity) {
        doc.text(`Severity: ${stormEvent.severity.toUpperCase()}`, 110, y + 18);
      }
      if (stormEvent.hail_size_inches) {
        doc.text(`Hail Size: ${stormEvent.hail_size_inches}" diameter`, 110, y + 24);
      }
      if (stormEvent.wind_speed_mph) {
        doc.text(`Wind Speed: ${stormEvent.wind_speed_mph} mph`, 110, y + 30);
      }

      doc.setTextColor(0, 0, 0);
      y += 45;
    }

    // Inspector Notes (if any)
    if (job.notes) {
      if (y > 240) { doc.addPage(); addHeader(); y = 50; }
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Inspector Notes:', 20, y);
      y += 7;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const splitNotes = doc.splitTextToSize(job.notes, 170);
      y = printTextWithPagination(splitNotes, 20, y);
      y += 10;
    }

    // === PHOTO SECTIONS ===
    // Group images by section
    const imagesBySection = {};
    if (imagesData && Array.isArray(imagesData)) {
      imagesData.forEach(item => {
        const section = item.section || 'Other';
        if (!imagesBySection[section]) {
          imagesBySection[section] = [];
        }
        imagesBySection[section].push(item);
      });
    }

    console.log(`📸 Grouped into ${Object.keys(imagesBySection).length} sections`);

    for (const [section, images] of Object.entries(imagesBySection)) {
      doc.addPage();
      addHeader();

      let currentY = 50;

      // Section Title
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text(section, 20, currentY);
      currentY += 10;

      // Section Notes
      if (sectionNotes && sectionNotes[section]) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const lines = doc.splitTextToSize(sectionNotes[section], 170);
        currentY = printTextWithPagination(lines, 20, currentY);
        currentY += 5;
      }

      // Images for this section
      for (let i = 0; i < images.length; i++) {
        const item = images[i];
        const imageData = item.imageBase64;

        if (!imageData) continue;

        // Check if we need a new page
        if (currentY + 100 > 270) {
          doc.addPage();
          addHeader();
          currentY = 50;
          doc.setFontSize(14);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(0, 0, 0);
          doc.text(`${section} (continued)`, 20, currentY);
          currentY += 10;
        }

        const imgWidth = 100;
        const imgHeight = 75;

        try {
          doc.addImage(imageData, 'JPEG', 20, currentY, imgWidth, imgHeight);
          doc.setDrawColor(200);
          doc.rect(20, currentY, imgWidth, imgHeight);

          // Metadata box to the right of image
          const metaX = 130;
          let metaY = currentY + 5;

          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(0, 0, 0);
          doc.text(`Photo ${i + 1}`, metaX, metaY);
          metaY += 8;

          doc.setFontSize(9);
          doc.setFont('helvetica', 'normal');

          // Show AI analysis metadata if present
          const analysis = item.analysis || {};

          if (analysis.material_type_identified && analysis.material_type_identified !== 'unknown') {
            doc.text(`Material: ${analysis.material_type_identified}`, metaX, metaY);
            metaY += 5;
          }

          if (analysis.likely_discontinued) {
            doc.setTextColor(220, 38, 38);
            doc.setFont('helvetica', 'bold');
            doc.text('Likely Discontinued', metaX, metaY);
            metaY += 5;
            doc.setTextColor(0);
            doc.setFont('helvetica', 'normal');
          }

          // Damage counts
          if (analysis.hail_hits_counted > 0) {
            doc.setTextColor(220, 38, 38);
            doc.setFont('helvetica', 'bold');
            doc.text(`${analysis.hail_hits_counted} Hail Hits`, metaX, metaY);
            metaY += 5;
            doc.setTextColor(0);
            doc.setFont('helvetica', 'normal');
          }
          if (analysis.wind_marks_counted > 0) {
            doc.setTextColor(220, 38, 38);
            doc.setFont('helvetica', 'bold');
            doc.text(`${analysis.wind_marks_counted} Wind Marks`, metaX, metaY);
            metaY += 5;
            doc.setTextColor(0);
            doc.setFont('helvetica', 'normal');
          }
          if (analysis.missing_shingles_counted > 0) {
            doc.setTextColor(220, 38, 38);
            doc.setFont('helvetica', 'bold');
            doc.text(`${analysis.missing_shingles_counted} Missing Shingles`, metaX, metaY);
            metaY += 5;
            doc.setTextColor(0);
            doc.setFont('helvetica', 'normal');
          }
          if (analysis.creased_shingles_counted > 0) {
            doc.setTextColor(220, 38, 38);
            doc.setFont('helvetica', 'bold');
            doc.text(`${analysis.creased_shingles_counted} Creased`, metaX, metaY);
            metaY += 5;
            doc.setTextColor(0);
            doc.setFont('helvetica', 'normal');
          }

          // Severity
          if (analysis.severity && analysis.severity !== 'none') {
            doc.setFont('helvetica', 'bold');
            const sevColor = analysis.severity === 'severe' ? [220, 38, 38] :
                            analysis.severity === 'moderate' ? [234, 88, 12] : [202, 138, 4];
            doc.setTextColor(...sevColor);
            doc.text(`Severity: ${analysis.severity.toUpperCase()}`, metaX, metaY);
            metaY += 5;
            doc.setTextColor(0);
            doc.setFont('helvetica', 'normal');
          }

          // Caption
          if (item.caption) {
            doc.setFont('helvetica', 'italic');
            doc.setTextColor(100);
            const capLines = doc.splitTextToSize(item.caption, 65);
            doc.text(capLines, metaX, metaY);
            metaY += (capLines.length * 4) + 2;
            doc.setTextColor(0);
            doc.setFont('helvetica', 'normal');
          }

          console.log(`✅ Added image ${i + 1} to ${section}`);
        } catch (error) {
          console.error(`❌ Error adding image ${i + 1}:`, error);
          doc.text('[Image Error]', 20, currentY + 10);
        }

        currentY += imgHeight + 5;

        // AI analysis text below image (full width)
        const aiText = (item.analysis && item.analysis.ai_notes) || item.ai_analysis || '';
        if (aiText) {
          if (currentY > 265) {
            doc.addPage();
            addHeader();
            currentY = 50;
          }

          doc.setFontSize(9);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(40, 40, 40);
          const aiSplit = doc.splitTextToSize(aiText, 170);
          for (const line of aiSplit) {
            if (currentY > 275) {
              doc.addPage();
              addHeader();
              currentY = 50;
            }
            doc.text(line, 20, currentY);
            currentY += 4;
          }
          doc.setTextColor(0);
          currentY += 5;
        }

        currentY += 5;
      }
    }

    // Inspector signature
    if (inspectorSignature) {
      doc.addPage();
      addHeader();
      doc.setFontSize(16);
      doc.setTextColor(0, 0, 0);
      doc.text('Inspector Signature', 20, 55);

      try {
        doc.addImage(inspectorSignature, 'PNG', 20, 65, 80, 30);
        console.log('✅ Added inspector signature');
      } catch (error) {
        console.error('❌ Error adding signature:', error);
      }
    }

    // Add page numbers & footers
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      addFooter(i);
    }

    console.log('✅ CrewCam PDF generation complete');

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=crewcam-${jobId}.pdf`
      }
    });

  } catch (error) {
    console.error('❌ PDF Generation Error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});