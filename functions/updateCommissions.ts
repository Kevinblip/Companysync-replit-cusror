import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const { paymentId, invoiceId, amount, salesRepEmail } = await req.json();

        if (!paymentId || !amount) {
            return Response.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Get the invoice to find commission splits or sales rep
        let invoice = null;
        if (invoiceId) {
            const invoices = await base44.asServiceRole.entities.Invoice.filter({ id: invoiceId });
            if (invoices.length > 0) {
                invoice = invoices[0];
            }
        }

        // Determine who gets commissions
        let commissionRecipients = [];

        // Check for commission splits first
        if (invoice?.commission_splits && invoice.commission_splits.length > 0) {
            // Multiple recipients with split percentages
            commissionRecipients = invoice.commission_splits.map(split => ({
                email: split.user_email,
                splitPercentage: split.split_percentage || 100,
                role: split.role || 'Sales'
            }));
        } else {
            // Single recipient (legacy flow)
            const repEmail = salesRepEmail || invoice?.sale_agent || invoice?.created_by;
            if (!repEmail) {
                return Response.json({ error: 'Could not determine sales rep' }, { status: 400 });
            }
            commissionRecipients = [{ email: repEmail, splitPercentage: 100, role: 'Sales' }];
        }

        const results = [];

        // Process commission for each recipient
        for (const recipient of commissionRecipients) {
            try {
                // Get the staff profile
                const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ 
                    user_email: recipient.email 
                });

                if (staffProfiles.length === 0) {
                    console.warn(`Staff profile not found for ${recipient.email}`);
                    continue;
                }

                const staffProfile = staffProfiles[0];

                // Get applicable commission rules
                const companyId = invoice?.company_id || staffProfile.company_id;
                const commissionRules = await base44.asServiceRole.entities.CommissionRule.filter({
                    company_id: companyId,
                    is_active: true
                });

                // Find the best matching rule
                let applicableRule = null;
                let highestPriority = -1;

                for (const rule of commissionRules) {
                    // Check if rule applies to this staff member
                    if (rule.applies_to_staff_email && rule.applies_to_staff_email !== recipient.email) {
                        continue;
                    }
                    if (rule.applies_to_role_id && rule.applies_to_role_id !== staffProfile.role_id) {
                        continue;
                    }

                    // Check amount thresholds
                    if (rule.min_deal_amount && amount < rule.min_deal_amount) {
                        continue;
                    }
                    if (rule.max_deal_amount && amount > rule.max_deal_amount) {
                        continue;
                    }

                    // Check priority
                    if ((rule.priority || 0) > highestPriority) {
                        highestPriority = rule.priority || 0;
                        applicableRule = rule;
                    }
                }

                // Calculate commission rate
                let commissionRate = staffProfile.commission_rate || 5; // Default 5%

                if (applicableRule) {
                    // Check if tiered rates apply
                    if (applicableRule.tiered_rates && applicableRule.tiered_rates.length > 0) {
                        const currentPeriodSales = staffProfile.current_period_sales || 0;
                        
                        // Find applicable tier based on current period sales
                        let applicableTier = applicableRule.tiered_rates[0];
                        for (const tier of applicableRule.tiered_rates) {
                            if (currentPeriodSales >= tier.threshold_amount) {
                                applicableTier = tier;
                            }
                        }
                        commissionRate = applicableTier.rate_percentage;
                    } else {
                        commissionRate = applicableRule.base_rate_percentage;
                    }
                }

                // Apply split percentage
                const splitFactor = recipient.splitPercentage / 100;
                const commissionAmount = amount * (commissionRate / 100) * splitFactor;

                // Update staff profile
                const newTotalCommissions = (staffProfile.total_commissions_earned || 0) + commissionAmount;
                const newPeriodSales = (staffProfile.current_period_sales || 0) + (amount * splitFactor);

                await base44.asServiceRole.entities.StaffProfile.update(staffProfile.id, {
                    total_commissions_earned: newTotalCommissions,
                    current_period_sales: newPeriodSales
                });

                results.push({
                    email: recipient.email,
                    commissionAmount: commissionAmount,
                    splitPercentage: recipient.splitPercentage,
                    commissionRate: commissionRate,
                    appliedRule: applicableRule?.rule_name || 'Default Rate',
                    newTotalCommissions: newTotalCommissions
                });

            } catch (error) {
                console.error(`Error processing commission for ${recipient.email}:`, error);
                results.push({
                    email: recipient.email,
                    error: error.message
                });
            }
        }

        return Response.json({
            success: true,
            paymentId: paymentId,
            totalAmount: amount,
            recipients: results
        });

    } catch (error) {
        console.error('Commission Update Error:', error);
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});