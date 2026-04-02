import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { jsPDF } from 'npm:jspdf@2.5.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { inspectionJobId, estimateId } = await req.json();

        // Fetch all necessary data
        let inspectionJob = null;
        let estimate = null;
        let customer = null;
        let company = null;
        let stormEvent = null;
        let inspectionPhotos = [];

        // Get company settings for branding
        const companies = await base44.entities.Company.list('-created_date', 1);
        company = companies[0];

        // Get inspection job if provided
        if (inspectionJobId) {
            const jobs = await base44.entities.InspectionJob.filter({ id: inspectionJobId });
            inspectionJob = jobs[0];

            // Get inspection photos
            const media = await base44.entities.JobMedia.filter({
                related_entity_id: inspectionJobId,
                related_entity_type: 'InspectionJob',
                file_type: 'photo'
            });
            inspectionPhotos = media;

            // If inspection has related estimate, fetch it
            if (inspectionJob?.related_estimate_id) {
                const estimates = await base44.entities.Estimate.filter({ id: inspectionJob.related_estimate_id });
                estimate = estimates[0];
            }

            // If inspection has related storm event, fetch it
            if (inspectionJob?.related_storm_event_id) {
                const storms = await base44.entities.StormEvent.filter({ id: inspectionJob.related_storm_event_id });
                stormEvent = storms[0];
            }
        }

        // Get estimate if provided or not already fetched
        if (estimateId && !estimate) {
            const estimates = await base44.entities.Estimate.filter({ id: estimateId });
            estimate = estimates[0];
        }

        if (!estimate && !inspectionJob) {
            return Response.json({ error: 'Must provide either inspectionJobId or estimateId' }, { status: 400 });
        }

        // Get customer information
        if (estimate?.customer_id) {
            const customers = await base44.entities.Customer.filter({ id: estimate.customer_id });
            customer = customers[0];
        }

        // Create PDF
        const doc = new jsPDF();
        let yPos = 20;
        const pageWidth = doc.internal.pageSize.width;
        const pageHeight = doc.internal.pageSize.height;
        const margin = 20;

        // Helper function to add new page if needed
        const checkPageBreak = (neededSpace = 20) => {
            if (yPos + neededSpace > pageHeight - 20) {
                doc.addPage();
                yPos = 20;
                return true;
            }
            return false;
        };

        // === I. HEADER & COMPANY BRANDING ===
        doc.setFontSize(24);
        doc.setTextColor(30, 64, 175); // Blue
        doc.text(company?.company_name || 'Property Damage Assessment', margin, yPos);
        yPos += 10;

        doc.setFontSize(12);
        doc.setTextColor(100, 100, 100);
        doc.text('INSURANCE ADJUSTER REPORT', margin, yPos);
        yPos += 15;

        // Company info
        doc.setFontSize(9);
        doc.setTextColor(80, 80, 80);
        if (company?.company_address) doc.text(company.company_address, margin, yPos), yPos += 5;
        if (company?.phone_number) doc.text(`Phone: ${company.phone_number}`, margin, yPos), yPos += 5;
        if (company?.email_address) doc.text(`Email: ${company.email_address}`, margin, yPos), yPos += 5;
        yPos += 5;

        // Report metadata
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.text(`Report Date: ${new Date().toLocaleDateString()}`, pageWidth - margin - 50, 30, { align: 'right' });
        doc.text(`Report #: ${estimate?.estimate_number || 'DRAFT'}`, pageWidth - margin - 50, 36, { align: 'right' });
        
        // Separator line
        doc.setDrawColor(200, 200, 200);
        doc.line(margin, yPos, pageWidth - margin, yPos);
        yPos += 10;

        // === II. CUSTOMER & CLAIM INFORMATION ===
        checkPageBreak(40);
        doc.setFontSize(14);
        doc.setTextColor(30, 64, 175);
        doc.text('CLAIM INFORMATION', margin, yPos);
        yPos += 8;

        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        
        const leftCol = margin;
        const rightCol = pageWidth / 2 + 10;

        doc.setFont(undefined, 'bold');
        doc.text('Customer Name:', leftCol, yPos);
        doc.setFont(undefined, 'normal');
        doc.text(estimate?.customer_name || inspectionJob?.client_name || 'N/A', leftCol + 40, yPos);
        
        doc.setFont(undefined, 'bold');
        doc.text('Insurance:', rightCol, yPos);
        doc.setFont(undefined, 'normal');
        doc.text(estimate?.insurance_company || customer?.insurance_company || 'N/A', rightCol + 30, yPos);
        yPos += 6;

        doc.setFont(undefined, 'bold');
        doc.text('Property Address:', leftCol, yPos);
        doc.setFont(undefined, 'normal');
        const address = estimate?.property_address || inspectionJob?.property_address || customer?.address || 'N/A';
        doc.text(address, leftCol + 40, yPos);
        
        doc.setFont(undefined, 'bold');
        doc.text('Claim #:', rightCol, yPos);
        doc.setFont(undefined, 'normal');
        doc.text(estimate?.claim_number || inspectionJob?.insurance_claim_number || 'N/A', rightCol + 30, yPos);
        yPos += 6;

        doc.setFont(undefined, 'bold');
        doc.text('Phone:', leftCol, yPos);
        doc.setFont(undefined, 'normal');
        doc.text(estimate?.customer_phone || inspectionJob?.client_phone || customer?.phone || 'N/A', leftCol + 40, yPos);
        
        doc.setFont(undefined, 'bold');
        doc.text('Adjuster:', rightCol, yPos);
        doc.setFont(undefined, 'normal');
        doc.text(customer?.adjuster_name || 'N/A', rightCol + 30, yPos);
        yPos += 6;

        doc.setFont(undefined, 'bold');
        doc.text('Email:', leftCol, yPos);
        doc.setFont(undefined, 'normal');
        doc.text(estimate?.customer_email || inspectionJob?.client_email || customer?.email || 'N/A', leftCol + 40, yPos);
        
        if (customer?.adjuster_phone) {
            doc.setFont(undefined, 'bold');
            doc.text('Adjuster Phone:', rightCol, yPos);
            doc.setFont(undefined, 'normal');
            doc.text(customer.adjuster_phone, rightCol + 30, yPos);
        }
        yPos += 10;

        doc.setDrawColor(200, 200, 200);
        doc.line(margin, yPos, pageWidth - margin, yPos);
        yPos += 10;

        // === NEW: STORM EVENT INFORMATION ===
        if (stormEvent) {
            checkPageBreak(50);
            doc.setFontSize(14);
            doc.setTextColor(220, 38, 38); // Red for storm alert
            doc.text('⚡ STORM EVENT DETAILS', margin, yPos);
            yPos += 8;

            doc.setFontSize(10);
            doc.setTextColor(0, 0, 0);

            doc.setFont(undefined, 'bold');
            doc.text('Storm Name:', leftCol, yPos);
            doc.setFont(undefined, 'normal');
            doc.text(stormEvent.title || 'N/A', leftCol + 35, yPos);
            
            doc.setFont(undefined, 'bold');
            doc.text('Date:', rightCol, yPos);
            doc.setFont(undefined, 'normal');
            doc.text(stormEvent.date ? new Date(stormEvent.date).toLocaleDateString() : 'N/A', rightCol + 20, yPos);
            yPos += 6;

            doc.setFont(undefined, 'bold');
            doc.text('Hail Size:', leftCol, yPos);
            doc.setFont(undefined, 'normal');
            doc.text(stormEvent.hail_size_inches ? `${stormEvent.hail_size_inches}" diameter` : 'N/A', leftCol + 35, yPos);
            
            doc.setFont(undefined, 'bold');
            doc.text('Wind Speed:', rightCol, yPos);
            doc.setFont(undefined, 'normal');
            doc.text(stormEvent.wind_speed_mph ? `${stormEvent.wind_speed_mph} mph` : 'N/A', rightCol + 30, yPos);
            yPos += 6;

            if (stormEvent.severity) {
                doc.setFont(undefined, 'bold');
                doc.text('Severity:', leftCol, yPos);
                doc.setFont(undefined, 'normal');
                doc.text(stormEvent.severity.toUpperCase(), leftCol + 35, yPos);
                yPos += 6;
            }

            if (stormEvent.description) {
                doc.setFont(undefined, 'bold');
                doc.text('Storm Details:', leftCol, yPos);
                yPos += 5;
                doc.setFont(undefined, 'normal');
                const stormDescLines = doc.splitTextToSize(stormEvent.description, pageWidth - 2 * margin - 10);
                stormDescLines.forEach(line => {
                    checkPageBreak(5);
                    doc.text(line, leftCol + 5, yPos);
                    yPos += 4;
                });
            }

            yPos += 5;
            doc.setDrawColor(200, 200, 200);
            doc.line(margin, yPos, pageWidth - margin, yPos);
            yPos += 10;
        }

        // === III. PROPERTY OVERVIEW & CONDITION ===
        checkPageBreak(40);
        doc.setFontSize(14);
        doc.setTextColor(30, 64, 175);
        doc.text('PROPERTY ASSESSMENT', margin, yPos);
        yPos += 8;

        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);

        if (inspectionJob) {
            doc.setFont(undefined, 'bold');
            doc.text('Inspection Date:', leftCol, yPos);
            doc.setFont(undefined, 'normal');
            doc.text(inspectionJob.inspection_date || new Date(inspectionJob.created_date).toLocaleDateString(), leftCol + 40, yPos);
            yPos += 6;

            if (inspectionJob.weather_conditions) {
                doc.setFont(undefined, 'bold');
                doc.text('Weather:', leftCol, yPos);
                doc.setFont(undefined, 'normal');
                doc.text(inspectionJob.weather_conditions, leftCol + 40, yPos);
                yPos += 6;
            }

            doc.setFont(undefined, 'bold');
            doc.text('Overall Condition:', leftCol, yPos);
            doc.setFont(undefined, 'normal');
            doc.text(inspectionJob.overall_condition || 'Fair', leftCol + 40, yPos);
            yPos += 6;

            doc.setFont(undefined, 'bold');
            doc.text('Hail Damage:', leftCol, yPos);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(inspectionJob.hail_damage_detected ? 220 : 0, inspectionJob.hail_damage_detected ? 38 : 150, inspectionJob.hail_damage_detected ? 38 : 0);
            doc.text(inspectionJob.hail_damage_detected ? 'YES' : 'NO', leftCol + 40, yPos);
            doc.setTextColor(0, 0, 0);
            
            doc.setFont(undefined, 'bold');
            doc.text('Wind Damage:', rightCol, yPos);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(inspectionJob.wind_damage_detected ? 220 : 0, inspectionJob.wind_damage_detected ? 38 : 150, inspectionJob.wind_damage_detected ? 38 : 0);
            doc.text(inspectionJob.wind_damage_detected ? 'YES' : 'NO', rightCol + 30, yPos);
            doc.setTextColor(0, 0, 0);
            yPos += 10;
        }

        // Roof specifications from estimate
        if (estimate?.items && estimate.items.length > 0) {
            const roofItem = estimate.items.find(item => 
                item.description?.toLowerCase().includes('shingle') && 
                item.unit === 'SQ'
            );
            
            if (roofItem) {
                doc.setFont(undefined, 'bold');
                doc.text('Roof Area:', leftCol, yPos);
                doc.setFont(undefined, 'normal');
                doc.text(`${roofItem.quantity} SQ (${(roofItem.quantity * 100).toFixed(0)} sq ft)`, leftCol + 40, yPos);
                yPos += 6;
            }

            // Extract pitch from estimate title if available
            const pitchMatch = estimate.estimate_title?.match(/(\d+\/\d+)\s*Pitch/i);
            if (pitchMatch) {
                doc.setFont(undefined, 'bold');
                doc.text('Roof Pitch:', leftCol, yPos);
                doc.setFont(undefined, 'normal');
                doc.text(pitchMatch[1], leftCol + 40, yPos);
                yPos += 6;
            }
        }

        yPos += 5;
        doc.setDrawColor(200, 200, 200);
        doc.line(margin, yPos, pageWidth - margin, yPos);
        yPos += 10;

        // === IV. DETAILED LINE ITEM ESTIMATE ===
        checkPageBreak(50);
        doc.setFontSize(14);
        doc.setTextColor(30, 64, 175);
        doc.text('DETAILED ESTIMATE', margin, yPos);
        yPos += 10;

        if (estimate?.items && estimate.items.length > 0) {
            // Table headers
            doc.setFontSize(8);
            doc.setFont(undefined, 'bold');
            doc.setFillColor(240, 240, 240);
            doc.rect(margin, yPos - 4, pageWidth - 2 * margin, 6, 'F');
            
            doc.text('#', margin + 2, yPos);
            doc.text('Code', margin + 8, yPos);
            doc.text('Description', margin + 30, yPos);
            doc.text('Qty', pageWidth - margin - 80, yPos, { align: 'right' });
            doc.text('Unit', pageWidth - margin - 65, yPos, { align: 'right' });
            doc.text('Rate', pageWidth - margin - 50, yPos, { align: 'right' });
            doc.text('RCV', pageWidth - margin - 30, yPos, { align: 'right' });
            doc.text('ACV', pageWidth - margin - 10, yPos, { align: 'right' });
            yPos += 8;

            // Line items
            doc.setFont(undefined, 'normal');
            estimate.items.forEach((item, index) => {
                checkPageBreak(10);
                
                const lineNum = (index + 1).toString();
                const code = item.code || '';
                const desc = item.description || '';
                const qty = Number(item.quantity || 0).toFixed(2);
                const unit = item.unit || 'EA';
                const rate = Number(item.rate || 0).toFixed(2);
                const rcv = Number(item.rcv || item.amount || 0).toFixed(2);
                const acv = Number(item.acv || item.amount || 0).toFixed(2);

                doc.setFontSize(8);
                doc.text(lineNum, margin + 2, yPos);
                doc.text(code.substring(0, 12), margin + 8, yPos);
                
                // Wrap description if too long
                const maxDescWidth = 80;
                const descLines = doc.splitTextToSize(desc, maxDescWidth);
                doc.text(descLines[0], margin + 30, yPos);
                
                doc.text(qty, pageWidth - margin - 80, yPos, { align: 'right' });
                doc.text(unit, pageWidth - margin - 65, yPos, { align: 'right' });
                doc.text(`$${rate}`, pageWidth - margin - 50, yPos, { align: 'right' });
                doc.text(`$${rcv}`, pageWidth - margin - 30, yPos, { align: 'right' });
                doc.text(`$${acv}`, pageWidth - margin - 10, yPos, { align: 'right' });
                
                yPos += 6;
                
                // Add additional description lines if wrapped
                if (descLines.length > 1) {
                    for (let i = 1; i < Math.min(descLines.length, 2); i++) {
                        checkPageBreak(6);
                        doc.setFontSize(7);
                        doc.setTextColor(100, 100, 100);
                        doc.text(descLines[i], margin + 30, yPos);
                        yPos += 4;
                    }
                    doc.setTextColor(0, 0, 0);
                }
            });

            // Totals
            yPos += 5;
            doc.setDrawColor(200, 200, 200);
            doc.line(margin, yPos, pageWidth - margin, yPos);
            yPos += 8;

            doc.setFontSize(12);
            doc.setFont(undefined, 'bold');
            doc.text('TOTAL RCV:', pageWidth - margin - 60, yPos);
            doc.text(`$${Number(estimate.total_rcv || estimate.amount || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}`, pageWidth - margin - 10, yPos, { align: 'right' });
            yPos += 7;

            doc.text('TOTAL ACV:', pageWidth - margin - 60, yPos);
            doc.text(`$${Number(estimate.total_acv || estimate.amount || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}`, pageWidth - margin - 10, yPos, { align: 'right' });
            yPos += 10;
        }

        // === V. VISUAL EVIDENCE ===
        doc.addPage();
        yPos = 20;

        doc.setFontSize(14);
        doc.setTextColor(30, 64, 175);
        doc.text('VISUAL DOCUMENTATION', margin, yPos);
        yPos += 10;

        // Add satellite image if available
        if (estimate?.satellite_image_url) {
            try {
                doc.setFontSize(10);
                doc.setTextColor(0, 0, 0);
                doc.text('Satellite Imagery:', margin, yPos);
                yPos += 6;

                // Fetch and embed satellite image
                const imgResponse = await fetch(estimate.satellite_image_url);
                const imgBlob = await imgResponse.blob();
                const imgBuffer = await imgBlob.arrayBuffer();
                const imgBase64 = btoa(String.fromCharCode(...new Uint8Array(imgBuffer)));
                
                const imgWidth = pageWidth - 2 * margin;
                const imgHeight = imgWidth * 0.75; // Maintain aspect ratio
                
                checkPageBreak(imgHeight + 10);
                doc.addImage(`data:image/jpeg;base64,${imgBase64}`, 'JPEG', margin, yPos, imgWidth, imgHeight);
                yPos += imgHeight + 10;
            } catch (error) {
                console.error('Failed to add satellite image:', error);
                doc.setFontSize(9);
                doc.setTextColor(150, 150, 150);
                doc.text('Satellite image could not be loaded', margin, yPos);
                yPos += 10;
            }
        }

        // Add inspection photos (max 8 per page, 4x2 grid)
        if (inspectionPhotos.length > 0) {
            doc.addPage();
            yPos = 20;

            doc.setFontSize(14);
            doc.setTextColor(30, 64, 175);
            doc.text('INSPECTION PHOTOS', margin, yPos);
            yPos += 10;

            const photosPerRow = 2;
            const photoWidth = (pageWidth - 2 * margin - 10) / photosPerRow;
            const photoHeight = photoWidth * 0.75;
            let photoCount = 0;
            let photoX = margin;
            let photoY = yPos;

            for (const photo of inspectionPhotos.slice(0, 12)) { // Limit to 12 photos
                try {
                    const photoResponse = await fetch(photo.file_url);
                    const photoBlob = await photoResponse.blob();
                    const photoBuffer = await photoBlob.arrayBuffer();
                    const photoBase64 = btoa(String.fromCharCode(...new Uint8Array(photoBuffer)));

                    // Add photo
                    doc.addImage(`data:image/jpeg;base64,${photoBase64}`, 'JPEG', photoX, photoY, photoWidth - 5, photoHeight);
                    
                    // Add caption below photo
                    doc.setFontSize(7);
                    doc.setTextColor(80, 80, 80);
                    const caption = photo.caption || photo.section || 'Inspection Photo';
                    doc.text(caption.substring(0, 40), photoX, photoY + photoHeight + 4);
                    doc.setTextColor(0, 0, 0);

                    photoCount++;
                    photoX += photoWidth + 5;

                    // Move to next row after 2 photos
                    if (photoCount % photosPerRow === 0) {
                        photoX = margin;
                        photoY += photoHeight + 10;
                        
                        // Check if we need a new page (4 photos per page = 2 rows)
                        if (photoCount % 4 === 0 && photoCount < inspectionPhotos.length) {
                            doc.addPage();
                            photoY = 20;
                            doc.setFontSize(14);
                            doc.setTextColor(30, 64, 175);
                            doc.text('INSPECTION PHOTOS (continued)', margin, photoY);
                            photoY += 10;
                        }
                    }
                } catch (error) {
                    console.error('Failed to add photo:', error);
                }
            }

            if (inspectionPhotos.length > 12) {
                yPos = photoY + photoHeight + 10;
                doc.setFontSize(9);
                doc.setTextColor(150, 150, 150);
                doc.text(`+ ${inspectionPhotos.length - 12} additional photos available in digital format`, margin, yPos);
            }
        }

        // === VI. NOTES & SUMMARY ===
        doc.addPage();
        yPos = 20;

        doc.setFontSize(14);
        doc.setTextColor(30, 64, 175);
        doc.text('NOTES & OBSERVATIONS', margin, yPos);
        yPos += 10;

        doc.setFontSize(9);
        doc.setTextColor(0, 0, 0);

        if (estimate?.notes) {
            const notesLines = doc.splitTextToSize(estimate.notes, pageWidth - 2 * margin);
            notesLines.forEach(line => {
                checkPageBreak(5);
                doc.text(line, margin, yPos);
                yPos += 5;
            });
            yPos += 5;
        }

        if (inspectionJob?.notes) {
            try {
                const notes = typeof inspectionJob.notes === 'string' ? JSON.parse(inspectionJob.notes) : inspectionJob.notes;
                doc.setFont(undefined, 'bold');
                doc.text('Section Notes:', margin, yPos);
                yPos += 6;
                doc.setFont(undefined, 'normal');
                
                for (const [section, note] of Object.entries(notes)) {
                    if (note && note.trim()) {
                        checkPageBreak(15);
                        doc.setFont(undefined, 'bold');
                        doc.text(`${section}:`, margin + 5, yPos);
                        yPos += 5;
                        doc.setFont(undefined, 'normal');
                        
                        const noteLines = doc.splitTextToSize(note, pageWidth - 2 * margin - 10);
                        noteLines.forEach(line => {
                            checkPageBreak(5);
                            doc.text(line, margin + 10, yPos);
                            yPos += 4;
                        });
                        yPos += 3;
                    }
                }
            } catch (e) {
                // If notes aren't JSON, just display as text
                const notesLines = doc.splitTextToSize(inspectionJob.notes, pageWidth - 2 * margin);
                notesLines.forEach(line => {
                    checkPageBreak(5);
                    doc.text(line, margin, yPos);
                    yPos += 5;
                });
            }
            yPos += 5;
        }

        // === SIGNATURE (if available) ===
        if (inspectionJob?.inspector_signature) {
            checkPageBreak(40);
            doc.setDrawColor(200, 200, 200);
            doc.line(margin, yPos, pageWidth - margin, yPos);
            yPos += 10;

            doc.setFontSize(10);
            doc.setFont(undefined, 'bold');
            doc.text('Inspector Signature:', margin, yPos);
            yPos += 8;

            try {
                // Add signature image
                doc.addImage(inspectionJob.inspector_signature, 'PNG', margin, yPos, 60, 20);
                yPos += 25;

                doc.setFont(undefined, 'normal');
                doc.setFontSize(8);
                doc.text(`Signed: ${new Date(inspectionJob.updated_date || inspectionJob.created_date).toLocaleString()}`, margin, yPos);
            } catch (error) {
                console.error('Failed to add signature:', error);
            }
        }

        // === FOOTER ON LAST PAGE ===
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        const footerText = `Generated by ${company?.company_name || 'AI CRM Pro'} | ${new Date().toLocaleDateString()} | Page ${doc.internal.pages.length - 1}`;
        doc.text(footerText, pageWidth / 2, pageHeight - 10, { align: 'center' });

        // Generate PDF as buffer
        const pdfBuffer = doc.output('arraybuffer');

        return new Response(pdfBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="Adjuster_Report_${estimate?.estimate_number || 'DRAFT'}_${new Date().toISOString().split('T')[0]}.pdf"`
            }
        });

    } catch (error) {
        console.error('Error generating adjuster report:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});