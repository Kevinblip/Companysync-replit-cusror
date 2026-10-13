import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Printer, Save, RotateCcw, Check, ArrowLeft, Info } from "lucide-react";

const STORAGE_KEY = "contract_editor_content";
const getScopedStorageKey = (companyId) => companyId ? `contract_editor_${companyId}` : STORAGE_KEY;

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
  para4: "Property owner agrees that Contractor will perform the repairs to the said property in accordance with the insurance company\u2019s damage and work scope. The property owner will pay to Contractor all checks from the insurance company, including:",
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

function EditableBlock({ value, onChange, tag: Tag = "p", style, className }) {
  const ref = useRef(null);
  // Depend on `value` so DB-loaded content (which arrives asynchronously, after mount)
  // actually renders into the uncontrolled contentEditable. The innerText guard keeps the
  // caret from jumping while typing. Without this, saved edits never appear and get
  // clobbered by the defaults on the next save.
  useEffect(() => {
    if (ref.current && ref.current.innerText !== value) {
      ref.current.innerText = value ?? "";
    }
  }, [value]);
  const handleBlur = () => { if (ref.current) onChange(ref.current.innerText); };
  return (
    <Tag
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onBlur={handleBlur}
      style={style}
      className={`outline-none rounded focus:ring-2 focus:ring-blue-400 focus:bg-blue-50 cursor-text ${className || ""}`}
      title="Click to edit"
    />
  );
}

const cell = { border: "1px solid #333", padding: "5px 8px", fontSize: "12px" };
const label = { color: "#444", marginRight: "5px", fontWeight: "normal" };
const line = { display: "inline-block", borderBottom: "1px solid #555", verticalAlign: "bottom" };

export default function ContractEditor() {
  const [content, setContent] = useState(DEFAULT_CONTENT);
  const [saved, setSaved] = useState(false);

  const { data: user } = useQuery({ queryKey: ['current-user'], queryFn: () => base44.auth.me() });
  const { data: companies = [] } = useQuery({
    queryKey: ['companies-contract-editor'],
    queryFn: () => base44.entities.Company.filter({ is_deleted: { $ne: true } }),
    enabled: !!user,
  });
  const myCompany = useMemo(() => {
    if (!user) return null;
    const impersonated = sessionStorage.getItem('impersonating_company_id');
    if (impersonated) return companies.find(c => c.id === impersonated) || null;
    return companies.find(c => c.created_by === user.email) || companies[0] || null;
  }, [user, companies]);
  const logoUrl = myCompany?.logo_url || null;

  const set = useCallback((key) => (val) => setContent(c => ({ ...c, [key]: val })), []);

  // Sort by -updated_date (not the default -created_date) so this always matches the same
  // "most recently edited wins" convention used server-side in resolveSessionHtml. A prior
  // bug could create duplicate rows for the same company (see handleSave); sorting by
  // updated_date ensures whichever row was edited most recently is always the one shown,
  // regardless of which row happened to be created first.
  const { data: dbRecord } = useQuery({
    queryKey: ['contract-editor-content', myCompany?.id],
    queryFn: () => base44.entities.ContractEditorContent.filter({ company_id: myCompany.id }, '-updated_date'),
    enabled: !!myCompany?.id,
    select: (rows) => rows?.[0] || null,
  });

  // Load localStorage draft once company is known (before DB record arrives).
  // Tries the company-scoped key first; falls back to the legacy generic key once for migration.
  // The dbRecord effect below takes precedence when the DB record loads.
  useEffect(() => {
    if (!myCompany?.id) return;
    try {
      const scopedKey = getScopedStorageKey(myCompany.id);
      const saved = localStorage.getItem(scopedKey) || localStorage.getItem(STORAGE_KEY);
      if (saved) setContent({ ...DEFAULT_CONTENT, ...JSON.parse(saved) });
    } catch (_) {}
  }, [myCompany?.id]);

  useEffect(() => {
    if (dbRecord?.content) {
      try {
        const parsed = typeof dbRecord.content === 'string' ? JSON.parse(dbRecord.content) : dbRecord.content;
        setContent(c => ({ ...DEFAULT_CONTENT, ...parsed }));
      } catch (_) {}
    }
  }, [dbRecord?.id]);

  const handleSave = async () => {
    const scopedKey = getScopedStorageKey(myCompany?.id);
    localStorage.setItem(scopedKey, JSON.stringify(content));
    if (scopedKey !== STORAGE_KEY) localStorage.removeItem(STORAGE_KEY);
    if (myCompany?.id) {
      try {
        // Re-check for an existing row right before writing, instead of trusting the
        // (possibly stale/not-yet-loaded) `dbRecord` from the initial query. Relying on
        // `dbRecord?.id` alone previously caused duplicate rows for the same company when
        // Save was clicked before that query had resolved. Sort by -updated_date so, if a
        // duplicate already exists from before this fix, we always update the most
        // recently edited one rather than creating yet another row.
        const existing = await base44.entities.ContractEditorContent.filter({ company_id: myCompany.id }, '-updated_date');
        const target = existing?.[0] || dbRecord;
        if (target?.id) {
          await base44.entities.ContractEditorContent.update(target.id, { content: JSON.stringify(content) });
        } else {
          await base44.entities.ContractEditorContent.create({ company_id: myCompany.id, template_key: 'contingency', content: JSON.stringify(content) });
        }
      } catch (e) { console.warn('Could not save contract to DB', e); }
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = () => {
    if (window.confirm("Reset all text back to the original? Your edits will be lost.")) {
      localStorage.removeItem(getScopedStorageKey(myCompany?.id));
      localStorage.removeItem(STORAGE_KEY);
      setContent(DEFAULT_CONTENT);
    }
  };

  const pageStyle = {
    background: "#fff",
    padding: "48px 52px 40px",
    fontFamily: "Arial, sans-serif",
    fontSize: "12.5px",
    lineHeight: "1.55",
    color: "#000",
    minHeight: "1050px",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Toolbar */}
      <div className="no-print bg-white border-b sticky top-0 z-10 px-4 py-3 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => window.history.back()} className="gap-1 text-gray-600">
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-tight">Contract Template Editor</h1>
              <p className="text-xs text-gray-400">Click any text to edit it · Changes save to this browser</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleReset} className="gap-1 text-gray-500 border-gray-300">
              <RotateCcw className="w-4 h-4" /> Reset
            </Button>
            <Button variant="outline" size="sm" onClick={handleSave} className={`gap-1 border-blue-300 ${saved ? "text-green-600 border-green-300" : "text-blue-600"}`}>
              {saved ? <><Check className="w-4 h-4" /> Saved!</> : <><Save className="w-4 h-4" /> Save</>}
            </Button>
            <Button size="sm" onClick={() => window.print()} className="gap-1 bg-blue-600 hover:bg-blue-700">
              <Printer className="w-4 h-4" /> Print / Save PDF
            </Button>
          </div>
        </div>
        <div className="max-w-4xl mx-auto mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs text-amber-800">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            <strong>How to edit:</strong> Click any text to change it. Click <strong>Save</strong> to keep changes, then <strong>Print / Save PDF</strong> → "Save as PDF" to get an updated PDF to re-upload as your contract template.
          </span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto py-8 px-4 print:p-0 print:max-w-none space-y-6 print:space-y-0">

        {/* ── PAGE 1 ── */}
        <div id="page-1" style={pageStyle} className="shadow-lg print:shadow-none print:page-break-after-always">
        <div style={{ flex: 1 }}>

          {/* Header */}
          <table style={{ width: "100%", marginBottom: "18px", borderCollapse: "collapse" }}>
            <tbody>
              <tr>
                <td style={{ verticalAlign: "top", width: "58%" }}>
                  <div style={{ fontWeight: "bold", fontSize: "20px", letterSpacing: "0.5px", marginBottom: "5px" }}>
                    <EditableBlock value={content.title} onChange={set("title")} tag="div" />
                  </div>
                  <div style={{ fontWeight: "bold", fontSize: "12.5px", marginBottom: "4px" }}>
                    <EditableBlock value={content.header_company} onChange={set("header_company")} tag="div" />
                  </div>
                  <div style={{ fontSize: "12px", marginBottom: "2px" }}>
                    📞 <EditableBlock value={content.header_phone} onChange={set("header_phone")} tag="span" />
                  </div>
                  <div style={{ fontSize: "12px", marginBottom: "2px" }}>
                    🌐 <EditableBlock value={content.header_website} onChange={set("header_website")} tag="span" />
                  </div>
                  <div style={{ fontSize: "12px" }}>
                    ✉ <EditableBlock value={content.header_email} onChange={set("header_email")} tag="span" />
                  </div>
                </td>
                <td style={{ verticalAlign: "middle", textAlign: "center", width: "42%" }}>
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt="Company Logo"
                      style={{ maxHeight: "80px", maxWidth: "200px", objectFit: "contain", display: "block", margin: "0 auto" }}
                    />
                  ) : (
                    <div style={{ display: "inline-block", border: "2px solid #555", padding: "8px 16px", borderRadius: "4px", textAlign: "center" }}>
                      <div style={{ fontWeight: "900", fontSize: "24px", letterSpacing: "2px" }}>CompanySync</div>
                      <div style={{ fontSize: "10px", color: "#555", marginTop: "2px" }}>Your Company Name</div>
                      <div style={{ fontSize: "12px", fontStyle: "italic", fontWeight: "bold", marginTop: "2px" }}>"Add your logo in Settings"</div>
                    </div>
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          <hr style={{ borderTop: "2px solid #000", marginBottom: "16px" }} />

          {/* Intro */}
          <p style={{ marginBottom: "12px" }}>
            <EditableBlock value={content.intro} onChange={set("intro")} tag="span" />
            <span style={{ ...line, minWidth: "220px", marginLeft: "6px" }}>&nbsp;</span>
          </p>

          {/* Paragraphs */}
          <EditableBlock value={content.para1} onChange={set("para1")} tag="p" style={{ marginBottom: "11px", textAlign: "justify" }} />
          <EditableBlock value={content.para2} onChange={set("para2")} tag="p" style={{ marginBottom: "11px" }} />
          <EditableBlock value={content.para3} onChange={set("para3")} tag="p" style={{ marginBottom: "11px", textAlign: "justify" }} />
          <EditableBlock value={content.para4} onChange={set("para4")} tag="p" style={{ marginBottom: "10px", textAlign: "justify" }} />

          {/* Numbered items */}
          <ol style={{ paddingLeft: "20px", marginBottom: "16px" }}>
            {[
              [content.item1, set("item1")],
              [content.item2, set("item2")],
              [content.item3, set("item3")],
              [content.item4, set("item4")],
            ].map(([val, onChange], i) => (
              <li key={i} style={{ marginBottom: "9px", textAlign: "justify" }}>
                <EditableBlock value={val} onChange={onChange} tag="span" />
              </li>
            ))}
          </ol>

          {/* Table 1: Customer info */}
          <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #333", marginBottom: "10px" }}>
            <tbody>
              <tr>
                <td style={{ ...cell, width: "62%" }}><span style={label}>Name:</span><span style={{ ...line, minWidth: "200px" }}>&nbsp;</span></td>
                <td style={cell}><span style={label}>Date:</span><span style={{ ...line, minWidth: "110px" }}>&nbsp;</span></td>
              </tr>
              <tr>
                <td colSpan={2} style={cell}><span style={label}>Address:</span><span style={{ ...line, minWidth: "380px" }}>&nbsp;</span></td>
              </tr>
              <tr>
                <td style={cell}><span style={label}>City:</span><span style={{ ...line, minWidth: "100px" }}>&nbsp;</span></td>
                <td style={cell}>
                  <span style={label}>State:</span><span style={{ ...line, minWidth: "70px", marginRight: "14px" }}>&nbsp;</span>
                  <span style={label}>Zip:</span><span style={{ ...line, minWidth: "70px" }}>&nbsp;</span>
                </td>
              </tr>
              <tr>
                <td style={cell}><span style={label}>Home Phone:</span><span style={{ ...line, minWidth: "130px" }}>&nbsp;</span></td>
                <td style={cell}><span style={label}>Cell Phone:</span><span style={{ ...line, minWidth: "130px" }}>&nbsp;</span></td>
              </tr>
            </tbody>
          </table>

          {/* Table 2: Signatures */}
          <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #333", marginBottom: "10px" }}>
            <tbody>
              <tr>
                <td style={{ ...cell, width: "55%" }}><span style={label}>Policy Holder Signature:</span><span style={{ ...line, minWidth: "120px" }}>&nbsp;</span></td>
                <td style={cell}><span style={label}>Email:</span><span style={{ ...line, minWidth: "160px" }}>&nbsp;</span></td>
              </tr>
              <tr>
                <td style={cell}><span style={label}>Rep Signature:</span><span style={{ ...line, minWidth: "150px" }}>&nbsp;</span></td>
                <td style={cell}><span style={label}>Rep Phone:</span><span style={{ ...line, minWidth: "130px" }}>&nbsp;</span></td>
              </tr>
              <tr>
                <td colSpan={2} style={cell}><span style={label}>Rep's Name:</span><span style={{ ...line, minWidth: "230px" }}>&nbsp;</span></td>
              </tr>
            </tbody>
          </table>

          {/* Table 3: Insurance info */}
          <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #333", marginBottom: "10px" }}>
            <tbody>
              <tr>
                <td style={{ ...cell, width: "55%" }}><span style={label}>Insurance Company/Agent:</span><span style={{ ...line, minWidth: "100px" }}>&nbsp;</span></td>
                <td style={cell}><span style={label}>Phone:</span><span style={{ ...line, minWidth: "120px" }}>&nbsp;</span></td>
              </tr>
              <tr>
                <td style={cell}><span style={label}>Policy Number:</span><span style={{ ...line, minWidth: "140px" }}>&nbsp;</span></td>
                <td style={cell}><span style={label}>Claim Number:</span><span style={{ ...line, minWidth: "120px" }}>&nbsp;</span></td>
              </tr>
              <tr>
                <td style={cell}>
                  <span style={label}>Loss Date:</span><span style={{ ...line, minWidth: "80px", marginRight: "10px" }}>&nbsp;</span>
                  <span style={label}>Time:</span><span style={{ ...line, minWidth: "60px" }}>&nbsp;</span>
                </td>
                <td style={cell}><span style={label}>Damage:</span><span style={{ ...line, minWidth: "130px" }}>&nbsp;</span></td>
              </tr>
              <tr>
                <td style={cell}>
                  <span style={label}>Adjuster Appt Date:</span><span style={{ ...line, minWidth: "60px", marginRight: "10px" }}>&nbsp;</span>
                  <span style={label}>Time:</span><span style={{ ...line, minWidth: "50px" }}>&nbsp;</span>
                </td>
                <td style={cell}><span style={label}>Adjuster Name:</span><span style={{ ...line, minWidth: "110px" }}>&nbsp;</span></td>
              </tr>
              <tr>
                <td colSpan={2} style={cell}><span style={label}>Cell:</span><span style={{ ...line, minWidth: "160px" }}>&nbsp;</span></td>
              </tr>
            </tbody>
          </table>

        </div>{/* end flex:1 content */}

          {/* Page 1 footer */}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#444", borderTop: "1px solid #ccc", paddingTop: "6px", marginTop: "16px" }}>
            <span>📍 <EditableBlock value={content.footer_address} onChange={set("footer_address")} tag="span" /></span>
            <span>Page: 01</span>
          </div>
        </div>

        {/* ── PAGE 2 ── */}
        <div id="page-2" style={pageStyle} className="shadow-lg print:shadow-none">
        <div style={{ flex: 1 }}>

          {/* Page 2 intro */}
          <EditableBlock value={content.p2_intro} onChange={set("p2_intro")} tag="p" style={{ marginBottom: "14px", textAlign: "justify" }} />

          {/* 10 back-page terms */}
          <ol style={{ paddingLeft: "22px", marginBottom: "32px" }}>
            {[
              [content.b1, set("b1")],
              [content.b2, set("b2")],
              [content.b3, set("b3")],
              [content.b4, set("b4")],
              [content.b5, set("b5")],
              [content.b6, set("b6")],
              [content.b7, set("b7")],
              [content.b8, set("b8")],
              [content.b9, set("b9")],
              [content.b10, set("b10")],
            ].map(([val, onChange], i) => (
              <li key={i} style={{ marginBottom: "11px", textAlign: "justify" }}>
                <EditableBlock value={val} onChange={onChange} tag="span" />
              </li>
            ))}
          </ol>

          {/* Signature line */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "32px", paddingTop: "8px" }}>
            <div style={{ width: "45%" }}>
              <div style={{ borderTop: "1.5px solid #000", paddingTop: "5px" }}>
                <strong>Property Owner Signature:</strong>
              </div>
            </div>
            <div style={{ width: "30%" }}>
              <div style={{ borderTop: "1.5px solid #000", paddingTop: "5px" }}>
                <strong>Date:</strong>
              </div>
            </div>
          </div>

        </div>{/* end flex:1 content */}

          {/* Page 2 footer */}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#444", borderTop: "1px solid #ccc", paddingTop: "6px", marginTop: "16px" }}>
            <span>📍 {content.footer_address}</span>
            <span>Page: 02</span>
          </div>
        </div>
      </div>

      <style>{`
        @page {
          size: letter;
          margin: 0;
        }
        @media print {
          .no-print { display: none !important; }
          html, body { background: white; margin: 0; padding: 0; }
          .max-w-4xl { max-width: none !important; }
          .py-8 { padding-top: 0 !important; padding-bottom: 0 !important; }
          .px-4 { padding-left: 0 !important; padding-right: 0 !important; }
          #page-1 {
            page-break-after: always;
            break-after: page;
            box-shadow: none !important;
            width: 100% !important;
          }
          #page-2 {
            box-shadow: none !important;
            width: 100% !important;
          }
          .space-y-6 > * + * { margin-top: 0 !important; }
        }
      `}</style>
    </div>
  );
}
