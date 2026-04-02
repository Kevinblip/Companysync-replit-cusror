import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear, subYears, startOfWeek, endOfWeek, startOfDay, endOfDay, format } from 'npm:date-fns@3.0.0';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { period } = await req.json();

        const companies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
        if (companies.length === 0) {
            return Response.json({ error: 'No company found' }, { status: 404 });
        }
        const myCompany = companies[0];

        const getDateRange = (periodType) => {
            const now = new Date();
            
            switch(periodType) {
                case 'today': {
                    const todayStart = startOfDay(now);
                    const todayEnd = endOfDay(now);
                    return { start: todayStart, end: todayEnd };
                }
                
                case 'this_week': {
                    const weekStart = startOfWeek(now);
                    const weekEnd = endOfWeek(now);
                    return { start: weekStart, end: weekEnd };
                }
                
                case 'this_month': {
                    const monthStart = startOfMonth(now);
                    const monthEnd = endOfMonth(now);
                    return { start: monthStart, end: monthEnd };
                }
                
                case 'last_month': {
                    const lastMonth = subMonths(now, 1);
                    const lastMonthStart = startOfMonth(lastMonth);
                    const lastMonthEnd = endOfMonth(lastMonth);
                    return { start: lastMonthStart, end: lastMonthEnd };
                }
                
                case 'this_year': {
                    const yearStart = startOfYear(now);
                    const yearEnd = endOfYear(now);
                    return { start: yearStart, end: yearEnd };
                }
                
                case 'last_year': {
                    const lastYear = subYears(now, 1);
                    const lastYearStart = startOfYear(lastYear);
                    const lastYearEnd = endOfYear(lastYear);
                    return { start: lastYearStart, end: lastYearEnd };
                }
                
                default: {
                    const defaultStart = startOfMonth(now);
                    const defaultEnd = endOfMonth(now);
                    return { start: defaultStart, end: defaultEnd };
                }
            }
        };

        const { start, end } = getDateRange(period || 'this_month');

        const [staffProfiles, invoices, customers, payments, deductions] = await Promise.all([
            base44.asServiceRole.entities.StaffProfile.filter({ company_id: myCompany.id }),
            base44.asServiceRole.entities.Invoice.list("-created_date", 10000),
            base44.asServiceRole.entities.Customer.list("-created_date", 10000),
            base44.asServiceRole.entities.Payment.list("-created_date", 10000),
            base44.asServiceRole.entities.CommissionDeduction.filter({ company_id: myCompany.id })
        ]);

        const periodPayments = payments.filter(p => {
            if (!p.payment_date) return false;
            const paymentDate = new Date(p.payment_date);
            return paymentDate >= start && paymentDate <= end;
        });

        const commissionsData = {};

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
            const splitCommissions = [];

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
                            
                            splitCommissions.push({
                                invoice: invoice.invoice_number,
                                customer: payment.customer_name,
                                amount: payment.amount,
                                splitPercentage: repSplit.split_percentage,
                                role: repSplit.role,
                                commission: repCommission
                            });
                        }
                    }

                    grossCommission += repCommission;
                }
            });

            const totalSales = repPayments.reduce((sum, payment) => sum + (payment.amount || 0), 0);

            const repDeductions = deductions.filter(d => {
                if (d.sales_rep_email !== staff.user_email) return false;
                if (!d.deduction_date) return false;
                const deductionDate = new Date(d.deduction_date);
                return deductionDate >= start && deductionDate <= end;
            });
            
            const ladderAssistDeductions = repDeductions.filter(d => d.deduction_type === 'ladder_assist');
            const totalLadderAssist = ladderAssistDeductions.reduce((sum, d) => sum + (d.amount || 0), 0);
            const totalDeductions = repDeductions.reduce((sum, d) => sum + (d.amount || 0), 0);
            const netCommission = grossCommission - totalDeductions;

            commissionsData[staff.user_email] = {
                name: staff.full_name,
                email: staff.user_email,
                totalSales,
                commissionRate: staff.commission_rate || 10,
                grossCommission,
                splitCommissions,
                deductionsCount: repDeductions.length,
                ladderAssistCount: ladderAssistDeductions.length,
                totalLadderAssist,
                totalDeductions,
                netCommission,
                paymentCount: repPayments.length
            };
        }

        const reps = Object.values(commissionsData);
        const summary = {
            totalGross: reps.reduce((sum, rep) => sum + rep.grossCommission, 0),
            totalLadderAssist: reps.reduce((sum, rep) => sum + rep.totalLadderAssist, 0),
            totalDeductions: reps.reduce((sum, rep) => sum + rep.totalDeductions, 0),
            totalNet: reps.reduce((sum, rep) => sum + rep.netCommission, 0),
            totalSplits: reps.reduce((sum, rep) => sum + rep.splitCommissions.length, 0),
            period: period || 'this_month',
            dateRange: {
                start: format(start, 'yyyy-MM-dd'),
                end: format(end, 'yyyy-MM-dd')
            }
        };

        return Response.json({
            success: true,
            summary,
            byRep: commissionsData
        });

    } catch (error) {
        console.error('getCommissionData error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});