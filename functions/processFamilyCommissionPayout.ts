import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Authenticate user
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { commission_record_id, family_member_id, test_mode } = await req.json();

        if (!commission_record_id && !family_member_id) {
            return Response.json({ error: 'commission_record_id or family_member_id required' }, { status: 400 });
        }

        const WISE_API_KEY = Deno.env.get('WISE_API_KEY');
        if (!WISE_API_KEY) {
            return Response.json({ error: 'WISE_API_KEY not configured' }, { status: 500 });
        }

        let commissionRecords = [];
        let familyMember = null;

        // Get commission record(s) to pay out
        if (commission_record_id) {
            const record = await base44.asServiceRole.entities.FamilyCommissionRecord.filter({ id: commission_record_id });
            if (record.length === 0) {
                return Response.json({ error: 'Commission record not found' }, { status: 404 });
            }
            commissionRecords = [record[0]];
            
            // Get family member
            const members = await base44.asServiceRole.entities.FamilyMember.filter({ id: record[0].family_member_id });
            familyMember = members[0];
        } else if (family_member_id) {
            // Get all pending commissions for this family member
            const members = await base44.asServiceRole.entities.FamilyMember.filter({ id: family_member_id });
            if (members.length === 0) {
                return Response.json({ error: 'Family member not found' }, { status: 404 });
            }
            familyMember = members[0];
            
            commissionRecords = await base44.asServiceRole.entities.FamilyCommissionRecord.filter({
                family_member_id: family_member_id,
                status: 'pending'
            });
        }

        if (!familyMember) {
            return Response.json({ error: 'Family member not found' }, { status: 404 });
        }

        // Check if bank details are set up
        if (!familyMember.bank_account_number || !familyMember.bank_routing_number) {
            return Response.json({ 
                error: 'Bank account details not configured for this family member',
                family_member: familyMember.full_name
            }, { status: 400 });
        }

        if (commissionRecords.length === 0) {
            return Response.json({ 
                message: 'No pending commissions to pay out',
                family_member: familyMember.full_name
            });
        }

        // Calculate total amount
        const totalAmount = commissionRecords.reduce((sum, record) => sum + record.commission_amount, 0);

        // Check minimum threshold
        if (familyMember.minimum_payout_threshold && totalAmount < familyMember.minimum_payout_threshold) {
            return Response.json({
                message: `Total commission $${totalAmount.toFixed(2)} is below minimum threshold $${familyMember.minimum_payout_threshold}`,
                total_amount: totalAmount,
                threshold: familyMember.minimum_payout_threshold,
                pending_records: commissionRecords.length
            });
        }

        console.log(`💰 Processing payout: $${totalAmount.toFixed(2)} to ${familyMember.full_name}`);

        // Test mode - just mark as paid without actually sending money
        if (test_mode) {
            for (const record of commissionRecords) {
                await base44.asServiceRole.entities.FamilyCommissionRecord.update(record.id, {
                    status: 'paid',
                    paid_date: new Date().toISOString(),
                    notes: `Test mode payout - not actually sent via Wise`
                });
            }

            await base44.asServiceRole.entities.FamilyMember.update(familyMember.id, {
                total_earned: (familyMember.total_earned || 0) + totalAmount,
                last_commission_date: new Date().toISOString()
            });

            return Response.json({
                success: true,
                test_mode: true,
                message: `Test payout completed - $${totalAmount.toFixed(2)} marked as paid (not actually sent)`,
                total_amount: totalAmount,
                records_paid: commissionRecords.length,
                family_member: familyMember.full_name
            });
        }

        // Step 1: Create or get Wise recipient
        let recipientId = familyMember.wise_recipient_id;
        
        if (!recipientId) {
            console.log('📝 Creating Wise recipient...');
            
            const recipientPayload = {
                currency: 'USD',
                type: 'aba',
                profile: Deno.env.get('WISE_PROFILE_ID'), // You'll need to set this
                accountHolderName: familyMember.bank_account_holder || familyMember.full_name,
                legalType: 'PRIVATE',
                details: {
                    accountNumber: familyMember.bank_account_number,
                    routingNumber: familyMember.bank_routing_number,
                    accountType: 'CHECKING',
                    address: {
                        country: familyMember.bank_country || 'US',
                        city: 'Unknown',
                        postCode: '00000',
                        firstLine: 'Address on file'
                    }
                }
            };

            const recipientResponse = await fetch('https://api.transferwise.com/v1/accounts', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${WISE_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(recipientPayload)
            });

            if (!recipientResponse.ok) {
                const error = await recipientResponse.text();
                console.error('Wise recipient creation failed:', error);
                return Response.json({ 
                    error: 'Failed to create Wise recipient', 
                    details: error 
                }, { status: 500 });
            }

            const recipient = await recipientResponse.json();
            recipientId = recipient.id;

            // Save recipient ID
            await base44.asServiceRole.entities.FamilyMember.update(familyMember.id, {
                wise_recipient_id: recipientId
            });

            console.log(`✅ Wise recipient created: ${recipientId}`);
        }

        // Step 2: Create quote
        console.log('💵 Creating Wise quote...');
        
        const quotePayload = {
            sourceCurrency: 'USD',
            targetCurrency: 'USD',
            sourceAmount: totalAmount,
            profile: Deno.env.get('WISE_PROFILE_ID')
        };

        const quoteResponse = await fetch('https://api.transferwise.com/v3/profiles/{profileId}/quotes', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WISE_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(quotePayload)
        });

        if (!quoteResponse.ok) {
            const error = await quoteResponse.text();
            return Response.json({ error: 'Failed to create quote', details: error }, { status: 500 });
        }

        const quote = await quoteResponse.json();

        // Step 3: Create transfer
        console.log('🚀 Creating Wise transfer...');
        
        const transferPayload = {
            targetAccount: recipientId,
            quoteUuid: quote.id,
            customerTransactionId: `family-commission-${Date.now()}`,
            details: {
                reference: `Commission payout - ${commissionRecords.length} payment${commissionRecords.length > 1 ? 's' : ''}`
            }
        };

        const transferResponse = await fetch('https://api.transferwise.com/v1/transfers', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WISE_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(transferPayload)
        });

        if (!transferResponse.ok) {
            const error = await transferResponse.text();
            return Response.json({ error: 'Failed to create transfer', details: error }, { status: 500 });
        }

        const transfer = await transferResponse.json();

        // Step 4: Fund the transfer (if you have Wise balance)
        const fundResponse = await fetch(`https://api.transferwise.com/v3/profiles/{profileId}/transfers/${transfer.id}/payments`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WISE_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ type: 'BALANCE' })
        });

        if (!fundResponse.ok) {
            console.warn('⚠️ Auto-funding failed - may need manual funding in Wise dashboard');
        }

        // Update commission records to paid
        for (const record of commissionRecords) {
            await base44.asServiceRole.entities.FamilyCommissionRecord.update(record.id, {
                status: 'paid',
                paid_date: new Date().toISOString(),
                notes: `Paid via Wise - Transfer ID: ${transfer.id}`
            });
        }

        // Update family member totals
        await base44.asServiceRole.entities.FamilyMember.update(familyMember.id, {
            total_earned: (familyMember.total_earned || 0) + totalAmount,
            last_commission_date: new Date().toISOString()
        });

        console.log(`✅ Payout complete! Transfer ID: ${transfer.id}`);

        return Response.json({
            success: true,
            message: `Successfully sent $${totalAmount.toFixed(2)} to ${familyMember.full_name}`,
            total_amount: totalAmount,
            records_paid: commissionRecords.length,
            wise_transfer_id: transfer.id,
            wise_status: transfer.status,
            family_member: familyMember.full_name
        });

    } catch (error) {
        console.error('❌ Payout error:', error);
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
});