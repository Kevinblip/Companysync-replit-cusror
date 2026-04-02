import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfDay, endOfDay, format } from 'npm:date-fns@3.0.0';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const { period, companyId } = await req.json();

        if (!companyId) {
            return Response.json({ error: 'companyId required' }, { status: 400 });
        }

        const getDateRange = (periodType) => {
            const now = new Date();
            
            switch(periodType) {
                case 'today': {
                    return { start: startOfDay(now), end: endOfDay(now) };
                }
                case 'this_week': {
                    return { start: startOfWeek(now), end: endOfWeek(now) };
                }
                case 'this_month': {
                    return { start: startOfMonth(now), end: endOfMonth(now) };
                }
                default: {
                    return { start: startOfMonth(now), end: endOfMonth(now) };
                }
            }
        };

        const { start, end } = getDateRange(period || 'this_month');

        const [staffProfiles, invoices, customers, payments, deductions, commissionPayments] = await Promise.all([
            base44.asServiceRole.entities.StaffProfile.filter({ company_id: companyId }),
            base44.asServiceRole.entities.Invoice.list("-created_date", 10000),
            base44.asServiceRole.entities.Customer.list("-created_date", 10000),
            base44.asServiceRole.entities.Payment.list("-created_date", 10000),
            base44.asServiceRole.entities.CommissionDeduction.filter({ company_id: companyId }),
            base44.asServiceRole.entities.CommissionPayment.filter({ company_id: companyId })
        ]);

        const periodPayments = payments.filter(p => {
            if (!p.payment_date) return false;
            const paymentDate = new Date(p.payment_date);
            return paymentDate >= start && paymentDate <= end;
        });

        const owedSummary = [];
        let totalOwed = 0;

        for (const staff of staffProfiles) {
            const repInvoices = invoices.filter(inv => {
                if (inv.sale_agent === staff.user_email) return true;
                if (inv.commission_splits?.some(cs => cs.user_email === staff.user_email)) return true;
                
                const customer = customers.find(c => c.name === inv.customer_name);
                if (customer) {
                    const assignedUsers = customer.assigned_to_users || (customer.assigned_to ? [customer.assigned_to] : []);
                    if (assignedUsers.includes(staff.user_email)) return true;
                }
                
                return false;
            });

            const repPayments = periodPayments.filter(payment => {
                const invoice = repInvoices.find(inv => 
                    inv.id === payment.invoice_id || 
                    inv.invoice_number === payment.invoice_number ||
                    inv.customer_name === payment.customer_name
                );
                return invoice !== undefined;
            });

            let grossCommission = 0;

            repPayments.forEach(payment => {
                const invoice = repInvoices.find(inv => 
                    inv.id === payment.invoice_id || 
                    inv.invoice_number === payment.invoice_number
                );

                if (invoice) {
                    const commissionRate = staff.commission_rate || 10;
                    let repCommission = payment.amount * (commissionRate / 100);

                    if (invoice.commission_splits && invoice.commission_splits.length > 0) {
                        const repSplit = invoice.commission_splits.find(cs => cs.user_email === staff.user_email);
                        if (repSplit) {
                            const splitPercentage = repSplit.split_percentage / 100;
                            repCommission = payment.amount * (commissionRate / 100) * splitPercentage;
                        }
                    }

                    grossCommission += repCommission;
                }
            });

            const repDeductions = deductions.filter(d => {
                if (d.sales_rep_email !== staff.user_email) return false;
                if (!d.deduction_date) return false;
                const deductionDate = new Date(d.deduction_date);
                return deductionDate >= start && deductionDate <= end;
            });
            
            const totalDeductions = repDeductions.reduce((sum, d) => sum + (d.amount || 0), 0);
            const netCommission = grossCommission - totalDeductions;

            const periodKey = format(start, 'yyyy-MM');
            const isPaid = commissionPayments.some(cp => 
                cp.sales_rep_email === staff.user_email && 
                cp.pay_period === periodKey &&
                cp.status === 'paid'
            );

            if (netCommission > 0 && !isPaid) {
                owedSummary.push({
                    name: staff.full_name,
                    email: staff.user_email,
                    netCommission,
                    grossCommission,
                    totalDeductions,
                    paymentCount: repPayments.length
                });
                totalOwed += netCommission;
            }
        }

        const periodLabel = period === 'today' ? 'today' :
                          period === 'this_week' ? 'this week' :
                          period === 'this_month' ? 'this month' :
                          'this period';

        return Response.json({
            success: true,
            period: periodLabel,
            dateRange: {
                start: format(start, 'MMM d, yyyy'),
                end: format(end, 'MMM d, yyyy')
            },
            totalOwed,
            owedCount: owedSummary.length,
            owedSummary
        });

    } catch (error) {
        console.error('notifyCommissionsOwed error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});