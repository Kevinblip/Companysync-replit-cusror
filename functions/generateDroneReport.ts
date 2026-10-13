import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { jsPDF } from 'npm:jspdf@2.5.1';

Deno.serve(async (req) => {
    console.log('🚀 Starting drone report generation...');
    
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const inspectionId = body.inspectionId;
        const companyId = body.companyId;
        const testMode = body.testMode || false;
        const hailThreshold = body.hailThreshold || 7; 
        const windThreshold = body.windThreshold || 5; 
        const itelStatus = body.itelStatus || 'none'; // 'none', 'match_found', 'no_match'
        const applyOhioCode = body.applyOhioCode || false;

        let inspection;

        if (testMode) {
            console.log('🧪 Generating TEST report with mock data...');
            inspection = {
                inspection_number: 'TEST-REPORT',
                customer_name: 'John Doe (Test)',
                property_address: '123 Test St, Sample City, ST 12345',
                inspection_date: new Date().toISOString().split('T')[0],
                weather_conditions: 'Sunny, 75°F',
                overall_condition: 'poor',
                hail_damage_detected: true,
                wind_damage_detected: true,
                notes: 'This is a test report generated to verify layout, branding, and PDF generation functionality without running a full AI analysis.',
                photos: [
                    {
                        url: 'https://images.unsplash.com/photo-1623298317883-6b70254edf31?q=80&w=1000&auto=format&fit=crop',
                        caption: 'Test Roof Photo',
                        damage_detected: true,
                        damage_type: ['hail', 'wind'],
                        severity: 'moderate',
                        ai_analysis: 'This is a sample AI analysis text describing potential hail impacts and wind creases observed on the shingles.',
                        roof_section: 'Front Slope',
                        hail_hits_per_sq: 8,
                        wind_damage_per_sq: 2,
                        user_notes: 'Sample inspector note.'
                    }
                ],
                section_summaries: {
                    'Front Slope': { hail_per_sq: 8, wind_per_sq: 2, total_hail_marks: 8, total_wind_marks: 2, photo_count: 1 }
                }
            };
        } else {
            if (!inspectionId) {
                return Response.json({ error: 'Inspection ID required' }, { status: 400 });
            }
            // Get inspection data
            const inspections = await base44.entities.DroneInspection.filter({ id: inspectionId });
            
            if (!inspections || inspections.length === 0) {
                return Response.json({ error: 'Inspection not found' }, { status: 404 });
            }
            inspection = inspections[0];
            console.log('✅ Found inspection:', inspection.inspection_number);
        }

        // Fetch related storm event if linked
        let stormEvent = null;
        if (!testMode && inspection?.storm_event_id) {
            console.log('🌩️ Fetching linked storm event:', inspection.storm_event_id);
            const storms = await base44.entities.StormEvent.filter({ id: inspection.storm_event_id });
            if (storms.length > 0) {
                stormEvent = storms[0];
                console.log('✅ Storm event found:', stormEvent.title);
            } else {
                console.warn('⚠️ Storm event ID exists but not found in database');
            }
        }

        // Fetch company data (Robust Lookup)
        let company = null;

        // 1. Explicit Company ID (e.g. from frontend context) - HIGHEST PRIORITY
        if (companyId) {
             const comps = await base44.entities.Company.filter({ id: companyId });
             if (comps.length > 0) company = comps[0];
        }

        // 2. Try inspection.company_id
        if (!company && inspection && inspection.company_id) {
             const comps = await base44.entities.Company.filter({ id: inspection.company_id });
             if (comps.length > 0) company = comps[0];
        }
        
        // 3. Try getting company from StaffProfile (if user is staff)
        if (!company) {
             try {
                 const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: user.email });
                 if (staffProfiles.length > 0 && staffProfiles[0].company_id) {
                     const comps = await base44.entities.Company.filter({ id: staffProfiles[0].company_id });
                     if (comps.length > 0) company = comps[0];
                 }
             } catch (e) { console.warn('Staff profile lookup failed', e); }
        }

        // 4. Fallback: Try created_by (fallback for owner)
        if (!company) {
             const companies = await base44.entities.Company.filter({ created_by: user.email });
             if (companies.length > 0) company = companies[0];
        }

        // 5. Fallback: Try fetching ANY company the user has access to
        if (!company) {
             const companies = await base44.entities.Company.list("-created_date", 1);
             if (companies.length > 0) company = companies[0];
        }

        // Fetch logo if needed
        let logoBase64 = null;
        let logoFormat = 'PNG'; // Default

        if (company) {
            console.log('🏢 Processing company for logo:', company.company_name);
            if (company.logo_base64) {
                logoBase64 = company.logo_base64;
                console.log('✅ Used existing logo_base64');
            } else if (company.logo_url) {
                try {
                    console.log('📥 Fetching logo from URL:', company.logo_url);
                    const logoRes = await fetch(company.logo_url);
                    if (!logoRes.ok) throw new Error(`Logo fetch failed: ${logoRes.status}`);
                    
                    const contentType = logoRes.headers.get('content-type') || '';
                    if (contentType.includes('jpeg') || contentType.includes('jpg')) logoFormat = 'JPEG';
                    
                    const logoBuffer = await logoRes.arrayBuffer();
                    const base64 = btoa(String.fromCharCode(...new Uint8Array(logoBuffer)));
                    logoBase64 = `data:${contentType || 'image/png'};base64,${base64}`;
                    console.log('✅ Logo fetched and converted to base64, format:', logoFormat);
                } catch (e) {
                    console.warn('❌ Failed to fetch logo:', e);
                }
            } else {
                console.log('⚠️ No logo_url or logo_base64 found for company');
            }
        } else {
            console.warn('⚠️ No company data found for report header');
        }

        // Parse image dimensions from raw bytes for aspect ratio
        let logoDimensions = null;
        if (logoBase64) {
          try {
            const raw = logoBase64.includes(',') ? logoBase64.split(',')[1] : logoBase64;
            const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
            if (bytes[0] === 0x89 && bytes[1] === 0x50) {
              const w = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
              const h = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
              if (w > 0 && h > 0) logoDimensions = { w, h };
            }
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

        // Create PDF
        const doc = new jsPDF();
        
        // --- HELPER FUNCTIONS ---
        const addHeader = () => {
             // Dark Header Background
            doc.setFillColor(31, 41, 55);
            doc.rect(0, 0, 210, 40, 'F');
            
            let logoX = 15;
            // Add Logo if available (aspect-ratio preserved)
            if (logoBase64) {
                try {
                    const maxLogoW = 24, maxLogoH = 24;
                    let logoW = maxLogoW, logoH = maxLogoH;
                    if (logoDimensions) {
                      const ratio = Math.min(maxLogoW / logoDimensions.w, maxLogoH / logoDimensions.h);
                      logoW = logoDimensions.w * ratio;
                      logoH = logoDimensions.h * ratio;
                    }
                    const logoY = 8 + (maxLogoH - logoH) / 2;
                    doc.addImage(logoBase64, logoFormat, logoX, logoY, logoW, logoH);
                    logoX = 15 + logoW + 5;
                } catch (e) {
                    console.warn('Failed to add logo to PDF:', e);
                }
            }
            
            // Company Name (Big Title)
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(18);
            doc.setFont('helvetica', 'bold');
            doc.text(company?.company_name || 'Inspection Report', logoX, 15);
            
            // Report Subtitle
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.text('DRONE DAMAGE INSPECTION REPORT', logoX, 22);

            // Contact Info
            let contactInfo = '';
            if (company?.phone) contactInfo += company.phone;
            if (company?.email) contactInfo += (contactInfo ? ' • ' : '') + company.email;
            
            if (contactInfo) {
                doc.setFontSize(9);
                doc.setTextColor(255, 255, 255); // White
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

            // Customer Name & Inspection Ref
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(10);
            doc.text(`${inspection.customer_name || 'Customer'}`, 190, 10, { align: 'right' });
            doc.setFontSize(9);
            doc.text(String(inspection.inspection_number || 'Ref: N/A'), 190, 18, { align: 'right' });
        };
        
        const addFooter = (pageNo) => {
            const pageCount = doc.internal.getNumberOfPages();
            doc.setFontSize(8);
            doc.setTextColor(150);
            doc.text(`Page ${pageNo} of ${pageCount}`, 105, 290, { align: 'center' });
            
            // Company info in footer
            const companyName = company?.company_name || '';
            const companyPhone = company?.phone ? ` • ${company.phone}` : '';
            const companyEmail = company?.email ? ` • ${company.email}` : '';
            doc.text(`${companyName}${companyPhone}${companyEmail}`, 20, 290);
            doc.text(new Date().toLocaleDateString(), 190, 290, { align: 'right' });
        };

        // Helper to print text with auto-paging
        const printTextWithPagination = (textLines, startX, startY, lineHeight = 5, maxY = 270) => {
            let currentY = startY;
            if (!Array.isArray(textLines)) {
                textLines = [textLines];
            }

            for (const line of textLines) {
                if (currentY > maxY) {
                    doc.addPage();
                    addHeader();
                    currentY = 40;
                    doc.setFont('helvetica', 'normal'); // Reset font if needed, though usually kept
                    doc.setTextColor(0, 0, 0);
                }
                doc.text(line, startX, currentY);
                currentY += lineHeight;
            }
            return currentY;
        };

        // --- PAGE 1: SUMMARY ---
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
        doc.text(`Customer: ${inspection.customer_name || 'N/A'}`, 25, y + 20);
        doc.text(`Address: ${inspection.property_address || 'N/A'}`, 25, y + 27);
        doc.text(`Inspection Date: ${inspection.inspection_date || 'N/A'}`, 25, y + 34);
        doc.text(`Weather: ${inspection.weather_conditions || 'N/A'}`, 110, y + 20);
        
        y += 60;

        // Storm Event Card (if linked)
        if (stormEvent) {
            doc.setFillColor(37, 99, 235); // Blue background
            doc.rect(20, y, 170, 35, 'F');
            
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            const stormTitle = `${stormEvent.event_type.toUpperCase()} - ${stormEvent.title}`;
            doc.text(stormTitle, 25, y + 10);
            
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.text(`Event Type: ${stormEvent.event_type}`, 25, y + 18);
            doc.text(`Status: ${stormEvent.status}`, 25, y + 24);
            
            if (stormEvent.start_time) {
                const stormDate = new Date(stormEvent.start_time);
                doc.text(`Date/Time: ${stormDate.toLocaleString()}`, 25, y + 30);
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

        // Damage Summary
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('Executive Summary', 20, y);
        y += 10;
        
        // Status Indicators
        const startX = 20;
        const boxWidth = 50;
        const boxHeight = 30;
        
        // Condition
        const conditionColor = 
            inspection.overall_condition === 'excellent' ? [220, 252, 231] : 
            inspection.overall_condition === 'good' ? [219, 234, 254] : 
            [254, 226, 226]; // redish for poor
            
        doc.setFillColor(...conditionColor);
        doc.rect(startX, y, boxWidth, boxHeight, 'F');
        doc.setFontSize(10);
        doc.text('Overall Condition', startX + boxWidth/2, y + 10, { align: 'center' });
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(String(inspection.overall_condition || 'N/A').toUpperCase(), startX + boxWidth/2, y + 20, { align: 'center' });

        // Hail Status
        doc.setFillColor(inspection.hail_damage_detected ? 254 : 240, inspection.hail_damage_detected ? 242 : 240, inspection.hail_damage_detected ? 242 : 240); // Red tint if hail
        doc.rect(startX + 60, y, boxWidth, boxHeight, 'F');
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('Hail Detected', startX + 60 + boxWidth/2, y + 10, { align: 'center' });
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        if (inspection.hail_damage_detected) {
            doc.setTextColor(220, 38, 38); // Red
            doc.text('YES', startX + 60 + boxWidth/2, y + 20, { align: 'center' });
        } else {
            doc.setTextColor(0);
            doc.text('NO', startX + 60 + boxWidth/2, y + 20, { align: 'center' });
        }
        doc.setTextColor(0);

        // Wind Status
        doc.setFillColor(inspection.wind_damage_detected ? 236 : 240, inspection.wind_damage_detected ? 252 : 240, inspection.wind_damage_detected ? 249 : 240); // Green tint if wind
        doc.rect(startX + 120, y, boxWidth, boxHeight, 'F');
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('Wind Detected', startX + 120 + boxWidth/2, y + 10, { align: 'center' });
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        if (inspection.wind_damage_detected) {
            doc.setTextColor(22, 163, 74); // Green
            doc.text('YES', startX + 120 + boxWidth/2, y + 20, { align: 'center' });
        } else {
            doc.setTextColor(0);
            doc.text('NO', startX + 120 + boxWidth/2, y + 20, { align: 'center' });
        }
        doc.setTextColor(0);
        
        y += 45;

        // Cost Estimate Removed - Defer to Manual Estimate
        // if (inspection.estimated_repair_cost > 0) {
        //     doc.setFontSize(14);
        //     doc.text(`Estimated Repair Cost: $${inspection.estimated_repair_cost.toLocaleString()}`, 20, y);
        //     y += 15;
        // }

        // --- DAMAGE ASSESSMENT & RECOMMENDATION ---
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('Damage Assessment & Recommendation', 20, y);
        y += 10;

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');

        // Logic for recommendation
        let recommendation = 'Based on the AI analysis, the property exhibits minor to moderate damage in isolated areas. Repair is recommended for affected sections.';
        let damageJustification = 'Minimal impact to the overall water-shedding capabilities and structural integrity.';
        let isFullReplacementRecommended = false;

        const damagedSections = inspection.photos.filter(p => p.damage_detected);
        const hailDamagedSections = inspection.photos.filter(p => (p.hail_hits_per_sq || 0) >= hailThreshold);
        const windDamagedSections = inspection.photos.filter(p => (p.wind_damage_per_sq || 0) >= windThreshold);
        
        // Check for collateral damage (siding, gutters, etc.)
        const nonRoofDamage = inspection.photos.filter(p => 
            p.damage_type && p.damage_type.some(dt => {
                const lower = dt.toLowerCase();
                return lower.includes('siding') || lower.includes('gutter') || lower.includes('awning') || lower.includes('metal') || lower.includes('fence');
            })
        );

        if (hailDamagedSections.length > 0 && windDamagedSections.length > 0) {
            recommendation = `Severe storm damage detected. Multiple sections of the roof show significant hail (≥${hailThreshold} hits/sq) and wind (≥${windThreshold} damaged shingles/sq) damage.`;
            damageJustification = `The widespread nature of the damage across different roof slopes and the functional impairment of the roofing material, including compromise to its water-shedding ability, strongly justify full roof replacement.`;
            isFullReplacementRecommended = true;
        } else if (hailDamagedSections.length > 0) {
            recommendation = `Moderate to severe hail damage detected. At least ${hailDamagedSections.length} sections of the roof exceed the hail damage threshold (≥${hailThreshold} hits/sq).`;
            damageJustification = `The concentration of hail damage per test square indicates a compromised roofing system in multiple areas. This level of damage often warrants full replacement to restore the roof's integrity and extend its expected lifespan.`;
            isFullReplacementRecommended = true;
        } else if (windDamagedSections.length > 0) {
            recommendation = `Moderate to severe wind damage detected. At least ${windDamagedSections.length} sections of the roof show significant wind damage, exceeding the threshold (≥${windThreshold} damaged shingles/sq).`;
            damageJustification = `The presence of multiple wind-damaged shingles per test square in various sections points to compromised adhesion and structural integrity. Repairing isolated areas may not address the underlying susceptibility to future wind events, making full replacement a more durable solution.`;
            isFullReplacementRecommended = true;
        } else if (inspection.hail_damage_detected || inspection.wind_damage_detected) {
            recommendation = 'Minor to moderate storm damage detected. Isolated hail or wind impacts are present, but do not consistently meet replacement thresholds across multiple test squares.';
            damageJustification = 'While some damage exists, it primarily affects localized areas. Repairs to the specific damaged sections are feasible and recommended.';
            isFullReplacementRecommended = false;
        }

        if (nonRoofDamage.length > 0) {
            const collateralText = ` Collateral damage was also observed on ${nonRoofDamage.length} non-roof components (e.g., siding, gutters, soft metals), further supporting the presence of a significant storm event.`;
            damageJustification += collateralText;
        }

        // --- ITEL & MATCHING CODE LOGIC ---
        // Always append Code/ITEL justification if applicable, regardless of severity
        if (itelStatus === 'no_match') {
             const hasAnyDamage = inspection.hail_damage_detected || inspection.wind_damage_detected || damagedSections.length > 0;
             
             if (hasAnyDamage) {
                 if (applyOhioCode) {
                     // Ohio Code Logic
                     if (!isFullReplacementRecommended) {
                         isFullReplacementRecommended = true;
                         recommendation = 'FULL REPLACEMENT (Due to Material Discontinuation & Matching Code)';
                     } else {
                         recommendation += ' + CODE COMPLIANCE';
                     }
                     
                     damageJustification += `\n\nCRITICAL MATCHING ISSUE (OAC 3901-1-54): An ITEL report confirmed that the existing roofing material is discontinued/unavailable.\n\nPursuant to Ohio Administrative Code (OAC) 3901-1-54 (H)(1)(b), "When an interior or exterior loss requires replacement of an item and the replaced item does not match the quality, color or size of the item suffering the loss, the insurer shall replace as much of the item as to result in a reasonably uniform appearance."\n\nSince a reasonably uniform appearance cannot be achieved through spot repairs, replacement of the affected slopes/elevations is required to restore the property to its pre-loss condition.`;
                 } else {
                     // Standard No Match Logic
                     if (!isFullReplacementRecommended) {
                         recommendation = 'REPAIR ATTEMPT NOT FEASIBLE (Material Unavailable)';
                     }
                     damageJustification += `\n\nMATERIAL AVAILABILITY NOTE: An ITEL report indicates matching materials are not available. Repairs would result in significant aesthetic discrepancies/mismatch, potentially affecting property value.`;
                 }
             }
        }

        // Print Recommendation
        if (y > 260) { doc.addPage(); addHeader(); y = 40; }

        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(isFullReplacementRecommended ? 220 : 37, isFullReplacementRecommended ? 38 : 99, isFullReplacementRecommended ? 38 : 235);
        doc.text(`Recommendation: ${isFullReplacementRecommended ? 'FULL REPLACEMENT' : 'REPAIR'}`, 20, y);
        y += 7;

        doc.setTextColor(0,0,0);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const splitRecommendation = doc.splitTextToSize(recommendation, 170);
        y = printTextWithPagination(splitRecommendation, 20, y);
        y += 5;

        if (y > 260) { doc.addPage(); addHeader(); y = 40; }
        doc.setFont('helvetica', 'bold');
        doc.text('Justification:', 20, y);
        y += 5;
        doc.setFont('helvetica', 'normal');
        const splitJustification = doc.splitTextToSize(damageJustification, 170);
        y = printTextWithPagination(splitJustification, 20, y);
        y += 10;

        // Inspector Notes
        if (inspection.notes) {
            if (y > 260) { doc.addPage(); addHeader(); y = 40; }
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.text('Inspector Notes:', 20, y);
            y += 8;
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            const notesText = inspection.notes.replace(/Ø=P\s+/g, '');
            const splitNotes = doc.splitTextToSize(notesText, 170);
            y = printTextWithPagination(splitNotes, 20, y);
        }

        y += 10;

        // --- OVERALL SUMMARY SECTION ---
        if (y > 240) { doc.addPage(); addHeader(); y = 40; }
        
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('Overall Summary', 20, y);
        y += 10;

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        
        // Generate comprehensive summary based on analysis
        let overallSummary = '';
        const damagedPhotos = inspection.photos.filter(p => p.damage_detected);
        const totalPhotos = inspection.photos.length;
        const missingShingles = inspection.photos.reduce((sum, p) => sum + (p.wind_marks_counted || 0), 0);
        const hailHits = inspection.photos.reduce((sum, p) => sum + (p.hail_hits_counted || 0), 0);
        
        // Build summary based on damage findings
        let summaryParts = [];
        
        // Property overview
        summaryParts.push(`This drone inspection of ${inspection.customer_name || 'the property'} at ${inspection.property_address} was conducted on ${inspection.inspection_date} under ${inspection.weather_conditions || 'clear conditions'}.`);
        
        // Condition assessment
        summaryParts.push(`The roof is currently in ${inspection.overall_condition} condition.`);
        
        // Damage findings
        if (hailHits > 0 && missingShingles > 0) {
            summaryParts.push(`The inspection identified ${hailHits} hail impact marks and ${missingShingles} wind-damaged shingles across ${damagedPhotos.length} of ${totalPhotos} inspected areas, indicating significant storm damage affecting multiple roof sections.`);
        } else if (hailHits > 0) {
            summaryParts.push(`The inspection identified ${hailHits} hail impact marks across ${damagedPhotos.length} of ${totalPhotos} inspected areas. The concentration and pattern of impacts are consistent with severe hail storm activity.`);
        } else if (missingShingles > 0) {
            summaryParts.push(`The inspection identified ${missingShingles} wind-damaged shingles across ${damagedPhotos.length} of ${totalPhotos} inspected areas. Several areas show exposed underlayment, indicating compromised water protection.`);
        } else if (damagedPhotos.length > 0) {
            summaryParts.push(`The inspection identified minor damage in ${damagedPhotos.length} area(s). While visible, this damage does not meet threshold criteria for major repair or replacement recommendations.`);
        } else {
            summaryParts.push(`The inspection revealed no significant storm damage. The roof structure appears to be in satisfactory condition.`);
        }
        
        // Risk assessment
        if (missingShingles > 5) {
            summaryParts.push(`The extent of missing shingles presents an elevated risk of water intrusion into the structure. Prompt remediation is advised to prevent secondary damage.`);
        } else if (hailHits > 20) {
            summaryParts.push(`The concentrated hail damage may compromise the roof's ability to shed water effectively. Continued monitoring or preventive repairs are recommended.`);
        }
        
        // Material notes
        const discontinuedMaterials = inspection.photos.filter(p => p.likely_discontinued);
        if (discontinuedMaterials.length > 0) {
            summaryParts.push(`Note: Analysis indicates the presence of discontinued shingle profiles, which may impact repair and replacement options.`);
        }
        
        overallSummary = summaryParts.join(' ');

        const summaryLines = doc.splitTextToSize(overallSummary, 170);
        y = printTextWithPagination(summaryLines, 20, y);
        y += 8;

        // --- PAGE 2+: PHOTOS ---
        if (inspection.photos && inspection.photos.length > 0) {
            
            // Fetch all images concurrently first
            console.log(`📸 Fetching ${inspection.photos.length} images...`);
            const imagePromises = inspection.photos.map(async (photo) => {
                const url = photo.annotated_url || photo.url;
                if (!url) return null;
                try {
                    const res = await fetch(url);
                    const buf = await res.arrayBuffer();
                    return { ...photo, buffer: new Uint8Array(buf) };
                } catch (e) {
                    console.error('Failed to fetch image:', url, e);
                    return { ...photo, error: true };
                }
            });
            
            const processedPhotos = await Promise.all(imagePromises);
            
            let currentY = 40;
            let onFirstPage = true; // We are technically on page 1 still, need to add page for photos?
            // Actually let's just add a new page for photos immediately to keep it clean
            doc.addPage();
            addHeader();
            currentY = 40;

            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.text('Visual Evidence', 20, currentY);
            currentY += 15;

            for (let i = 0; i < processedPhotos.length; i++) {
                const photo = processedPhotos[i];
                if (!photo || photo.error) continue;

                // Check if we need a new page (give more space for detailed analysis)
                if (currentY + 140 > 280) {
                    doc.addPage();
                    addHeader();
                    currentY = 40;
                }

                // Image Box
                const imgWidth = 100;
                const imgHeight = 75;
                
                // Draw Image
                try {
                    let format = 'JPEG';
                    const urlLower = (photo.annotated_url || photo.url || '').toLowerCase();
                    
                    const header = photo.buffer.slice(0, 8);
                    const isPng = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47;
                    
                    if (isPng || urlLower.endsWith('.png')) {
                        format = 'PNG';
                    }
                    
                    doc.addImage(photo.buffer, format, 20, currentY, imgWidth, imgHeight);
                    
                    // Metadata Box next to image
                    const metaX = 130;
                    let metaY = currentY + 5;
                    
                    doc.setFontSize(11);
                    doc.setFont('helvetica', 'bold');
                    doc.text(`Photo ${i + 1}`, metaX, metaY);
                    metaY += 8;
                    
                    doc.setFontSize(9);
                    doc.setFont('helvetica', 'normal');
                    
                    if (photo.roof_section) {
                        doc.text(`Section: ${photo.roof_section}`, metaX, metaY);
                        metaY += 5;
                    }

                    // Shingle Type & Dimensions
                    if (photo.shingle_type && photo.shingle_type !== 'unknown') {
                        doc.setFont('helvetica', 'bold');
                        doc.text(`Type: ${photo.shingle_type}`, metaX, metaY);
                        metaY += 5;
                        doc.setFont('helvetica', 'normal');
                        
                        if (photo.shingle_exposure_inches > 0) {
                            doc.text(`Exposure: ${photo.shingle_exposure_inches}"`, metaX, metaY);
                            metaY += 4;
                        }
                        
                        if (photo.likely_discontinued) {
                            doc.setTextColor(220, 38, 38);
                            doc.setFont('helvetica', 'bold');
                            doc.text('⚠ Likely Discontinued', metaX, metaY);
                            metaY += 5;
                            doc.setTextColor(0);
                            doc.setFont('helvetica', 'normal');
                        }
                        metaY += 2;
                    }

                    // Damage Stats
                    if (photo.hail_hits_counted > 0 || photo.wind_marks_counted > 0) {
                        doc.setFont('helvetica', 'bold');
                        doc.setTextColor(220, 38, 38);
                        if (photo.hail_hits_counted > 0) {
                            doc.text(`${photo.hail_hits_counted} Hail Hits`, metaX, metaY);
                            metaY += 5;
                        }
                        if (photo.wind_marks_counted > 0) {
                            doc.text(`${photo.wind_marks_counted} Wind Marks`, metaX, metaY);
                            metaY += 5;
                        }
                        doc.setTextColor(0);
                        doc.setFont('helvetica', 'normal');
                    }

                    // Severity
                    if (photo.severity && photo.severity !== 'none') {
                        doc.setFont('helvetica', 'bold');
                        const sevColor = photo.severity === 'severe' ? [220, 38, 38] : 
                                        photo.severity === 'moderate' ? [234, 88, 12] : [202, 138, 4];
                        doc.setTextColor(...sevColor);
                        doc.text(`Severity: ${photo.severity.toUpperCase()}`, metaX, metaY);
                        metaY += 5;
                        doc.setTextColor(0);
                        doc.setFont('helvetica', 'normal');
                    }

                    // User Notes
                    if (photo.user_notes) {
                         doc.setFont('helvetica', 'italic');
                         const notes = doc.splitTextToSize(`Note: ${photo.user_notes}`, 70);
                         doc.text(notes, metaX, metaY);
                         metaY += (notes.length * 4) + 2;
                         doc.setFont('helvetica', 'normal');
                    }

                    doc.setDrawColor(200);
                    doc.rect(20, currentY, imgWidth, imgHeight);

                } catch (imgErr) {
                    console.error('Error adding image to PDF:', imgErr);
                    doc.text('[Image Error]', 20, currentY + 10);
                }

                // DETAILED ANALYSIS BELOW IMAGE (Full Width)
                currentY += imgHeight + 5;

                // Full AI analysis text for detailed report
                if (photo.ai_analysis) {
                    if (currentY > 265) {
                        doc.addPage();
                        addHeader();
                        currentY = 45;
                    }

                    doc.setFontSize(9);
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(40, 40, 40);
                    
                    const aiSplit = doc.splitTextToSize(photo.ai_analysis, 170);
                    for (const line of aiSplit) {
                        if (currentY > 275) {
                            doc.addPage();
                            addHeader();
                            currentY = 45;
                        }
                        doc.text(line, 20, currentY);
                        currentY += 4;
                    }
                    doc.setTextColor(0);
                    currentY += 3;
                }

                // Damage summary with professional terminology
                let damageSummary = '';
                if (photo.damage_detected && (photo.hail_hits_counted > 0 || photo.wind_marks_counted > 0)) {
                    const findings = [];
                    
                    if (photo.hail_hits_counted > 0) {
                        findings.push(`${photo.hail_hits_counted} hail impact mark${photo.hail_hits_counted !== 1 ? 's' : ''}`);
                    }
                    if (photo.wind_marks_counted > 0) {
                        findings.push(`${photo.wind_marks_counted} wind damage mark${photo.wind_marks_counted !== 1 ? 's' : ''}`);
                    }

                    damageSummary = `Damage Count: ${findings.join(' and ')}.`;
                    
                    // Add material/exposure info
                    if (photo.shingle_type && photo.shingle_type !== 'unknown') {
                        damageSummary += ` Material: ${photo.shingle_type}`;
                        if (photo.shingle_exposure_inches > 0) {
                            damageSummary += ` (${photo.shingle_exposure_inches}" exposure)`;
                        }
                        if (photo.likely_discontinued) {
                            damageSummary += ` — LIKELY DISCONTINUED`;
                        }
                    }
                }

                if (damageSummary) {
                    if (currentY > 275) {
                        doc.addPage();
                        addHeader();
                        currentY = 45;
                    }

                    doc.setFontSize(9);
                    doc.setFont('helvetica', 'bold');
                    doc.setTextColor(50, 50, 50);
                    const damageSplit = doc.splitTextToSize(damageSummary, 170);
                    for (const line of damageSplit) {
                        if (currentY > 275) {
                            doc.addPage();
                            addHeader();
                            currentY = 45;
                        }
                        doc.text(line, 20, currentY);
                        currentY += 4;
                    }
                    doc.setTextColor(0);
                    doc.setFont('helvetica', 'normal');
                    currentY += 8;
                }

                currentY += 5; // Space before next photo
            }
        }

        // Add page numbers
        const pageCount = doc.internal.getNumberOfPages();
        for(let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            addFooter(i);
        }
        
        console.log('✅ PDF generated, encoding to base64...');
        const pdfBase64 = doc.output('datauristring');
        const fileName = `drone-report-${inspection.inspection_number || Date.now()}.pdf`;

        return Response.json({ 
            success: true,
            pdf_base64: pdfBase64,
            file_name: fileName
        });

    } catch (error) {
        console.error('❌ Report Generation Error:', error);
        return Response.json({ 
            error: 'Failed to generate report', 
            details: error.message 
        }, { status: 500 });
    }
});