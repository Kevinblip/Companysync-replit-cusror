import React, { useState, useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle, X, ExternalLink } from "lucide-react";
import SignaturePad from "../components/SignaturePad";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

async function callBase44Function(functionName, data) {
  const proxyPath = `/api/public/${functionName === 'getSigningSession' ? 'get-signing-session' : 'sign-contract'}`;
  const response = await fetch(proxyPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) {
    throw new Error(`Server returned invalid response (status ${response.status})`);
  }
  if (!response.ok) {
    throw new Error(parsed?.error || parsed?.message || `Request failed with status ${response.status}`);
  }
  return parsed;
}

function PdfPageInline({ pdf, pageNum, scale }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    let renderTask = null;
    pdf.getPage(pageNum).then((page) => {
      if (cancelled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      renderTask = page.render({ canvasContext: ctx, viewport });
      return renderTask.promise;
    });
    return () => { cancelled = true; if (renderTask) renderTask.cancel(); };
  }, [pdf, pageNum, scale]);
  return <canvas ref={canvasRef} className="block w-full shadow-sm" style={{ maxWidth: "100%" }} />;
}

const DEFAULT_CONTENT = {
  header_company: "Your Company Name",
  header_phone: "",
  header_website: "",
  header_email: "",
  footer_address: "",
  title: "CONTINGENCY AGREEMENT",
  intro: "I/We, owner of the property located at :",
  para1: "Agree to have Contractor represent me/us and assist in obtaining my/our insurance company's good faith approval for the funds needed for restoration and repairs to said property.",
  para2: "If the insurance company does not agree to pay for needed repairs, this agreement is automatically terminated.",
  para3: "In such event, the property owner will not owe anything to Contractor; and Contractor will not be required to perform any restoration and repairs to said property.",
  para4: "Property owner agrees that Contractor will perform the repairs to the said property in accordance with the insurance company's damage and work scope. The property owner will pay to Contractor all checks from the insurance company, including:",
  item1: "The initial check (ACV) that comes with the detailed work scope from the insurance company. At this time property owner will be assisted in selecting any available options such as shingle style and color, etc. Contractor then orders all materials, schedules work to be done, and orders all inspections during and after repairs and installation.",
  item2: "The depreciation/supplement check that the insurance company pays after final inspection.",
  item3: "All supplemental funds from the insurance company for unforeseen costs. If these occur, they will be negotiated by Contractor and are paid by the insurance company.",
  item4: "Any upgrade that is selected will be due upon completion.",
  p2_intro: "This contract and any agreement made pursuant thereto (the \u201cAgreement\u201d) is between CONTRACTOR (the \u201cCompany\u201d) and the customer(s) named herein on the reverse side. This Agreement Is subject to all appropriate law, regulations, and ordinances in the State of Ohio and these terms and conditions.",
  b1: "This Agreement is composed of this page, the reverse (or front page) side of this page, the Pre-Start Checklist, the Scope of work Attachment if applicable, and all other documents referenced in or incorporated Into this Agreement.",
  b2: "The Company is not responsible for any damages on or below the roof due to leaks by excessive wind driven rain, ice, or hail during the period of warranty. EXCESSIVE WIND IS 65 M.P.H. THE WARRANTY IS NON-TRANSFERRABLE.",
  b3: "Property Owner acknowledges the value of the Contractor Services provided by CONTRACTOR. This value includes the on-site property Inspections, travel to and from property inspections, as well as meetings with third party representatives, when required. CONTRACTOR will provide the necessary equipment and tools, ladders and safety equipment needed for Inspections, estimates and reports. Property Owner understands there is a considerable investment of time for the Contractor Services, as well as time and material costs spent on the production of photos, satellite imagery, measurements, as well as writing reports and estimates as required by any third party. This may include multiple site visits and phone calls with local engineers, attorneys, suppliers, manufacturer\u2019s representatives, Insurance representatives, and/or other parties. In the event Property Owner cancels this agreement for any reason, Property Owner agrees to immediately pay CONTRACTOR any actual incurred costs pertaining to their project, based on above services, plus 15% restocking fee.",
  b4: "THIS CONTRACT CANNOT BE CANCELLED ONCE WORK IS COMMENCED ON THE PROJECT EXCEPT BY MUTUAL WRITTEN AGREEMENT OF THE PARTIES.",
  b5: "Warranty is for 5 years on roof replacement, 1 year on siding replacement, 1 year on gutter repairs, and 1 year on all other repairs (including interior work.)",
  b6: "Payments are to be made: ACV + Deductible down payment AND Customer agrees to our percentage of completion billing policy. Company reserves the right to bill proportionately based on percentage of work complete. Customer understands that the company may issue a stop work order if requested progress payment Is not received.",
  b7: "Pay per Trade Policy: Customer agrees to pay in full at the completion of each trade on the project. Company reserves the right to collect payment in full per trade prior to beginning on the next trade.",
  b8: "Company Retainage Policy: Customer agrees to pay in full at the time of completion of each contract. The maximum allowable retainage for any punch-out will be 5% of original contract price.",
  b9: "The Company\u2019s failure to enforce any right under this Agreement shall not be construed as a waiver of any subsequent right to enforce the same or any other right, term or condition.",
  b10: "You, the consumer, may cancel this transaction at any time prior to midnight of the 3rd business day after the date of this transaction.",
};

function ContractHtmlRenderer({ htmlContent }) {
  let c = DEFAULT_CONTENT;
  if (htmlContent) {
    try {
      const parsed = typeof htmlContent === 'string' ? JSON.parse(htmlContent) : htmlContent;
      c = { ...DEFAULT_CONTENT, ...parsed };
    } catch (_) {}
  }

  const pageStyle = {
    background: "#fff",
    padding: "32px 36px 28px",
    fontFamily: "Arial, sans-serif",
    fontSize: "12px",
    color: "#222",
    lineHeight: "1.45",
  };
  const cell = { border: "1px solid #333", padding: "5px 8px", fontSize: "12px" };

  return (
    <div style={{ background: "#f0f0f0", padding: "12px" }}>
      {/* Page 1 */}
      <div style={{ ...pageStyle, marginBottom: "12px", borderRadius: "4px" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "14px" }}>
          <div style={{ fontWeight: "bold", fontSize: "14px", letterSpacing: "0.5px" }}>{c.header_company}</div>
          <div style={{ fontSize: "11px", color: "#444", marginTop: "2px" }}>
            {c.header_phone} &nbsp;|&nbsp; {c.header_website} &nbsp;|&nbsp; {c.header_email}
          </div>
        </div>
        <hr style={{ borderColor: "#aaa", marginBottom: "10px" }} />
        <div style={{ textAlign: "center", fontWeight: "bold", fontSize: "15px", marginBottom: "14px", letterSpacing: "1px" }}>
          {c.title}
        </div>

        {/* Property address row */}
        <div style={{ marginBottom: "12px" }}>
          <span style={{ fontWeight: "bold" }}>{c.intro}</span>
          <div style={{ display: "flex", gap: "12px", marginTop: "6px" }}>
            <div style={{ flex: 1, borderBottom: "1px solid #555", minHeight: "18px" }} />
          </div>
        </div>

        <p style={{ marginBottom: "8px" }}>{c.para1}</p>
        <p style={{ marginBottom: "8px" }}>{c.para2}</p>
        <p style={{ marginBottom: "8px" }}>{c.para3}</p>
        <p style={{ marginBottom: "8px" }}>{c.para4}</p>

        <ol style={{ paddingLeft: "22px", marginBottom: "12px" }}>
          {[c.item1, c.item2, c.item3, c.item4].map((item, i) => (
            <li key={i} style={{ marginBottom: "6px" }}>{item}</li>
          ))}
        </ol>

        {/* Info table */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "12px", fontSize: "12px" }}>
          <tbody>
            <tr>
              <td style={cell}><span style={{ color: "#444" }}>Customer Name:</span> <span style={{ display: "inline-block", borderBottom: "1px solid #555", minWidth: "120px" }}>&nbsp;</span></td>
              <td style={cell}><span style={{ color: "#444" }}>Date:</span> <span style={{ display: "inline-block", borderBottom: "1px solid #555", minWidth: "80px" }}>&nbsp;</span></td>
            </tr>
            <tr>
              <td style={cell}><span style={{ color: "#444" }}>Property Address:</span> <span style={{ display: "inline-block", borderBottom: "1px solid #555", minWidth: "140px" }}>&nbsp;</span></td>
              <td style={cell}><span style={{ color: "#444" }}>Phone:</span> <span style={{ display: "inline-block", borderBottom: "1px solid #555", minWidth: "80px" }}>&nbsp;</span></td>
            </tr>
            <tr>
              <td style={cell}><span style={{ color: "#444" }}>City / State / Zip:</span> <span style={{ display: "inline-block", borderBottom: "1px solid #555", minWidth: "120px" }}>&nbsp;</span></td>
              <td style={cell}><span style={{ color: "#444" }}>Email:</span> <span style={{ display: "inline-block", borderBottom: "1px solid #555", minWidth: "80px" }}>&nbsp;</span></td>
            </tr>
            <tr>
              <td style={cell}><span style={{ color: "#444" }}>Insurance Company:</span> <span style={{ display: "inline-block", borderBottom: "1px solid #555", minWidth: "120px" }}>&nbsp;</span></td>
              <td style={cell}><span style={{ color: "#444" }}>Claim #:</span> <span style={{ display: "inline-block", borderBottom: "1px solid #555", minWidth: "80px" }}>&nbsp;</span></td>
            </tr>
          </tbody>
        </table>

        {/* Signature row */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "8px", fontSize: "12px" }}>
          <tbody>
            <tr>
              <td style={{ ...cell, width: "45%" }}><span style={{ color: "#444" }}>Customer Signature:</span> <span style={{ display: "inline-block", borderBottom: "1px solid #555", minWidth: "100px" }}>&nbsp;</span></td>
              <td style={{ ...cell, width: "25%" }}><span style={{ color: "#444" }}>Date:</span> <span style={{ display: "inline-block", borderBottom: "1px solid #555", minWidth: "60px" }}>&nbsp;</span></td>
              <td style={{ ...cell, width: "30%" }}><span style={{ color: "#444" }}>Rep Signature:</span> <span style={{ display: "inline-block", borderBottom: "1px solid #555", minWidth: "60px" }}>&nbsp;</span></td>
            </tr>
          </tbody>
        </table>

        <div style={{ textAlign: "center", fontSize: "10px", color: "#666", marginTop: "14px" }}>
          {c.footer_address}
        </div>
      </div>

      {/* Page 2 — Terms */}
      <div style={{ ...pageStyle, borderRadius: "4px" }}>
        <div style={{ textAlign: "center", fontWeight: "bold", fontSize: "13px", marginBottom: "12px" }}>
          TERMS AND CONDITIONS
        </div>
        <p style={{ marginBottom: "10px", fontStyle: "italic", fontSize: "11px" }}>{c.p2_intro}</p>
        {[c.b1,c.b2,c.b3,c.b4,c.b5,c.b6,c.b7,c.b8,c.b9,c.b10].map((block, i) => (
          <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
            <span style={{ fontWeight: "bold", minWidth: "18px" }}>{i + 1}.</span>
            <span>{block}</span>
          </div>
        ))}
        <div style={{ textAlign: "center", fontSize: "10px", color: "#666", marginTop: "18px" }}>
          {c.footer_address}
        </div>
      </div>
    </div>
  );
}

function InlinePdfViewer({ src }) {
  const [pdf, setPdf] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    setLoading(true); setError(null); setPdf(null); setNumPages(0);
    const load = async () => {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      if (cancelled) return;
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      if (cancelled) return;
      setPdf(doc); setNumPages(doc.numPages); setLoading(false);
    };
    load().catch(err => { if (!cancelled) { setError(err.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [src]);

  if (loading) return (
    <div className="flex items-center justify-center py-12 bg-white">
      <Loader2 className="w-6 h-6 animate-spin text-gray-400 mr-2" />
      <span className="text-sm text-gray-500">Loading contract...</span>
    </div>
  );
  if (error) return (
    <div className="text-center py-8 text-gray-500 bg-white">
      <p className="text-sm">Unable to display PDF inline.</p>
      <p className="text-xs text-gray-400 mt-1">{error}</p>
    </div>
  );
  if (!pdf) return null;
  return (
    <div className="bg-gray-100 p-2 space-y-2">
      {Array.from({ length: numPages }, (_, i) => (
        <PdfPageInline key={i + 1} pdf={pdf} pageNum={i + 1} scale={1.5} />
      ))}
    </div>
  );
}

export default function SignContractCustomer() {
  const [token, setToken] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [signatureData, setSignatureData] = useState(null);
  const [isSignatureReady, setIsSignatureReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formValuesInitialized, setFormValuesInitialized] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token'));
  }, []);

  const { data: sessionData, isLoading: sessionLoading, error: sessionError } = useQuery({
    queryKey: ['signing-session-token', token],
    queryFn: async () => {
      const result = await callBase44Function('getSigningSession', { token });
      if (!result?.success) throw new Error(result?.error || 'Failed to load session');
      return result;
    },
    enabled: !!token,
    retry: 2,
    retryDelay: 1000,
  });

  const session = sessionData?.session;
  const template = sessionData?.template;

  useEffect(() => {
    if (session?.pre_filled_values && !formValuesInitialized) {
      let preFilled = session.pre_filled_values;
      if (typeof preFilled === 'string') { try { preFilled = JSON.parse(preFilled); } catch { preFilled = {}; } }
      if (preFilled && typeof preFilled === 'object' && Object.keys(preFilled).length > 0) setFormValues(preFilled);
      setFormValuesInitialized(true);
    }
  }, [session, formValuesInitialized]);

  const handleSubmit = async () => {
    if (!isSignatureReady || !signatureData) { alert('Please sign the document first'); return; }
    if (!template?.fillable_fields) { alert('Contract template data is missing'); return; }
    const customerFields = template.fillable_fields.filter(f => f.filled_by === 'customer' && f.field_type !== 'signature');
    const missingRequired = customerFields.filter(f => f.required && !formValues[f.field_name]);
    if (missingRequired.length > 0) { alert(`Please fill in: ${missingRequired.map(f => f.field_label).join(', ')}`); return; }
    setIsSubmitting(true);
    try {
      const result = await callBase44Function('signContractCustomer', { token, fields: formValues, signature: signatureData });
      if (result?.success) window.location.reload();
      else throw new Error(result?.error || 'Failed to sign contract');
    } catch (error) {
      alert('Error: ' + error.message);
      setIsSubmitting(false);
    }
  };

  if (!token) return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
      <div className="bg-white rounded-xl shadow p-12 text-center max-w-md w-full">
        <X className="w-16 h-16 mx-auto mb-4 text-red-500" />
        <h2 className="text-xl font-bold mb-2">Invalid Link</h2>
        <p className="text-gray-500">No signing token found in URL</p>
      </div>
    </div>
  );

  if (sessionError) return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
      <div className="bg-white rounded-xl shadow p-12 text-center max-w-md w-full">
        <X className="w-16 h-16 mx-auto mb-4 text-red-500" />
        <h2 className="text-xl font-bold mb-2">Error Loading Session</h2>
        <p className="text-gray-500">{sessionError.message}</p>
      </div>
    </div>
  );

  if (sessionLoading || !session || !template) return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      <p className="ml-3 text-gray-600">Loading contract...</p>
    </div>
  );

  if (session.status === 'completed') return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
      <div className="bg-white rounded-xl shadow p-12 text-center max-w-md w-full">
        <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-500" />
        <h2 className="text-xl font-bold mb-2">Contract Signed</h2>
        <p className="text-gray-500 mb-6">This contract has already been completed.</p>
        {session.final_pdf_url && (
          <Button onClick={() => window.open(session.final_pdf_url, '_blank')} className="bg-blue-600 hover:bg-blue-700">
            Download Signed Contract
          </Button>
        )}
      </div>
    </div>
  );

  const customerFields = template.fillable_fields?.filter(f => f.filled_by === 'customer') || [];
  const inputFields = customerFields.filter(f => f.field_type !== 'signature');
  const pdfSrc = template.original_file_url
    ? `/api/proxy-pdf?url=${encodeURIComponent(template.original_file_url)}`
    : null;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10 px-4 py-3 shadow-sm">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-bold text-gray-900 truncate">{template.template_name}</h1>
            <p className="text-xs text-gray-500">
              {session.rep_name ? `Sent by ${session.rep_name}` : 'Review, fill in, and sign below'}
            </p>
          </div>
          {template.original_file_url && (
            <a
              href={template.original_file_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 shrink-0 border border-blue-200 rounded px-2 py-1"
              data-testid="link-open-pdf-external"
            >
              <ExternalLink className="w-3 h-3" />
              Open PDF
            </a>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-2 py-4 pb-28 space-y-0">

        {/* ── STEP 1: Read the contract ─────────────────── */}
        <div className="bg-white rounded-t-xl shadow-sm border border-b-0">
          <div className="px-4 py-3 border-b bg-gray-50 rounded-t-xl flex items-center gap-2">
            <span className="bg-blue-600 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0">1</span>
            <span className="text-sm font-semibold text-gray-800">Read the contract</span>
          </div>
          {template.html_content ? (
            <ContractHtmlRenderer htmlContent={template.html_content} />
          ) : pdfSrc ? (
            <InlinePdfViewer src={pdfSrc} />
          ) : (
            <div className="p-8 text-center text-gray-400 text-sm">No PDF attached to this contract.</div>
          )}
        </div>

        {/* ── STEP 2: Fill in your information ─────────── */}
        <div className="bg-white shadow-sm border border-t-0 border-b-0">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center gap-2">
            <span className="bg-blue-600 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0">2</span>
            <span className="text-sm font-semibold text-gray-800">Fill in your information</span>
          </div>

          <div className="p-4 space-y-4">
            {/* Rep-filled fields shown first as read-only reference */}
            {session.rep_fields && Object.keys(session.rep_fields).length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Already filled by {session.rep_name || 'Rep'}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {Object.entries(session.rep_fields).map(([key, value]) => {
                    const field = template.fillable_fields?.find(f => f.field_name === key);
                    return (
                      <div key={key} className="flex items-start gap-2 bg-green-50 px-3 py-2 rounded border border-green-200">
                        <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs text-gray-400">{field?.field_label || key}</p>
                          <p className="text-sm font-medium text-gray-700 truncate">{value}</p>
                        </div>
                      </div>
                    );
                  })}
                  {session.rep_signature_url && (
                    <div className="bg-green-50 p-3 rounded border border-green-200">
                      <p className="text-xs text-gray-400 mb-1">Rep Signature</p>
                      <img src={session.rep_signature_url} alt="Rep Signature" className="h-10 border rounded bg-white p-1" />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Customer-fillable fields */}
            {inputFields.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                {inputFields.map((field) => (
                  <div key={field.field_name} className={field.field_type === 'textarea' ? 'sm:col-span-2' : ''}>
                    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
                      {field.field_label}
                      {field.required && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    {field.field_type === 'textarea' ? (
                      <textarea
                        value={formValues[field.field_name] || ''}
                        onChange={e => setFormValues({ ...formValues, [field.field_name]: e.target.value })}
                        placeholder={field.placeholder}
                        rows={3}
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                        data-testid={`input-field-${field.field_name}`}
                      />
                    ) : (
                      <Input
                        type={
                          field.field_type === 'date' ? 'date' :
                          field.field_type === 'email' ? 'email' :
                          field.field_type === 'phone' ? 'tel' :
                          field.field_type === 'currency' ? 'number' : 'text'
                        }
                        inputMode={
                          field.field_type === 'email' ? 'email' :
                          field.field_type === 'phone' ? 'tel' :
                          field.field_type === 'currency' ? 'decimal' : undefined
                        }
                        autoComplete={
                          field.field_type === 'email' ? 'email' :
                          field.field_type === 'phone' ? 'tel' : undefined
                        }
                        value={formValues[field.field_name] || ''}
                        onChange={e => setFormValues({ ...formValues, [field.field_name]: e.target.value })}
                        placeholder={field.placeholder || (field.field_type === 'phone' ? '(XXX) XXX-XXXX' : field.field_type === 'currency' ? '0.00' : '')}
                        required={field.required}
                        className="text-base h-11 border-gray-300 focus:ring-blue-300"
                        data-testid={`input-field-${field.field_name}`}
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-2">No fields required from you.</p>
            )}
          </div>
        </div>

        {/* ── STEP 3: Sign ─────────────────────────────── */}
        <div className="bg-white rounded-b-xl shadow-sm border border-t-0">
          <div className="px-4 py-3 border-b bg-gray-50 rounded-none flex items-center gap-2">
            <span className="bg-blue-600 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0">3</span>
            <span className="text-sm font-semibold text-gray-800">Sign</span>
          </div>
          <div className="p-4">
            <p className="text-xs text-gray-500 mb-3">
              By signing below, you confirm you have read and agree to all terms in the contract above.
            </p>
            <SignaturePad
              onSignatureChange={(data, hasSignature) => {
                setSignatureData(data);
                setIsSignatureReady(hasSignature);
              }}
            />
          </div>
        </div>

      </div>

      {/* Sticky submit */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg px-4 py-3 z-20">
        <div className="max-w-3xl mx-auto">
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !isSignatureReady}
            className="w-full bg-green-600 hover:bg-green-700 text-base font-semibold py-6 disabled:opacity-50"
            data-testid="button-submit-sign"
          >
            {isSubmitting ? (
              <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Submitting...</>
            ) : (
              <><CheckCircle className="w-5 h-5 mr-2" />{isSignatureReady ? 'Submit & Sign Contract' : 'Complete your signature above to submit'}</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
