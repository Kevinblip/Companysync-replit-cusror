import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Authenticate user
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get company_id from request body
        const { company_id } = await req.json().catch(() => ({}));
        
        if (!company_id) {
            return Response.json({ error: 'company_id is required' }, { status: 400 });
        }

        console.log('🏷️ Starting smart categorization for user:', user.email, 'company:', company_id);

        // Get all items with "Other" category for this company only
        let items = [];
        try {
            items = await base44.asServiceRole.entities.PriceListItem.filter({ 
                company_id: company_id,
                category: "Other" 
            });
            console.log(`📊 Found ${items.length} items to categorize`);
        } catch (fetchError) {
            console.error('Error fetching items:', fetchError);
            return Response.json({ 
                error: 'Failed to fetch items: ' + fetchError.message 
            }, { status: 500 });
        }

        let updated = 0;
        let skipped = 0;

        for (const item of items) {
            const desc = (item.description || '').toUpperCase();
            const code = (item.code || '').toUpperCase();
            const combined = desc + ' ' + code;
            
            let newCategory = 'Other';

            // ROOFING
            if (combined.includes('ROOF') || combined.includes('SHINGLE') || combined.includes('RFG') ||
                combined.includes('RIDGE') || combined.includes('HIP') || combined.includes('VALLEY') ||
                combined.includes('EAVE') || combined.includes('RAKE') || combined.includes('FLASHING') ||
                combined.includes('UNDERLAYMENT') || combined.includes('FELT') || combined.includes('DRIP EDGE') ||
                combined.includes('STARTER') || combined.includes('ICE AND WATER') || combined.includes('ICE & WATER') ||
                combined.includes('WATER BARRIER') || combined.includes('WATER BARR') || combined.includes('CHIMNEY') ||
                combined.includes('VENT - TURTLE') || combined.includes('SOFFIT VENT') || combined.includes('SNOW GUARD')) {
                newCategory = 'Roofing';
            }
            // SIDING
            else if (combined.includes('SIDING') || combined.includes('SID') || combined.includes('FASCIA') || 
                     combined.includes('SOFFIT') || combined.includes('SHUTTER') || combined.includes('AWNING') ||
                     combined.includes('J-VENT') || combined.includes('J-BLOCK') || combined.includes('CORNER POST')) {
                newCategory = 'Siding';
            }
            // WINDOWS
            else if (combined.includes('WINDOW') && !combined.includes('DOOR')) {
                newCategory = 'Windows';
            }
            // DOORS
            else if (combined.includes('DOOR') || combined.includes('OVERHEAD DOOR') || 
                     combined.includes('FINISH HARDWARE') || combined.includes('STORM DOOR')) {
                newCategory = 'Doors';
            }
            // INTERIOR
            else if (combined.includes('DRYWALL') || combined.includes('PAINT') || combined.includes('TEXTURE') ||
                     combined.includes('PLASTER') || combined.includes('BASEBOARD') || combined.includes('TRIM') ||
                     combined.includes('CEILING') || combined.includes('VANITY') || combined.includes('BATHTUB') ||
                     combined.includes('TILE') || combined.includes('MARBLE') || combined.includes('FLOOR') ||
                     combined.includes('CARPET') || combined.includes('VINYL FLOOR') || combined.includes('STONE FLOOR') ||
                     combined.includes('WOOD FLOOR') || combined.includes('STAIR') || combined.includes('CORBEL') ||
                     combined.includes('MEDALLION')) {
                newCategory = 'Interior';
            }
            // EXTERIOR
            else if (combined.includes('FENCE') || combined.includes('GUTTER') || combined.includes('DOWNSPOUT') ||
                     combined.includes('STUCCO') || combined.includes('MASONRY') || combined.includes('BRICK') ||
                     combined.includes('CONCRETE') || combined.includes('STRUCTURAL STEEL') || combined.includes('ORNAMENTAL IRON') ||
                     combined.includes('POST') || combined.includes('RAILING') || combined.includes('DECK') ||
                     combined.includes('CONDUCTOR HEAD') || combined.includes('BOARDUP') || combined.includes('BOARD-UP') ||
                     combined.includes('BARRICADE') || combined.includes('TEMPORARY FENCE')) {
                newCategory = 'Exterior';
            }
            // HVAC
            else if (combined.includes('HVAC') || combined.includes('HEAT') || combined.includes('AIR COND') ||
                     combined.includes('VENT') && !combined.includes('ROOF VENT') || combined.includes('EXHAUST FAN') ||
                     combined.includes('VENTILATION') || combined.includes('THERMOSTAT') || combined.includes('HEATER') ||
                     combined.includes('WALL HEATER') || combined.includes('RADIANT HEAT')) {
                newCategory = 'HVAC';
            }
            // PLUMBING (exclude roofing water barriers)
            else if ((combined.includes('PLUMB') || combined.includes('PIPE') ||
                     combined.includes('DRAIN') || combined.includes('EXTRACT') || combined.includes('REMEDIATION') ||
                     (combined.includes('WATER') && !combined.includes('BARRIER') && !combined.includes('ICE')))) {
                newCategory = 'Plumbing';
            }
            // ELECTRICAL
            else if (combined.includes('ELECTRIC') || combined.includes('WIRING') || combined.includes('OUTLET') ||
                     combined.includes('SWITCH') || combined.includes('BREAKER') || combined.includes('PANEL') ||
                     combined.includes('LIGHT') && !combined.includes('SUNLIGHT') || combined.includes('FIXTURE') ||
                     combined.includes('CHANDELIER') || combined.includes('FLUORESCENT') || combined.includes('LED') ||
                     combined.includes('CONDUIT') || combined.includes('WIRE') || combined.includes('VOLT') ||
                     combined.includes('GFI') || combined.includes('GFCI') || combined.includes('METER') ||
                     combined.includes('DIMMER') || combined.includes('OCCUPANCY SENSOR') || combined.includes('SMOKE DETECTOR') ||
                     combined.includes('CARBON MONOXIDE') || combined.includes('ALARM') || combined.includes('GENERATOR') ||
                     combined.includes('SOLAR PANEL') || combined.includes('BATTERY') || combined.includes('UPS') ||
                     combined.includes('CAMERA') || combined.includes('SECURITY SYSTEM') || combined.includes('INTERCOM') ||
                     combined.includes('SURVEILLANCE') || combined.includes('TELEPHONE') || combined.includes('NETWORK') ||
                     combined.includes('CABLE') && !combined.includes('TRUNK')) {
                newCategory = 'Electrical';
            }

            // Only update if category actually changed
            if (newCategory !== 'Other') {
                await base44.asServiceRole.entities.PriceListItem.update(item.id, {
                    category: newCategory
                });
                updated++;
                console.log(`✅ ${item.code}: ${item.description.substring(0, 40)}... → ${newCategory}`);
            } else {
                skipped++;
            }
        }

        console.log(`🎉 Categorization complete!`);
        console.log(`✅ Updated: ${updated}`);
        console.log(`⏭️ Skipped (kept as Other): ${skipped}`);

        return Response.json({
            success: true,
            total: items.length,
            updated: updated,
            skipped: skipped,
            message: `Categorized ${updated} items, ${skipped} remain as "Other"`
        });

    } catch (error) {
        console.error('❌ Error:', error);
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
});