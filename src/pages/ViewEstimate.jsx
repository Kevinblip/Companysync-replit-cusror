import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, ThumbsUp, ThumbsDown, CheckCircle2, XCircle, Download, MapPin, Calendar, Phone, Mail, DollarSign, ExternalLink } from "lucide-react";
import { format } from "date-fns";

function calcMonthlyPayment(principal, annualRatePct, termMonths) {
  if (!principal || principal <= 0) return 0;
  if (!annualRatePct || annualRatePct <= 0) return principal / termMonths;
  const r = annualRatePct / 12 / 100;
  return principal * r * Math.pow(1 + r, termMonths) / (Math.pow(1 + r, termMonths) - 1);
}

function parseAprMidpoint(aprRange) {
  if (!aprRange) return 12.99;
  const matches = aprRange.match(/[\d.]+/g);
  if (!matches || matches.length === 0) return 12.99;
  const nums = matches.map(Number);
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function FinancingCard({ estimate, company, financing }) {
  const total = Number(estimate.amount || 0);
  if (!total || total <= 0) return null;

  const terms = financing.terms || [12, 24, 36, 60, 120];
  const aprMid = parseAprMidpoint(financing.apr_range);
  const provider = financing.provider || 'hearth';
  const partnerId = financing.hearth_partner_id || '';
  const companyName = encodeURIComponent(company?.company_name || '');
  const amountCents = Math.round(total);

  let applyUrl = '';
  if (provider === 'hearth' && partnerId) {
    applyUrl = `https://app.gethearth.com/partners/${partnerId}?amount=${amountCents}&contractor_name=${companyName}`;
  } else if (provider === 'custom' && financing.custom_url) {
    applyUrl = financing.custom_url.replace('{amount}', amountCents);
  } else if (provider === 'greensky') {
    applyUrl = 'https://www.greensky.com/apply/';
  } else if (provider === 'wisetack') {
    applyUrl = 'https://wisetack.com/';
  }

  const lowestPayment = Math.min(...terms.map(t => calcMonthlyPayment(total, aprMid, t)));

  return (
    <Card className="border-2 border-green-200 bg-gradient-to-br from-green-50 to-emerald-50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-green-800">
          <DollarSign className="w-5 h-5" />
          Finance This Project
        </CardTitle>
        <p className="text-sm text-green-700">
          As low as <strong>${lowestPayment.toFixed(0)}/mo</strong> — get pre-approved in minutes with no impact to your credit score.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-green-200">
                <th className="text-left py-2 font-semibold text-green-800">Loan Term</th>
                <th className="text-right py-2 font-semibold text-green-800">Est. Monthly Payment</th>
                <th className="text-right py-2 font-semibold text-green-800 hidden sm:table-cell">APR Range</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-green-100">
              {terms.map(term => {
                const payment = calcMonthlyPayment(total, aprMid, term);
                return (
                  <tr key={term} data-testid={`row-financing-term-${term}`}>
                    <td className="py-2.5 text-gray-700">{term} months ({(term / 12).toFixed(1).replace('.0', '')} {term === 12 ? 'year' : 'years'})</td>
                    <td className="py-2.5 text-right font-semibold text-green-700">${payment.toFixed(0)}<span className="text-xs font-normal text-gray-500">/mo</span></td>
                    <td className="py-2.5 text-right text-gray-500 text-xs hidden sm:table-cell">{financing.apr_range || '6.99%–24.99%'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {applyUrl ? (
          <Button
            className="w-full bg-green-600 hover:bg-green-700 text-white py-5 text-base h-auto"
            onClick={() => window.open(applyUrl, '_blank')}
            data-testid="button-apply-financing"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            Apply for Financing
          </Button>
        ) : null}

        <p className="text-xs text-gray-400 text-center">
          Financing subject to credit approval. Monthly payments shown are estimates based on mid-range APR of ~{aprMid.toFixed(2)}%.
          Actual rate determined at underwriting.
        </p>
      </CardContent>
    </Card>
  );
}

export default function ViewEstimate() {
  const [estimateId, setEstimateId] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setEstimateId(params.get('id'));
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-estimate', estimateId],
    queryFn: async () => {
      const response = await base44.functions.invoke('getPublicEstimate', { id: estimateId });
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    enabled: !!estimateId,
  });

  const estimate = data?.estimate;
  const company = data?.company;
  const financing = data?.financing;

  const updateStatusMutation = useMutation({
    mutationFn: async (status) => {
        return await base44.functions.invoke('updatePublicEstimateStatus', { 
            id: estimateId, 
            status: status 
        });
    },
    onSuccess: () => {
        window.location.reload();
    },
    onError: (err) => {
        alert('Failed to update status: ' + err.message);
    }
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !estimate) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md text-center p-8">
          <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900">Estimate Not Found</h2>
          <p className="text-gray-500 mt-2">The estimate you are looking for does not exist or has been removed.</p>
        </Card>
      </div>
    );
  }

  const subtotal = estimate.items?.reduce((sum, item) => sum + Number(item.amount || item.rcv || 0), 0) || 0;
  const showFinancing = estimate.financing_enabled && financing?.enabled && (financing?.hearth_partner_id || financing?.custom_url || ['greensky','wisetack'].includes(financing?.provider));
  
  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header / Company Info */}
        <Card>
            <CardContent className="p-6 md:p-8">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 border-b pb-8">
                    <div>
                        {company?.logo_url ? (
                            <img src={company.logo_url} alt={company.company_name} className="max-h-16 w-auto object-contain mb-4" />
                        ) : (
                            <h1 className="text-2xl font-bold text-gray-900">{company?.company_name || 'Company Name'}</h1>
                        )}
                        <div className="text-sm text-gray-500 space-y-1">
                            {(company?.address || company?.company_address) && (
                                <p className="flex items-center gap-2">
                                    <MapPin className="w-4 h-4" /> 
                                    {company.address ? `${company.address}, ${company.city}, ${company.state} ${company.zip}` : company.company_address}
                                </p>
                            )}
                            {(company?.phone || company?.phone_number) && (
                                <p className="flex items-center gap-2">
                                    <Phone className="w-4 h-4" /> 
                                    {company.phone || company.phone_number}
                                </p>
                            )}
                            {(company?.email || company?.email_address) && (
                                <p className="flex items-center gap-2">
                                    <Mail className="w-4 h-4" /> 
                                    {company.email || company.email_address}
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="text-right">
                        <h2 className="text-3xl font-bold text-gray-900">ESTIMATE</h2>
                        <p className="text-gray-500 font-medium">#{estimate.estimate_number}</p>
                        <div className="mt-2">
                            <Badge className={`text-base px-3 py-1 ${
                                estimate.status === 'accepted' ? 'bg-green-100 text-green-700' :
                                estimate.status === 'declined' ? 'bg-red-100 text-red-700' :
                                'bg-blue-100 text-blue-700'
                            }`}>
                                {estimate.status?.toUpperCase()}
                            </Badge>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                    <div>
                        <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2">Estimate For</h3>
                        <p className="text-lg font-bold text-gray-900">{estimate.customer_name}</p>
                        {estimate.property_address && (
                            <p className="text-gray-600 mt-1">{estimate.property_address}</p>
                        )}
                        {estimate.customer_email && <p className="text-gray-600">{estimate.customer_email}</p>}
                        {estimate.customer_phone && <p className="text-gray-600">{estimate.customer_phone}</p>}
                    </div>
                    <div className="md:text-right">
                        <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2">Details</h3>
                        {estimate.created_date && (
                            <p className="text-gray-600"><span className="font-medium">Date:</span> {format(new Date(estimate.created_date), 'MMM d, yyyy')}</p>
                        )}
                        {estimate.valid_until && (
                            <p className="text-gray-600"><span className="font-medium">Valid Until:</span> {format(new Date(estimate.valid_until), 'MMM d, yyyy')}</p>
                        )}
                    </div>
                </div>

                {/* Line Items */}
                <div className="mb-8">
                    <h3 className="font-bold text-gray-900 mb-4 text-lg">Line Items</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-gray-50 border-y">
                                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Description</th>
                                    <th className="text-center py-3 px-4 font-semibold text-gray-700 w-20">Qty</th>
                                    <th className="text-center py-3 px-4 font-semibold text-gray-700 w-16">Unit</th>
                                    <th className="text-right py-3 px-4 font-semibold text-gray-700 w-28">Rate</th>
                                    <th className="text-right py-3 px-4 font-semibold text-gray-700 w-32">Amount</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {(estimate.line_items || estimate.items || []).map((item, idx) => (
                                    <tr key={idx}>
                                        <td className="py-4 px-4">
                                            <p className="font-medium text-gray-900">{item.description || item.name}</p>
                                            {item.long_description && (
                                                <p className="text-sm text-gray-500 mt-1">{item.long_description}</p>
                                            )}
                                        </td>
                                        <td className="py-4 px-4 text-center text-gray-600">{item.quantity || item.qty || ''}</td>
                                        <td className="py-4 px-4 text-center text-gray-500 text-sm">{item.unit || ''}</td>
                                        <td className="py-4 px-4 text-right text-gray-600">${parseFloat(item.rate || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                                        <td className="py-4 px-4 text-right font-medium text-gray-900">
                                            ${(parseFloat(item.amount) || parseFloat(item.rcv) || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Totals */}
                <div className="flex justify-end mb-8">
                    <div className="w-full md:w-1/2 lg:w-1/3 space-y-3">
                        <div className="flex justify-between text-gray-600">
                            <span>Subtotal</span>
                            <span>${subtotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                        </div>
                        <div className="flex justify-between text-2xl font-bold text-gray-900 pt-3 border-t">
                            <span>Total</span>
                            <span>${(estimate.amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                        </div>
                    </div>
                </div>

                {/* Notes and Terms */}
                <div className="space-y-8 mb-12 border-t pt-8">
                    {estimate.notes && (
                        <div>
                            <h4 className="font-bold text-gray-900 mb-2 uppercase text-sm">Note:</h4>
                            <p className="text-gray-700 whitespace-pre-wrap text-sm leading-relaxed">{estimate.notes}</p>
                        </div>
                    )}
                    
                    {company?.pdf_terms_conditions && (
                        <div>
                            <h4 className="font-bold text-gray-900 mb-2 uppercase text-sm">Terms & Conditions:</h4>
                            <p className="text-gray-600 whitespace-pre-wrap text-sm leading-relaxed text-justify">{company.pdf_terms_conditions}</p>
                        </div>
                    )}
                </div>

                {/* Footer Signature Area */}
                <div className="mb-12">
                    <h4 className="font-bold text-gray-900 mb-1 capitalize">{company?.company_name}</h4>
                    <div className="text-sm text-gray-600">
                         {company?.address && <p>{company.address}</p>}
                         {company?.city && <p>{company.city}, {company.state} {company.zip}</p>}
                    </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col md:flex-row gap-4 justify-center pt-4 border-t">
                    {estimate.status === 'sent' || estimate.status === 'viewed' ? (
                        <>
                            <Button 
                                onClick={() => updateStatusMutation.mutate('accepted')}
                                disabled={updateStatusMutation.isPending}
                                className="bg-green-600 hover:bg-green-700 text-white px-8 py-6 text-lg h-auto"
                                data-testid="button-accept-estimate"
                            >
                                {updateStatusMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <ThumbsUp className="w-5 h-5 mr-2" />}
                                Accept Estimate
                            </Button>
                            <Button 
                                onClick={() => updateStatusMutation.mutate('declined')}
                                disabled={updateStatusMutation.isPending}
                                variant="outline" 
                                className="border-red-200 text-red-600 hover:bg-red-50 px-8 py-6 text-lg h-auto"
                                data-testid="button-decline-estimate"
                            >
                                {updateStatusMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <ThumbsDown className="w-5 h-5 mr-2" />}
                                Decline
                            </Button>
                        </>
                    ) : estimate.status === 'accepted' ? (
                        <div className="flex items-center text-green-600 bg-green-50 px-6 py-4 rounded-lg" data-testid="status-accepted">
                            <CheckCircle2 className="w-6 h-6 mr-2" />
                            <span className="font-semibold text-lg">Estimate Accepted</span>
                        </div>
                    ) : estimate.status === 'declined' ? (
                        <div className="flex items-center text-red-600 bg-red-50 px-6 py-4 rounded-lg" data-testid="status-declined">
                            <XCircle className="w-6 h-6 mr-2" />
                            <span className="font-semibold text-lg">Estimate Declined</span>
                        </div>
                    ) : null}
                </div>

            </CardContent>
        </Card>

        {/* Financing Card — shown below the main estimate card */}
        {showFinancing && (
          <FinancingCard estimate={estimate} company={company} financing={financing} />
        )}
      </div>
    </div>
  );
}
