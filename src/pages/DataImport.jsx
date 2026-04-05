import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoleBasedData } from "../components/hooks/useRoleBasedData";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import useTranslation from "@/hooks/useTranslation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ArrowRight,
  Download,
  Loader2
} from "lucide-react";

export default function DataImport() {
  const { t } = useTranslation();
  const { user, myCompany } = useRoleBasedData();
  const [file, setFile] = useState(null);
  const [csvData, setCsvData] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [entityType, setEntityType] = useState("Lead");
  const [columnMapping, setColumnMapping] = useState({});
  const [step, setStep] = useState(1);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [errorDetails, setErrorDetails] = useState([]);

  const queryClient = useQueryClient();

  const { data: importLogs = [] } = useQuery({
    queryKey: ['import-logs', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.ImportLog.filter({ company_id: myCompany.id }, "-created_date") : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const entityFields = {
    Staff: [
        { key: 'full_name', label: 'Full Name', required: true },
        { key: 'email', label: 'Email', required: true },
        { key: 'temporary_password', label: 'Temporary Password', required: false, help: 'Required ONLY for creating new users.' },
        { key: 'position', label: 'Position/Role', required: false },
        { key: 'phone', label: 'Phone Number', required: false },
        { key: 'hourly_rate', label: 'Hourly Rate', required: false },
    ],
    Lead: [
      { key: 'lead_number', label: 'Lead Number', required: false },
      { key: 'ghl_contact_id', label: 'External ID / GHL ID', required: false },
      { key: 'name', label: 'Name', required: true },
      { key: 'email', label: 'Email', required: false },
      { key: 'phone', label: 'Phone', required: false },
      { key: 'phone_2', label: 'Phone 2', required: false },
      { key: 'assigned_to', label: 'Assigned To (Email)', required: false },
      { key: 'is_active', label: 'Active (Yes/No)', required: false },
      { key: 'created_date', label: 'Date Created (YYYY-MM-DD)', required: false },
      { key: 'company', label: 'Company/Address', required: false },
      { key: 'website', label: 'Website', required: false },
      { key: 'group', label: 'Group', required: false },
      { key: 'street', label: 'Street Address', required: false },
      { key: 'city', label: 'City', required: false },
      { key: 'state', label: 'State', required: false },
      { key: 'zip', label: 'Zip Code', required: false },
      { key: 'status', label: 'Status', required: false },
      { key: 'source', label: 'Source', required: false },
      { key: 'value', label: 'Estimated Value', required: false },
      { key: 'notes', label: 'Notes', required: false },
    ],
    Customer: [
      { key: 'customer_number', label: 'Customer Number', required: false },
      { key: 'ghl_contact_id', label: 'External ID / GHL ID', required: false },
      { key: 'name', label: 'Name', required: true },
      { key: 'email', label: 'Email', required: false },
      { key: 'phone', label: 'Phone', required: false },
      { key: 'phone_2', label: 'Phone 2', required: false },
      { key: 'assigned_to', label: 'Assigned To (Email)', required: false },
      { key: 'is_active', label: 'Active (Yes/No)', required: false },
      { key: 'created_date', label: 'Date Created (YYYY-MM-DD)', required: false },
      { key: 'company', label: 'Company', required: false },
      { key: 'customer_type', label: 'Customer Type', required: false },
      { key: 'street', label: 'Street Address', required: false },
      { key: 'city', label: 'City', required: false },
      { key: 'state', label: 'State', required: false },
      { key: 'zip', label: 'Zip Code', required: false },
      { key: 'address', label: 'Full Address', required: false },
      { key: 'website', label: 'Website', required: false },
      { key: 'source', label: 'Source', required: false },
      { key: 'referral_source', label: 'Referred By', required: false },
      { key: 'group', label: 'Group', required: false },
      { key: 'insurance_company', label: 'Insurance Company', required: false },
      { key: 'claim_number', label: 'Claim Number', required: false },
      { key: 'adjuster_name', label: 'Adjuster Name', required: false },
      { key: 'adjuster_phone', label: 'Adjuster Phone', required: false },
      { key: 'installer', label: 'Installer', required: false },
      { key: 'vendor_name', label: 'Vendor Name', required: false },
      { key: 'notes', label: 'Notes', required: false },
    ],
    InspectionJob: [
      { key: 'client_name', label: 'Client Name', required: true },
      { key: 'property_address', label: 'Property Address', required: true },
      { key: 'client_phone', label: 'Client Phone', required: false },
      { key: 'client_email', label: 'Client Email', required: false },
      { key: 'inspection_type', label: 'Inspection Type', required: false },
      { key: 'damage_type', label: 'Damage Type', required: false },
      { key: 'priority', label: 'Priority', required: false },
      { key: 'status', label: 'Status', required: false },
      { key: 'assigned_to_email', label: 'Assigned To (Email)', required: false },
      { key: 'inspection_date', label: 'Inspection Date (YYYY-MM-DD)', required: false },
      { key: 'inspection_time', label: 'Inspection Time', required: false },
      { key: 'notes', label: 'Notes', required: false },
    ],
    Task: [
      { key: 'name', label: 'Task Name', required: true },
      { key: 'description', label: 'Description', required: false },
      { key: 'status', label: 'Status', required: false },
      { key: 'priority', label: 'Priority', required: false },
      { key: 'due_date', label: 'Due Date', required: false },
      { key: 'assigned_to', label: 'Assigned To (email)', required: false },
    ],
    Item: [
      { key: 'name', label: 'Item Name', required: true },
      { key: 'description', label: 'Description', required: false },
      { key: 'category', label: 'Category', required: false },
      { key: 'unit', label: 'Unit', required: false },
      { key: 'price', label: 'Price', required: true },
      { key: 'cost', label: 'Cost', required: false },
      { key: 'sku', label: 'SKU', required: false },
      { key: 'invoice_number', label: 'Invoice #', required: false },
      { key: 'customer_name', label: 'Customer', required: false },
      { key: 'amount', label: 'Amount', required: false },
      { key: 'total_tax', label: 'Total Tax', required: false },
      { key: 'status', label: 'Status', required: false },
      { key: 'issue_date', label: 'Issue Date', required: false },
      { key: 'due_date', label: 'Due Date', required: false },
    ],
    SMSTemplate: [
      { key: 'template_name', label: 'Template Name', required: true },
      { key: 'message', label: 'Message', required: true },
      { key: 'category', label: 'Category', required: true },
    ],
    EmailTemplate: [
      { key: 'template_name', label: 'Template Name', required: true },
      { key: 'subject', label: 'Subject', required: true },
      { key: 'body', label: 'Body/Message', required: true },
      { key: 'category', label: 'Category', required: true },
    ],
    EstimateWithLineItems: [
      { key: 'estimate_number', label: 'Estimate #', required: false },
      { key: 'customer_name', label: 'Customer Name', required: false },
      { key: 'status', label: 'Status', required: false },
      { key: 'valid_until', label: 'Expiry Date (YYYY-MM-DD)', required: false },
      { key: 'insurance_company', label: 'Insurance Company', required: false },
      { key: 'adjuster_name', label: 'Adjuster Name', required: false },
      { key: 'customer_email', label: 'Customer Email', required: false },
      { key: 'customer_phone', label: 'Customer Phone', required: false },
      { key: 'amount', label: 'Total Amount', required: false },
      { key: 'created_date', label: 'Date (YYYY-MM-DD)', required: false },
      { key: 'adjuster_phone', label: 'Adjuster Phone', required: false },
      { key: 'claim_number', label: 'Claim Number', required: false },
      { key: 'line_number', label: 'Line #', required: false },
      { key: 'code', label: 'Item Code', required: false },
      { key: 'description', label: 'Item Description', required: false },
      { key: 'quantity', label: 'Quantity', required: false },
      { key: 'unit', label: 'Unit', required: false },
      { key: 'unit_price', label: 'Unit Price', required: false },
      { key: 'tax_rate', label: 'Tax Rate %', required: false },
    ],
    Estimate: [
      { key: 'estimate_number', label: 'Estimate Number', required: true },
      { key: 'customer_name', label: 'Customer Name', required: true },
      { key: 'amount', label: 'Total Amount (NOT including tax)', required: true },
      { key: 'total_tax', label: 'Tax Amount (separate from total)', required: false },
      { key: 'status', label: 'Status (draft/sent/accepted/declined)', required: false },
      { key: 'valid_until', label: 'Valid Until Date (YYYY-MM-DD)', required: false },
      { key: 'project_name', label: 'Project Name', required: false },
      { key: 'reference_number', label: 'Reference Number', required: false },
      { key: 'insurance_company', label: 'Insurance Company', required: false },
      { key: 'adjuster_name', label: 'Adjuster Name', required: false },
      { key: 'adjuster_phone', label: 'Adjuster Phone', required: false },
      { key: 'claim_number', label: 'Claim Number', required: false },
      { key: 'notes', label: 'Notes', required: false },
    ],
    Invoice: [
      { key: 'invoice_number', label: 'Invoice Number', required: true },
      { key: 'customer_name', label: 'Customer Name', required: true },
      { key: 'customer_email', label: 'Customer Email', required: false },
      { key: 'amount', label: 'Total Amount', required: true },
      { key: 'total_tax', label: 'Total Tax', required: false },
      { key: 'status', label: 'Status (draft/sent/paid/overdue)', required: false },
      { key: 'issue_date', label: 'Issue Date (YYYY-MM-DD)', required: false },
      { key: 'due_date', label: 'Due Date (YYYY-MM-DD)', required: false },
      { key: 'sale_agent', label: 'Sale Agent (Email)', required: false },
      { key: 'sale_agent_name', label: 'Sale Agent Name', required: false },
      { key: 'claim_number', label: 'Claim Number', required: false },
      { key: 'insurance_company', label: 'Insurance Company', required: false },
      { key: 'notes', label: 'Notes', required: false },
      { key: 'payment_method', label: 'Payment Method (Creates Payment)', required: false },
      { key: 'payment_reference', label: 'Payment # (Creates Payment)', required: false },
      { key: 'payment_amount', label: 'Payment Amount (If different)', required: false },
    ],
    Project: [
      { key: 'name', label: 'Project Name', required: true },
      { key: 'customer_name', label: 'Customer Name', required: false },
      { key: 'status', label: 'Status (not_started/in_progress/completed)', required: false },
      { key: 'start_date', label: 'Start Date (YYYY-MM-DD)', required: false },
      { key: 'deadline', label: 'Deadline (YYYY-MM-DD)', required: false },
      { key: 'budget', label: 'Budget', required: false },
      { key: 'description', label: 'Description', required: false },
    ],
    Payment: [
      { key: 'payment_number', label: 'Payment Number', required: false },
      { key: 'invoice_number', label: 'Invoice Number', required: false },
      { key: 'customer_name', label: 'Customer Name', required: true },
      { key: 'amount', label: 'Payment Amount', required: true },
      { key: 'payment_method', label: 'Payment Method (cash/check/credit_card)', required: false },
      { key: 'payment_date', label: 'Payment Date (YYYY-MM-DD)', required: true },
      { key: 'status', label: 'Status (received/pending)', required: false },
      { key: 'reference_number', label: 'Reference/Check Number', required: false },
      { key: 'notes', label: 'Notes', required: false },
    ],
    Transaction: [
      { key: 'date', label: 'Date (YYYY-MM-DD)', required: true },
      { key: 'account', label: 'Account Name', required: true },
      { key: 'type', label: 'Type (debit/credit)', required: true },
      { key: 'description', label: 'Description', required: true },
      { key: 'amount', label: 'Amount', required: true },
    ],
    ChartOfAccount: [
      { key: 'account_name', label: 'Account Name', required: true },
      { key: 'account_number', label: 'Account Number', required: false },
      { key: 'account_type', label: 'Account Type', required: true, help: 'Asset, Liability, Equity, Revenue, or Expense' },
      { key: 'description', label: 'Description', required: false },
    ],
    Commission: [
      { key: 'sales_rep', label: 'Sales Rep Name', required: true },
      { key: 'total_sales', label: 'Total Sales', required: false },
      { key: 'commission_rate', label: 'Commission Rate (%)', required: false },
      { key: 'gross_commission', label: 'Gross Commission', required: false },
      { key: 'total_deductions', label: 'Total Deductions', required: false },
      { key: 'ladder_assist', label: 'Ladder Assist', required: false },
      { key: 'net_commission', label: 'Net Commission', required: false },
      { key: 'status', label: 'Status', required: false },
    ],
  };

  // Detect section title rows like "=== CREWCAM JOB ASSIGNMENTS ===" that are not real headers
  const isTitleRow = (line) => {
    const t = (line || '').trim();
    return (t.startsWith('===') || t.startsWith('---') || t.startsWith('***')) ||
           (t.startsWith('==') && t.endsWith('=='));
  };

  const parseCSV = (text) => {
    // Normalize line endings to handle \r, \n, and \r\n
    const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalizedText.trim().split('\n');

    // Detect delimiter
    const firstLine = lines[0] || '';
    let delimiter = ',';
    
    const candidates = [',', ';', '\t', '|'];
    let bestCount = 0;
    
    // Check first few lines for consensus on delimiter
    const linesToCheck = lines.slice(0, 5);
    
    candidates.forEach(d => {
      let avgCount = 0;
      let validLines = 0;
      
      linesToCheck.forEach(line => {
        if (!line.trim()) return;
        // Basic split count
        const count = (line.split(d).length - 1);
        if (count > 0) {
          avgCount += count;
          validLines++;
        }
      });
      
      if (validLines > 0) {
        avgCount = avgCount / validLines;
      }
      
      if (avgCount > bestCount) {
        bestCount = avgCount;
        delimiter = d;
      }
    });

    const parseLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
          // Handle escaped quotes (double quotes)
          if (inQuotes && line[i + 1] === '"') {
             current += '"';
             i++; 
          } else {
             inQuotes = !inQuotes;
          }
        } else if (char === delimiter && !inQuotes) {
          result.push(current.trim().replace(/^["']|["']$/g, ''));
          current = '';
        } else {
          current += char;
        }
      }

      result.push(current.trim().replace(/^["']|["']$/g, ''));
      return result;
    };

    // Skip title/section rows (e.g., "=== CREWCAM JOB ASSIGNMENTS ===")
    let headerLineIdx = 0;
    if (isTitleRow(lines[0])) headerLineIdx = 1;

    const headers = parseLine(lines[headerLineIdx]);
    const rows = [];

    for (let i = headerLineIdx + 1; i < Math.min(lines.length, headerLineIdx + 6); i++) {
      if (!lines[i] || !lines[i].trim()) continue;
      const values = parseLine(lines[i]);
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx] || '';
      });
      rows.push(row);
    }

    const skippedTitleRows = headerLineIdx;
    return { headers, rows, totalRows: lines.length - 1 - skippedTitleRows, delimiter };
  };

  const smartAutoMap = (headers, entityType) => {
    const mapping = {};
    const fields = entityFields[entityType];
    
    const patterns = {
      name: ['name', 'contact', 'contact name', 'customer name', 'lead name', 'full name', 'person', 'client name'],
      full_name: ['full name', 'staff name', 'employee name', 'name'],
      email: ['email', 'e-mail', 'email address', 'contact email'],
      temporary_password: ['password', 'temp password', 'temporary_password'],
      position: ['position', 'role', 'job title'],
      hourly_rate: ['hourly rate', 'rate', 'pay rate'],
      phone: ['phone', 'telephone', 'phone number', 'cell', 'mobile', 'contact phone', 'primary phone'],
      phone_2: ['phone 2', 'phone2', 'secondary phone', 'alternate phone', 'mobile 2', 'cell 2', 'whatsapp'],
      company: ['company', 'business', 'organization', 'company name', 'business name'],
      customer_type: ['customer type', 'type', 'client type'],
      street: ['street', 'street address', 'address line 1'],
      city: ['city', 'town'],
      state: ['state', 'province'],
      zip: ['zip', 'zip code', 'postal code', 'postcode'],
      website: ['website', 'url', 'web'],
      group: ['group', 'groups', 'customer group'],
      installer: ['installer', 'contractor'],
      vendor_name: ['vendor', 'vendor name', 'supplier', 'material supplied by'],
      referral_source: ['referral source', 'referred by', 'referrer'],
      status: ['status', 'lead status', 'task status', 'project status', 'invoice status', 'estimate status', 'payment status', 'state'],
      source: ['source', 'lead source', 'origin'],
      value: ['value', 'estimated value', 'deal value', 'opportunity value', 'est value'],
      notes: ['notes', 'comments', 'description', 'details', 'remarks'],
      address: ['address', 'street', 'location', 'property address', 'full address', 'shipping address', 'billing address'],
      customer_number: ['customer #', 'customer number', 'customer no', 'cust #'],
      lead_number: ['lead #', 'lead number', 'lead no'],
      ghl_contact_id: ['id', 'ghl id', 'contact id', 'external id', 'record id'],
      estimate_number: ['estimate #', 'estimate number', 'estimate no', 'est #', 'est no', 'estimate id', 'quote #', 'quote number', 'quote id'],
      invoice_number: ['invoice #', 'invoice number', 'invoice no', 'inv #', 'inv no', 'invoice id', 'invoice'],
      customer_name: ['customer', 'customer name', 'client', 'client name', 'name', 'contact', 'recipient'],
      customer_email: ['customer email', 'client email', 'email', 'contact email', 'recipient email'],
      amount: ['amount', 'total', 'total amount', 'price', 'total price', 'sum', 'value', 'grand total', 'subtotal', 'payment amount', 'invoice amount', 'invoice total'],
      total_tax: ['tax', 'total tax', 'tax amount', 'vat', 'sales tax'],
      sale_agent: ['sale agent', 'sales agent', 'agent', 'rep', 'sales rep', 'assigned to', 'salesman'],
      sale_agent_name: ['sale agent name', 'sales agent name', 'agent name', 'rep name', 'sales rep name'],
      valid_until: ['valid until', 'expiry', 'expiration', 'expires', 'valid through', 'expire date'],
      issue_date: ['issue date', 'date', 'invoice date', 'created date', 'date issued', 'bill date', 'created'],
      due_date: ['due date', 'payment due', 'due by', 'invoice due date', 'task due date', 'deadline', 'due'],
      project_name: ['project name', 'project'],
      reference_number: ['reference', 'reference number', 'ref #', 'invoice reference'],
      insurance_company: ['insurance company', 'insurer'],
      adjuster_name: ['adjuster name', 'adjuster'],
      adjuster_phone: ['adjuster phone', 'adjuster #'],
      claim_number: ['claim #', 'claim number', 'claim id'],
      description: ['description', 'item description', 'details', 'product description', 'service description', 'project description', 'line item description'],
      category: ['category', 'type', 'item type', 'group', 'product category'],
      unit: ['unit', 'uom', 'unit of measure', 'measurement', 'item unit'],
      price: ['price', 'rate', 'unit price', 'cost', 'amount', 'selling price'],
      cost: ['cost', 'unit cost', 'item cost', 'purchase price'],
      sku: ['sku', 'item code', 'product code', 'code', 'stock keeping unit'],
      line_number: ['line #', 'line number', 'item #', 'item number'],
      code: ['code', 'item code', 'product code', 'sku'],
      quantity: ['qty', 'quantity', 'count'],
      unit_price: ['unit price', 'rate', 'price per unit', 'price', 'item price'],
      tax_rate: ['tax rate', 'vat rate', 'tax %', 'vat %'],
      priority: ['priority', 'importance', 'level', 'task priority'],
      assigned_to: ['assigned to', 'assignee', 'assigned', 'owner', 'task owner', 'assigned to (primary)'],
      is_active: ['active', 'is active', 'is_active', 'status active'],
      created_date: ['date created', 'created date', 'created at', 'created_at', 'joined date'],
      start_date: ['start date', 'start', 'begin date', 'project start date'],
      deadline: ['deadline', 'due date', 'end date', 'completion date', 'project deadline', 'task deadline'],
      budget: ['budget', 'estimated budget', 'project budget', 'cost estimate'],
      payment_number: ['payment #', 'payment number', 'payment no', 'receipt #', 'receipt number', 'transaction #', 'transaction id'],
      payment_reference: ['payment #', 'payment number', 'payment ref', 'check #', 'cheque #'],
      payment_method: ['payment method', 'method', 'payment type', 'how paid', 'type'],
      payment_amount: ['payment amount', 'amount paid'],
      payment_date: ['payment date', 'date paid', 'received date', 'date received', 'date'],
      date: ['date', 'transaction date'],
      account: ['account', 'account name'],
      type: ['type', 'transaction type'],
      account_name: ['account name', 'name'],
      account_number: ['account number', 'number', 'acct #'],
      account_type: ['account type', 'type', 'category'],
      template_name: ['template name', 'name', 'title'],
      message: ['message', 'sms text', 'text', 'body', 'content'],
      subject: ['subject', 'email subject', 'title'],
      body: ['body', 'message', 'content', 'email body', 'html'],
      sales_rep: ['sales rep', 'rep', 'staff', 'sales person', 'employee', 'name', 'salesperson'],
      total_sales: ['total sales', 'sales', 'gross sales', 'sales volume'],
      gross_commission: ['gross commission', 'gross comm', 'commission earned'],
      total_deductions: ['total deductions', 'deductions', 'total deduction'],
      ladder_assist: ['ladder assist', 'ladder', 'assist'],
      net_commission: ['net commission', 'net comm', 'net', 'commission'],
      // InspectionJob / CrewCam fields
      client_name: ['client name', 'client', 'homeowner', 'customer name', 'contact name'],
      property_address: ['property address', 'address', 'job address', 'location', 'site address', 'property'],
      client_phone: ['client phone', 'client phone number', 'homeowner phone', 'contact phone'],
      client_email: ['client email', 'homeowner email', 'contact email'],
      inspection_type: ['inspection type', 'job type', 'type of inspection', 'inspection'],
      damage_type: ['damage type', 'damage', 'claim type', 'damage description'],
      assigned_to_email: ['assigned to', 'inspector', 'assigned inspector', 'assignee', 'assigned to email', 'inspector email'],
      inspection_date: ['inspection date', 'scheduled date', 'job date', 'date of inspection', 'scheduled'],
      inspection_time: ['inspection time', 'time', 'scheduled time', 'time of inspection'],
    };

    if (entityType === 'Item') {
      patterns.name = ['item name', 'name', 'description', 'item description', 'service name', 'product name', 'title', 'line item'];
    }

    if (entityType === 'EstimateWithLineItems') {
      patterns.amount = patterns.amount.filter(p => !['price', 'rate', 'unit price', 'price per unit', 'item price'].includes(p));
    }
    
    headers.forEach(header => {
      const headerLower = header.toLowerCase().trim();
      
      for (const field of fields) {
        const fieldPatterns = patterns[field.key];
        if (fieldPatterns) {
          const matches = fieldPatterns.some(pattern => {
            if (headerLower === pattern) return true;
            if (headerLower.replace(/\s/g, '') === pattern.replace(/\s/g, '')) return true;
            if (headerLower.includes(pattern) || pattern.includes(headerLower)) return true;
            return false;
          });
          
          if (matches && !Object.values(mapping).includes(field.key)) {
            mapping[header] = field.key;
            break;
          }
        }
      }
    });
    
    return mapping;
  };

  const handleFileUpload = (e) => {
    const uploadedFile = e.target.files[0];
    if (uploadedFile) {
      setFile(uploadedFile);
      const reader = new FileReader();
      reader.onload = (event) => {
      // Remove BOM if present
      const text = event.target.result.replace(/^\uFEFF/, '');
      const parsed = parseCSV(text);
      setCsvData(text);
      setHeaders(parsed.headers);
      setPreviewRows(parsed.rows);

      // Store delimiter for later use
      window.importDelimiter = parsed.delimiter;

      const autoMapping = smartAutoMap(parsed.headers, entityType);
      setColumnMapping(autoMapping);
        
        const requiredFields = entityFields[entityType].filter(f => f.required);
        const mappedRequiredFields = requiredFields.filter(f => 
          Object.values(autoMapping).includes(f.key)
        );
        
        if (mappedRequiredFields.length === requiredFields.length) {
          console.log('✅ All required fields auto-mapped successfully!');
        } else {
          console.log('⚠️ Some required fields need manual mapping');
        }
        
        setStep(2);
      };
      reader.readAsText(uploadedFile);
    }
  };

  const handleImport = async () => {
    if (!myCompany) {
      alert("Please set up your company profile first!");
      return;
    }

    setImporting(true);
    setImportResult(null);
    setErrorDetails([]);

    try {
      const importStartTime = new Date();
      // Normalize line endings and filter empty lines
      const rawLines = csvData.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      const lines = rawLines.filter(line => line.trim().length > 0);
      
      const delimiter = window.importDelimiter || ',';
      
      const parseLine = (line) => {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
          const char = line[i];

          if (char === '"') {
            // Handle escaped quotes (double quotes)
            if (inQuotes && line[i + 1] === '"') {
               current += '"';
               i++; 
            } else {
               inQuotes = !inQuotes;
            }
          } else if (char === delimiter && !inQuotes) {
            result.push(current.trim().replace(/^["']|["']$/g, ''));
            current = '';
          } else {
            current += char;
          }
        }

        result.push(current.trim().replace(/^["']|["']$/g, ''));
        return result;
      };

      // Skip title/section rows (e.g., "=== CREWCAM JOB ASSIGNMENTS ===")
      let headerLineIdx = 0;
      if (isTitleRow(lines[0])) headerLineIdx = 1;

      const csvHeaders = parseLine(lines[headerLineIdx]);

      // SPECIAL CASE FOR STAFF IMPORT
      if (entityType === 'Staff') {
        const staffRecords = [];
        for (let i = headerLineIdx + 1; i < lines.length; i++) {
          const values = parseLine(lines[i]);
          const record = {};
          csvHeaders.forEach((header, idx) => {
            const mappedField = columnMapping[header];
            if (mappedField && values[idx] !== undefined) {
              let value = values[idx];
              if (typeof value === 'string') {
                value = value.trim().replace(/^["']|["']$/g, '');
                if (value === '-') value = ''; // Handle "-" as empty for dates/numbers
                if (value.toLowerCase().includes('no permission')) value = '';
              }
              record[mappedField] = value;
            }
          });
          staffRecords.push(record);
        }
        
        const response = await base44.functions.invoke('importStaff', { 
            records: staffRecords, 
            company_id: myCompany.id 
        });
        
        const result = response.data;
        
        if (result.success === false && !result.errors) {
            setImportResult({ success: false, error: result.error || "An unknown backend error occurred." });
            setErrorDetails(result.errorDetails || []);
        } else {
            setImportResult({
              success: result.errors === 0,
              imported: result.created + result.updated,
              skipped: 0,
              errors: result.errors
            });
            setErrorDetails(result.errorDetails);
        }

        if (result.errors > 0 || result.created > 0 || result.updated > 0) {
            await base44.entities.ImportLog.create({
              company_id: myCompany.id,
              import_name: file.name,
              entity_type: 'Staff',
              file_name: file.name,
              total_rows: lines.length - 1,
              imported_count: result.created + result.updated,
              skipped_count: 0,
              error_count: result.errors,
              status: result.errors > 0 ? 'completed_with_errors' : 'completed',
              column_mapping: columnMapping,
              preview_data: previewRows,
              start_time: importStartTime.toISOString(),
              end_time: new Date().toISOString()
            });
        }

        queryClient.invalidateQueries({ queryKey: ['staff-profiles'] });
        queryClient.invalidateQueries({ queryKey: ['all-users'] });
        queryClient.invalidateQueries({ queryKey: ['import-logs'] });
        
        setStep(4);
        setImporting(false);
        return;
      }

      if (entityType === 'Commission') {
        const parseMoney = (val) => {
          if (!val) return 0;
          const cleaned = String(val).replace(/[$,\s]/g, '').replace(/^-/, '');
          const num = parseFloat(cleaned);
          return isNaN(num) ? 0 : num;
        };

        const staffProfiles = await base44.entities.StaffProfile.filter({ company_id: myCompany.id });

        let imported = 0;
        let skipped = 0;
        let errors = 0;
        const errorLog = [];

        for (let i = headerLineIdx + 1; i < lines.length; i++) {
          try {
            const values = parseLine(lines[i]);
            const record = {};
            csvHeaders.forEach((header, idx) => {
              const mappedField = columnMapping[header];
              if (mappedField && values[idx] !== undefined) {
                record[mappedField] = values[idx].trim().replace(/^["']|["']$/g, '');
              }
            });

            if (!record.sales_rep) { skipped++; continue; }

            const repNameLower = record.sales_rep.toLowerCase().trim();
            const matchedProfile = staffProfiles.find(sp => {
              const profileName = (sp.full_name || sp.name || '').toLowerCase().trim();
              return profileName === repNameLower || profileName.includes(repNameLower) || repNameLower.includes(profileName);
            });

            if (!matchedProfile) {
              errors++;
              errorLog.push({ row: i + 1, reason: `No staff profile found matching "${record.sales_rep}"`, data: record });
              continue;
            }

            const netCommission = parseMoney(record.net_commission);
            const totalSales = parseMoney(record.total_sales);
            const ladderAssist = parseMoney(record.ladder_assist);
            const totalDeductions = parseMoney(record.total_deductions);
            const rateStr = record.commission_rate ? String(record.commission_rate).replace(/[%\s]/g, '') : null;
            const commissionRate = rateStr ? parseFloat(rateStr) : null;

            const updatePayload = {
              total_commissions_earned: (parseFloat(matchedProfile.total_commissions_earned) || 0) + netCommission,
              current_period_sales: (parseFloat(matchedProfile.current_period_sales) || 0) + totalSales,
            };
            if (commissionRate !== null && !isNaN(commissionRate)) {
              updatePayload.commission_rate = commissionRate;
            }

            await base44.entities.StaffProfile.update(matchedProfile.id, updatePayload);

            if (ladderAssist > 0) {
              await base44.entities.CommissionDeduction.create({
                company_id: myCompany.id,
                sales_rep_email: matchedProfile.user_email,
                deduction_type: 'ladder_assist',
                amount: ladderAssist,
                deduction_date: new Date().toISOString().split('T')[0],
                description: `Imported: Ladder Assist for ${record.sales_rep}`,
              });
            }

            if (totalDeductions > 0 && totalDeductions !== ladderAssist) {
              const otherDeductions = totalDeductions - ladderAssist;
              if (otherDeductions > 0) {
                await base44.entities.CommissionDeduction.create({
                  company_id: myCompany.id,
                  sales_rep_email: matchedProfile.user_email,
                  deduction_type: 'other',
                  amount: otherDeductions,
                  deduction_date: new Date().toISOString().split('T')[0],
                  description: `Imported: Other deductions for ${record.sales_rep}`,
                });
              }
            }

            imported++;
          } catch (err) {
            errors++;
            errorLog.push({ row: i + 1, reason: err.message, data: lines[i] });
          }
        }

        await base44.entities.ImportLog.create({
          company_id: myCompany.id,
          import_name: file.name,
          entity_type: 'Commission',
          file_name: file.name,
          total_rows: lines.length - 1,
          imported_count: imported,
          skipped_count: skipped,
          error_count: errors,
          status: errors > 0 ? 'completed_with_errors' : 'completed',
          column_mapping: columnMapping,
          preview_data: previewRows,
          start_time: importStartTime.toISOString(),
          end_time: new Date().toISOString(),
        });

        setErrorDetails(errorLog);
        setImportResult({ success: errors === 0, imported, skipped, errors });
        queryClient.invalidateQueries({ queryKey: ['staff-profiles-commission'] });
        queryClient.invalidateQueries({ queryKey: ['commission-deductions'] });
        queryClient.invalidateQueries({ queryKey: ['import-logs'] });
        setStep(4);
        setImporting(false);
        return;
      }

      if (entityType === 'EstimateWithLineItems') {
        const estimatesMap = new Map();
        let processingErrors = 0;
        let skippedRows = 0;
        const localErrorLog = [];

        for (let i = headerLineIdx + 1; i < lines.length; i++) {
          try {
            const values = parseLine(lines[i]);
            const currentRow = {};
            csvHeaders.forEach((header, idx) => {
              const mappedField = columnMapping[header];
              if (mappedField && values[idx] !== undefined) {
                let value = values[idx];
                // Clean "No Permission!" values
                if (typeof value === 'string' && value.toLowerCase().includes('no permission')) {
                  value = '';
                }
                currentRow[mappedField] = value;
              }
            });

            const estimateNum = currentRow['estimate_number'] || `IMP-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`;
            const customerName = currentRow['customer_name'] || 'Imported';

            if (!estimatesMap.has(estimateNum)) {
              estimatesMap.set(estimateNum, {
                estimate_number: estimateNum,
                customer_name: customerName,
                customer_email: currentRow['customer_email'] || '',
                customer_phone: currentRow['customer_phone'] || '',
                amount: parseFloat(currentRow['amount']?.replace(/[$,\s]/g, '')) || 0,
                status: currentRow['status'] || 'draft',
                valid_until: currentRow['valid_until'] || null,
                created_date: currentRow['created_date'] || new Date().toISOString(),
                insurance_company: currentRow['insurance_company'] || '',
                adjuster_name: currentRow['adjuster_name'] || '',
                adjuster_phone: currentRow['adjuster_phone'] || '',
                claim_number: currentRow['claim_number'] || '',
                notes: currentRow['notes'] || '',
                items: [],
                company_id: myCompany.id
              });
            }

            const estimate = estimatesMap.get(estimateNum);
            
            const itemDescription = currentRow['description'];
            const itemQuantity = parseFloat(currentRow['quantity']?.replace(/[$,\s]/g, '')) || null;
            const itemUnitPrice = parseFloat(currentRow['unit_price']?.replace(/[$,\s]/g, '')) || null;
            const itemUnit = currentRow['unit'] || null;
            const taxRate = parseFloat(currentRow['tax_rate']?.replace(/[%\s]/g, '')) || null;

            if (itemDescription || (itemQuantity !== null && itemUnitPrice !== null && itemUnit !== null)) {
              estimate.items.push({
                line_number: currentRow['line_number'] || null,
                code: currentRow['code'] || '',
                description: itemDescription || '',
                quantity: itemQuantity,
                rate: itemUnitPrice,
                unit: itemUnit,
                amount: (itemQuantity !== null && itemUnitPrice !== null) ? (itemQuantity * itemUnitPrice) : null,
                tax_rate: taxRate,
              });
            }
          } catch (err) {
            console.error(`Error processing row ${i} for EstimateWithLineItems:`, err);
            processingErrors++;
            localErrorLog.push({
              row: i + 1,
              reason: `Processing error: ${err.message}`,
              data: lines[i]
            });
          }
        }

        let importedEstimates = 0;
        let failedEstimates = 0;
        
        // BATCHED WITH DELAY
        const estimateArray = Array.from(estimatesMap.values());
        const batchSize = 10; // Reduced from 50 to 10
        
        for (let i = 0; i < estimateArray.length; i += batchSize) {
          const batch = estimateArray.slice(i, i + batchSize);
          
          for (const estimate of batch) {
            try {
              let subtotal = 0;
              let totalTax = 0;

              estimate.items.forEach(item => {
                if (item.quantity !== null && item.rate !== null) {
                  const itemAmount = item.quantity * item.rate;
                  subtotal += itemAmount;
                  if (item.tax_rate !== null) {
                    totalTax += itemAmount * (item.tax_rate / 100);
                  }
                }
              });
              
              // Only override amount if calculated subtotal is greater than 0
              if (subtotal > 0) {
                  estimate.amount = subtotal;
              }
              estimate.total_tax = totalTax;

              await base44.entities.Estimate.create(estimate);
              importedEstimates++;
            } catch (err) {
              console.error('Failed to import estimate:', estimate.estimate_number, err);
              failedEstimates++;
              localErrorLog.push({
                row: `Estimate: ${estimate.estimate_number}`,
                reason: `Failed to create estimate: ${err.message}`,
                data: estimate
              });
            }
          }
          
          // DELAY BETWEEN BATCHES
          if (i + batchSize < estimateArray.length) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
          }
        }

        setErrorDetails(localErrorLog);

        const importEndTime = new Date();

        await base44.entities.ImportLog.create({
          company_id: myCompany.id,
          import_name: file.name,
          entity_type: 'Estimate (with Line Items)',
          file_name: file.name,
          total_rows: lines.length - 1,
          imported_count: importedEstimates,
          skipped_count: skippedRows,
          error_count: processingErrors + failedEstimates,
          status: (skippedRows + processingErrors + failedEstimates) > 0 ? 'completed_with_errors' : 'completed',
          column_mapping: columnMapping,
          preview_data: previewRows,
          start_time: importStartTime.toISOString(),
          end_time: importEndTime.toISOString()
        });

        setImportResult({
          success: (skippedRows + processingErrors + failedEstimates) === 0,
          imported: importedEstimates,
          skipped: skippedRows,
          errors: processingErrors + failedEstimates
        });

        queryClient.invalidateQueries({ queryKey: ['estimates'] });
        queryClient.invalidateQueries({ queryKey: ['import-logs'] });

        setStep(4);
        setImporting(false);
        return;
      }

      // SPECIAL CASE FOR INVOICE IMPORT (To handle payments)
      if (entityType === 'Invoice') {
        const records = [];
        const payments = [];
        let skippedRequired = 0;
        let processingErrors = 0;
        const errorLog = [];
        
        for (let i = headerLineIdx + 1; i < lines.length; i++) {
          try {
            const values = parseLine(lines[i]);
            const record = { company_id: myCompany.id };
            let paymentData = { company_id: myCompany.id };
            let hasPaymentInfo = false;
  
            csvHeaders.forEach((header, idx) => {
              const mappedField = columnMapping[header];
              if (mappedField && values[idx] !== undefined) {
                let value = values[idx];
                
                // Clean "No Permission!" and handle "-" as empty
                if (typeof value === 'string') {
                  value = value.trim().replace(/^["']|["']$/g, '');
                  if (value === '-') value = '';
                  if (value.toLowerCase().includes('no permission')) value = '';
                }
  
                if (['amount', 'payment_amount'].includes(mappedField)) {
                  const cleanedValue = String(value).replace(/[$,\s]/g, '');
                  value = parseFloat(cleanedValue) || 0;
                }
  
                if (['payment_method', 'payment_reference', 'payment_amount'].includes(mappedField)) {
                    paymentData[mappedField] = value;
                    if (value) hasPaymentInfo = true;
                } else {
                    record[mappedField] = value;
                }
                
                // Also copy shared fields to payment
                if (['invoice_number', 'customer_name', 'issue_date'].includes(mappedField)) {
                    if (mappedField === 'issue_date') paymentData['payment_date'] = value;
                    else paymentData[mappedField] = value;
                }
              }
            });
  
            // Required check
            const requiredFields = entityFields['Invoice'].filter(f => f.required);
            const missingFields = requiredFields.filter(f => !record[f.key]);
  
            if (missingFields.length > 0) {
              skippedRequired++;
              continue;
            }
  
            // Handle Status
            if (record.status && record.status.toLowerCase() === 'received') {
                record.status = 'paid';
                hasPaymentInfo = true;
            }
            
            // If we have payment info, set invoice to paid and prepare payment record
            if (hasPaymentInfo && !paymentData.amount && record.amount) {
                paymentData.amount = record.amount; // Default to invoice amount if not specified
            }
  
            if (hasPaymentInfo && paymentData.amount > 0) {
                record.status = 'paid';
                record.amount_paid = paymentData.amount;
                payments.push({
                    ...paymentData,
                    status: 'received',
                    payment_date: paymentData.payment_date || new Date().toISOString().split('T')[0]
                });
            }
  
            records.push(record);
          } catch (err) {
            processingErrors++;
          }
        }
  
        // Import Invoices
        const batchSize = 10;
        let imported = 0;
        
        for (let i = 0; i < records.length; i += batchSize) {
            const batch = records.slice(i, i + batchSize);
            await base44.entities.Invoice.bulkCreate(batch);
            imported += batch.length;
            if (i + batchSize < records.length) await new Promise(r => setTimeout(r, 1000));
        }
  
        // Import Payments
        if (payments.length > 0) {
             for (let i = 0; i < payments.length; i += batchSize) {
                const batch = payments.slice(i, i + batchSize);
                await base44.entities.Payment.bulkCreate(batch);
                if (i + batchSize < payments.length) await new Promise(r => setTimeout(r, 1000));
            }
        }
  
        // Finish
        setImportResult({
            success: true,
            imported: imported,
            skipped: skippedRequired,
            errors: processingErrors,
            message: `Imported ${imported} invoices and created ${payments.length} payment records.`
        });
        
        // Invalidate queries
        queryClient.invalidateQueries({ queryKey: ['invoices'] });
        queryClient.invalidateQueries({ queryKey: ['payments'] });
        queryClient.invalidateQueries({ queryKey: ['import-logs'] });
        
        setStep(4);
        setImporting(false);
        return;
      }

      // REGULAR ENTITY IMPORT WITH BATCHING AND DELAYS
      const records = [];
      let skippedRequired = 0;
      let processingErrors = 0;
      const errorLog = [];
      
      const totalDataRows = lines.length - 1 - headerLineIdx;

      for (let i = headerLineIdx + 1; i < lines.length; i++) {
        try {
          const values = parseLine(lines[i]);
          const record = { company_id: myCompany.id };

          csvHeaders.forEach((header, idx) => {
            const mappedField = columnMapping[header];
            if (mappedField && values[idx] !== undefined) {
              let value = values[idx];

              // Clean "No Permission!" values common in Yicn CRM exports
              if (typeof value === 'string' && value.toLowerCase().includes('no permission')) {
                value = '';
              }

              if (['value', 'price', 'cost', 'amount', 'budget', 'total_tax', 'hourly_rate', 'customer_number', 'lead_number'].includes(mappedField)) {
                const cleanedValue = String(value).replace(/[$,\s]/g, '');
                value = parseFloat(cleanedValue) || 0;
              }

              if (mappedField === 'is_active') {
                const lowerVal = String(value).toLowerCase().trim();
                value = lowerVal === 'yes' || lowerVal === 'true' || lowerVal === '1' || lowerVal === 'active';
              }

              if (mappedField === 'created_date') {
                 // Try to keep original date format if valid, or just pass as string
                 // Base44 might handle ISO string better
                 try {
                   if (value && !isNaN(Date.parse(value))) {
                     value = new Date(value).toISOString();
                   }
                 } catch (e) {
                   // keep original value if parse fails
                 }
              }

              record[mappedField] = value;
            }
          });

          if (!record.name && record.company && entityType !== 'ChartOfAccount' && entityType !== 'Staff' && entityType !== 'SMSTemplate' && entityType !== 'EmailTemplate') {
            record.name = record.company;
          }
          
          if (entityType === 'ChartOfAccount' && record.account_name) {
              record.name = record.account_name;
          }
          if (entityType === 'SMSTemplate' && record.template_name) {
              record.name = record.template_name;
          }
          if (entityType === 'EmailTemplate' && record.template_name) {
              record.name = record.template_name;
          }

          if (entityType === 'Customer' && !record.customer_number) {
            record.customer_number = totalDataRows - i + 1;
          }

          // Check if row is empty (all mapped fields are empty)
          const hasData = Object.keys(record).some(key => 
            key !== 'company_id' && 
            key !== 'customer_number' && // Exclude auto-generated/defaults
            key !== 'lead_number' &&
            record[key] !== null && 
            record[key] !== ''
          );

          if (!hasData) {
            continue; // Skip empty rows silently
          }

          const requiredFields = entityFields[entityType].filter(f => f.required);
          const missingFields = requiredFields.filter(f => {
            const val = record[f.key];
            // Allow 0 as a valid value for numeric fields
            return val === undefined || val === null || val === '';
          });

          if (missingFields.length > 0) {
            skippedRequired++;
            errorLog.push({
              row: i + 1,
              reason: `Missing required fields: ${missingFields.map(f => f.label).join(', ')}`,
              data: record
            });
            continue;
          }

          records.push(record);
        } catch (err) {
          console.error(`Error processing row ${i}:`, err);
          processingErrors++;
          errorLog.push({
            row: i + 1,
            reason: `Processing error: ${err.message}`,
            data: lines[i]
          });
        }
      }

      setErrorDetails(errorLog);

      if (records.length === 0 && (lines.length - 1) > 0) {
        setImportResult({
          success: false,
          error: `No records were imported. All ${lines.length - 1} rows were skipped or had errors.`,
          imported: 0,
          skipped: skippedRequired,
          errors: processingErrors
        });
        setStep(4);
        setImporting(false);
        return;
      }

      console.log(`Attempting to import ${records.length} ${entityType} records...`);

      const apiEntityType = entityType === 'Item' ? 'PriceListItem' : entityType;

      let imported = 0;
      let skippedDuplicates = 0;

      const isBackendImportType = entityType === 'Lead' || entityType === 'Customer' || entityType === 'InspectionJob';

      if (isBackendImportType && records.length > 0) {
        // DEDUP-SAFE IMPORT: full dedup check + insert handled server-side
        const fnName = entityType === 'InspectionJob' ? 'importInspectionJobs' : 'importLeadsOrCustomers';
        const fnParams = entityType === 'InspectionJob'
          ? { records, company_id: myCompany.id }
          : { records, entity_type: entityType, company_id: myCompany.id };
        const response = await base44.functions.invoke(fnName, fnParams);
        const result = response.data || {};
        if (result.success === false) {
          setImportResult({ success: false, error: result.error || 'Import failed on the server.', imported: 0, skipped: skippedRequired, skippedDuplicates: 0, errors: processingErrors });
          setStep(4);
          setImporting(false);
          return;
        }
        imported = result.imported || 0;
        skippedDuplicates = result.skippedDuplicates || 0;
        processingErrors += result.errors || 0;
        if (Array.isArray(result.errorDetails)) {
          result.errorDetails.forEach(d => errorLog.push({ row: '?', reason: d.reason, data: JSON.stringify(d.data) }));
          setErrorDetails([...errorLog]);
        }
      } else if (records.length > 0) {
        // REGULAR BATCHED IMPORT for all other entity types
        const batchSize = 10;
        for (let i = 0; i < records.length; i += batchSize) {
          const batch = records.slice(i, i + batchSize);
          try {
            await base44.entities[apiEntityType].bulkCreate(batch);
            imported += batch.length;
          } catch (batchErr) {
            console.error(`[Import] Batch ${Math.floor(i/batchSize)+1} failed:`, batchErr.message);
            for (const item of batch) {
              try {
                await base44.entities[apiEntityType].create(item);
                imported += 1;
              } catch (singleErr) {
                console.error(`[Import] Single record failed:`, singleErr.message, item);
                errorLog.push({ row: i + 1, reason: `Import error: ${singleErr.message}`, data: JSON.stringify(item) });
                processingErrors += 1;
              }
            }
          }
          if (i + batchSize < records.length) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            console.log(`Imported ${imported} of ${records.length}...`);
          }
        }
      }

      const importEndTime = new Date();

      await base44.entities.ImportLog.create({
        company_id: myCompany.id,
        import_name: file.name,
        entity_type: entityType,
        file_name: file.name,
        total_rows: lines.length - 1,
        imported_count: imported,
        skipped_count: skippedRequired + skippedDuplicates,
        error_count: processingErrors,
        status: (skippedRequired + processingErrors) > 0 ? 'completed_with_errors' : 'completed',
        column_mapping: columnMapping,
        preview_data: previewRows,
        start_time: importStartTime.toISOString(),
        end_time: importEndTime.toISOString()
      });

      setImportResult({
        success: true,
        imported: imported,
        skipped: skippedRequired,
        skippedDuplicates: skippedDuplicates,
        errors: processingErrors
      });

      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['sms-templates'] }); // NEW
      queryClient.invalidateQueries({ queryKey: ['email-templates'] }); // NEW
      queryClient.invalidateQueries({ queryKey: ['import-logs'] });

      setStep(4);
    } catch (error) {
      console.error('Import error:', error);
      setImportResult({
        success: false,
        error: error.message,
        imported: 0,
        skipped: 0,
        errors: csvData.trim().split('\n').length - 1
      });
      setErrorDetails([]);
      setStep(4);
    }

    setImporting(false);
  };

  const handleReset = () => {
    setFile(null);
    setCsvData(null);
    setHeaders([]);
    setPreviewRows([]);
    setColumnMapping({});
    setStep(1);
    setImportResult(null);
    setErrorDetails([]);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-row items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t.sidebar.dataImport}</h1>
          <p className="text-gray-500 mt-1">{t.common.import} data from your old CRM via CSV files</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.open('/base44-snippets/import-template.csv', '_blank')} className="flex items-center gap-2 hover-elevate">
            <Download className="h-4 w-4" />
            {t.common.download} Template
          </Button>
        </div>
      </div>

      <Card className="bg-white">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className={`flex items-center gap-2 ${step >= 1 ? 'text-blue-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step >= 1 ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
                1
              </div>
              <span className="font-medium">{t.common.upload} CSV</span>
            </div>
            <ArrowRight className="text-gray-400" />
            <div className={`flex items-center gap-2 ${step >= 2 ? 'text-blue-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step >= 2 ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
                2
              </div>
              <span className="font-medium">Map Columns</span>
            </div>
            <ArrowRight className="text-gray-400" />
            <div className={`flex items-center gap-2 ${step >= 3 ? 'text-blue-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step >= 3 ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
                3
              </div>
              <span className="font-medium">Review & {t.common.import}</span>
            </div>
            <ArrowRight className="text-gray-400" />
            <div className={`flex items-center gap-2 ${step >= 4 ? 'text-green-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step >= 4 ? 'bg-green-600 text-white' : 'bg-gray-200'}`}>
                ✓
              </div>
              <span className="font-medium">{t.common.completed}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {step === 1 && (
        <Card className="bg-white shadow-md">
          <CardHeader className="border-b">
            <CardTitle>Step 1: {t.common.upload} Your CSV File</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <Alert className="bg-blue-50 border-blue-200">
              <AlertDescription>
                <strong>💡 CSV Format Tips:</strong>
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>Save as CSV UTF-8 format in Excel</li>
                  <li>First row should be column headers</li>
                  <li>Make sure data is clean (no special characters in names)</li>
                  <li>Phone numbers can have dashes or spaces (we'll clean them)</li>
                  <li><strong>For Estimates with Line Items:</strong> Each row in your CSV should represent one line item. Multiple rows with the same "Estimate #" will be grouped into a single estimate.</li>
                </ul>
              </AlertDescription>
            </Alert>

            {entityType === 'Commission' && (
              <Alert className="bg-yellow-50 border-yellow-200">
                <AlertCircle className="w-4 h-4 text-yellow-600" />
                <AlertDescription>
                  <strong>💰 Commission Import Notes:</strong>
                  <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
                    <li>Each row represents one sales rep's commission summary</li>
                    <li><strong>Sales Rep Name</strong> must match a staff member's name exactly (or closely) in your system</li>
                    <li>Net Commission and Total Sales will be <strong>added</strong> to each rep's existing totals</li>
                    <li>Ladder Assist and other deductions will be recorded as separate deduction entries</li>
                    <li>Dollar amounts can include $ signs and commas — we'll clean them automatically</li>
                    <li>This CSV format matches the commission report export from CompanySync</li>
                  </ul>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      const csv = `Sales Rep,Total Sales,Commission Rate,Gross Commission,Total Deductions,Ladder Assist,Net Commission,Status
"John Smith","$45000.00","10%","$4500.00","-$200.00","-$200.00","$4300.00","Outstanding"
"Jane Doe","$32000.00","8%","$2560.00","-$0.00","-$0.00","$2560.00","Paid"`;
                      const blob = new Blob([csv], { type: 'text/csv' });
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'commission-import-sample.csv';
                      a.click();
                      window.URL.revokeObjectURL(url);
                    }}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Sample Commission CSV
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {entityType === 'EstimateWithLineItems' && (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <AlertDescription>
                  <strong>✅ Sample CSV Based On Your Estimate Format:</strong>
                  <div className="mt-3 space-y-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        const csv = `Estimate #,Customer Name,Status,Expiry Date,Line #,Description,Quantity,Unit,Unit Price,Tax Rate %
Estimate-1600,Edward Simmons,accepted,2025-06-07,1,Main Roof,1,EA,0.00,0
Estimate-1600,Edward Simmons,accepted,2025-06-07,2,"Tear off, haul, and dispose of comp. shingles - Laminated",13.5,SQ,72.26,0
Estimate-1600,Edward Simmons,accepted,2025-06-07,3,"Laminated - comp. shingle, rfg - w/ felt",14.9,SQ,186.00,0
Estimate-1600,Edward Simmons,accepted,2025-06-07,4,Ridge cap - Standard profile - composition shingles,99,LF,10.01,0
Estimate-1600,Edward Simmons,accepted,2025-06-07,5,Asphalt starter - universal starter course,148,LF,2.90,0
Estimate-1600,Edward Simmons,accepted,2025-06-07,6,Ice & water barrier,148,LF,3.65,0
Estimate-1600,Edward Simmons,accepted,2025-06-07,7,Roofing felt - 15 lb.,14.9,SQ,37.97,0
Estimate-1600,Edward Simmons,accepted,2025-06-07,8,Remove and replace drip edge,148,LF,2.94,0
Estimate-1600,Edward Simmons,accepted,2025-06-07,9,"Chimney flashing - small (24"" x 24"")",1,EA,234.00,0
Estimate-1600,Edward Simmons,accepted,2025-06-07,10,Roof vent - turtle type - Metal,3,EA,78.00,0
Estimate-1600,Edward Simmons,accepted,2025-06-07,11,Flashing - Pipe Jack,2,EA,87.20,0`;
                        
                        const blob = new Blob([csv], { type: 'text/csv' });
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'estimate-1600-sample.csv';
                        a.click();
                        window.URL.revokeObjectURL(url);
                      }}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download Estimate-1600 Sample CSV
                    </Button>
                    <p className="text-xs text-gray-600">
                      This CSV contains your Estimate-1600 with all 11 line items ready to import!
                    </p>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            <div>
              <Label>Select Entity Type to {t.common.import}</Label>
              <Select value={entityType} onValueChange={setEntityType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Staff">Staff Members</SelectItem>
                  <SelectItem value="Lead">Leads</SelectItem>
                  <SelectItem value="Customer">Customers</SelectItem>
                  <SelectItem value="InspectionJob">📷 CrewCam Inspection Jobs</SelectItem>
                  <SelectItem value="Task">Tasks</SelectItem>
                  <SelectItem value="Item">Items/Products</SelectItem>
                  <SelectItem value="SMSTemplate">📱 SMS Templates</SelectItem>
                  <SelectItem value="EmailTemplate">📧 Email Templates</SelectItem>
                  <SelectItem value="EstimateWithLineItems">⭐ Estimates (WITH Line Items) - RECOMMENDED</SelectItem>
                  <SelectItem value="Estimate">Estimates (Simple - no line items)</SelectItem>
                  <SelectItem value="Invoice">Invoices</SelectItem>
                  <SelectItem value="Project">Projects</SelectItem>
                  <SelectItem value="Payment">Payments</SelectItem>
                  <SelectItem value="Transaction">Accounting - Transactions</SelectItem>
                  <SelectItem value="ChartOfAccount">Accounting - Chart of Accounts</SelectItem>
                  <SelectItem value="Commission">💰 Commission Tracker (Previous Commissions)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-blue-400 transition-colors">
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
                id="csv-upload"
              />
              <label htmlFor="csv-upload" className="cursor-pointer">
                <FileSpreadsheet className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <p className="text-lg font-medium text-gray-700">
                  {file ? file.name : `Click to ${t.common.upload} CSV file`}
                </p>
                <p className="text-sm text-gray-500 mt-2">
                  CSV files only • Max 10,000 rows recommended
                </p>
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card className="bg-white shadow-md">
          <CardHeader className="border-b">
            <CardTitle>Step 2: Map CSV Columns to {entityType} Fields</CardTitle>
            <p className="text-sm text-gray-500 mt-1">
              Tell us which CSV column goes to which {entityType} field. <strong>Red fields are required!</strong>
            </p>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <Alert className="bg-green-50 border-green-200">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription>
                Found {headers.length} columns in your CSV with {previewRows.length} preview rows. We've auto-matched some columns for you - please review!
              </AlertDescription>
            </Alert>

            {entityFields[entityType].filter(f => f.required).length > 0 && (
              <Alert className="bg-blue-50 border-blue-200">
                <AlertCircle className="w-4 h-4 text-blue-600" />
                <AlertDescription>
                  <strong>⚠️ IMPORTANT:</strong> You must map the required fields (marked with *) or all rows will be skipped!
                  <br />
                  <strong>Required for {entityType}:</strong> {entityFields[entityType].filter(f => f.required).map(f => f.label).join(', ')}
                </AlertDescription>
              </Alert>
            )}
            {entityType === 'EstimateWithLineItems' && (
              <Alert className="bg-blue-50 border-blue-200">
                <AlertCircle className="w-4 h-4 text-blue-600" />
                <AlertDescription>
                  <strong>ℹ️ TIP:</strong> If your CSV doesn't have an Estimate # column, all rows will be grouped into one estimate automatically. Map <strong>Estimate #</strong> if you have multiple estimates in your CSV.
                </AlertDescription>
              </Alert>
            )}

            {(() => {
              const requiredFields = entityFields[entityType].filter(f => f.required);
              const mappedRequiredFields = requiredFields.filter(f =>
                Object.values(columnMapping).includes(f.key)
              );
              const missingRequiredFields = requiredFields.filter(f =>
                !Object.values(columnMapping).includes(f.key)
              );

              if (missingRequiredFields.length > 0) {
                return (
                  <Alert variant="destructive">
                    <AlertCircle className="w-4 h-4" />
                    <AlertDescription>
                      <strong>❌ Missing Required Fields:</strong> {missingRequiredFields.map(f => f.label).join(', ')}
                      <br />
                      <span className="text-xs">Please map these fields or the corresponding rows will be skipped!</span>
                    </AlertDescription>
                  </Alert>
                );
              } else {
                return (
                  <Alert className="bg-green-50 border-green-200">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <AlertDescription>
                      <strong>✅ All required fields are mapped!</strong> ({mappedRequiredFields.map(f => f.label).join(', ')})
                    </AlertDescription>
                  </Alert>
                );
              }
            })()}

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Your CSV Column</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Sample Data</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Maps To {entityType} Field</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((header, idx) => {
                    const mappedFieldKey = columnMapping[header];
                    const fieldInfo = entityFields[entityType].find(f => f.key === mappedFieldKey);
                    const isRequired = fieldInfo?.required;

                    return (
                      <tr key={idx} className={`border-t ${isRequired ? 'bg-red-50' : ''}`}>
                        <td className="px-4 py-3 font-medium">
                          {header}
                          {isRequired && <span className="ml-2 text-red-600 font-bold">*</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {previewRows[0]?.[header] || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <Select
                            value={mappedFieldKey || 'skip'}
                            onValueChange={(value) => {
                              setColumnMapping(prev => ({
                                ...prev,
                                [header]: value === 'skip' ? undefined : value
                              }));
                            }}
                          >
                            <SelectTrigger className={`w-full ${isRequired ? 'border-red-300' : ''}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="skip">❌ Skip this column</SelectItem>
                              {entityFields[entityType].map(field => (
                                <SelectItem key={field.key} value={field.key}>
                                  {field.label} {field.required && <span className="text-red-500">*</span>}
                                  {field.help && <span className="text-xs text-gray-500 ml-2">({field.help})</span>}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={handleReset}>
                {t.common.cancel}
              </Button>
              <Button
                onClick={() => {
                  const requiredFields = entityFields[entityType].filter(f => f.required);
                  const missingRequiredFields = requiredFields.filter(f =>
                    !Object.values(columnMapping).includes(f.key)
                  );

                  if (missingRequiredFields.length > 0) {
                    alert(`Please map these required fields before continuing:\n\n${missingRequiredFields.map(f => f.label).join('\n')}`);
                    return;
                  }

                  setStep(3);
                }}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Continue to Review
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card className="bg-white shadow-md">
          <CardHeader className="border-b">
            <CardTitle>Step 3: Review & {t.common.import}</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <Alert className="bg-yellow-50 border-yellow-200">
              <AlertCircle className="w-4 h-4 text-yellow-600" />
              <AlertDescription>
                <strong>Ready to {t.common.import}?</strong> This will create new {entityType} records. Duplicates will be skipped.
              </AlertDescription>
            </Alert>

            <div>
              <h3 className="font-semibold mb-3">Preview (First 5 rows)</h3>
              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {Object.keys(columnMapping).filter(k => columnMapping[k]).map(header => (
                        <th key={header} className="px-3 py-2 text-left font-medium text-gray-700">
                          {entityFields[entityType].find(f => f.key === columnMapping[header])?.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, idx) => (
                      <tr key={idx} className="border-t">
                        {Object.keys(columnMapping).filter(k => columnMapping[k]).map(header => (
                          <td key={header} className="px-3 py-2">
                            {row[header] || '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setStep(2)}>
                {t.common.back} to Mapping
              </Button>
              <Button
                onClick={handleImport}
                disabled={importing}
                className="bg-green-600 hover:bg-green-700"
              >
                {importing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t.common.loading}
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Start {t.common.import}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 4 && importResult && (
        <Card className="bg-white shadow-md">
          <CardHeader className="border-b">
            <CardTitle>{importResult.imported > 0 && importResult.errors === 0 ? 'Import Complete! 🎉' : (importResult.errors > 0 ? 'Import Completed with Errors' : 'Import Failed ❌')}</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            {importResult.error ? (
                 <Alert variant="destructive">
                  <XCircle className="w-4 h-4" />
                  <AlertDescription>
                    <strong>Import Failed:</strong> {importResult.error}
                  </AlertDescription>
                </Alert>
            ) : (
              <>
                <Alert className={importResult.errors > 0 ? "bg-yellow-50 border-yellow-200" : "bg-green-50 border-green-200"}>
                  {importResult.errors > 0 ? <AlertCircle className="w-4 h-4 text-yellow-600" /> : <CheckCircle2 className="w-4 h-4 text-green-600" />}
                  <AlertDescription>
                    <strong>{importResult.errors > 0 ? 'Partial Success' : 'Success!'}</strong> Your data has been processed.
                  </AlertDescription>
                </Alert>

                <div className={`grid gap-4 ${importResult.skippedDuplicates > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
                  <Card className="bg-green-50 border-green-200">
                    <CardContent className="p-4">
                      <div className="text-3xl font-bold text-green-700">{importResult.imported}</div>
                      <div className="text-sm text-green-600">Imported</div>
                    </CardContent>
                  </Card>
                  {importResult.skippedDuplicates > 0 && (
                    <Card className="bg-blue-50 border-blue-200">
                      <CardContent className="p-4">
                        <div className="text-3xl font-bold text-blue-700">{importResult.skippedDuplicates}</div>
                        <div className="text-sm text-blue-600">Already Exists</div>
                      </CardContent>
                    </Card>
                  )}
                  <Card className="bg-yellow-50 border-yellow-200">
                    <CardContent className="p-4">
                      <div className="text-3xl font-bold text-yellow-700">{importResult.skipped}</div>
                      <div className="text-sm text-yellow-600">Skipped (Required Fields)</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-red-50 border-red-200">
                    <CardContent className="p-4">
                      <div className="text-3xl font-bold text-red-700">{importResult.errors}</div>
                      <div className="text-sm text-red-600">Errors</div>
                    </CardContent>
                  </Card>
                </div>
              </>
            )}

            {errorDetails && errorDetails.length > 0 && (
              <Card className="bg-red-50 border-red-200">
                <CardHeader>
                  <CardTitle className="text-red-900">Error Details ({errorDetails.length} rows failed)</CardTitle>
                </CardHeader>
                <CardContent className="max-h-96 overflow-y-auto">
                  <div className="space-y-2">
                    {errorDetails.slice(0, 100).map((error, idx) => (
                      <div key={idx} className="p-3 bg-white rounded border text-sm">
                        <div className="font-semibold text-red-800">Row {typeof error.row === 'number' ? error.row : String(error.row)}: <span className="font-normal text-red-700">{error.reason}</span></div>
                        {error.data && (
                          <div className="text-xs text-gray-600 mt-1 bg-gray-50 p-2 rounded">
                            Data: {JSON.stringify(error.data)}
                          </div>
                        )}
                      </div>
                    ))}
                    {errorDetails.length > 100 && (
                      <div className="text-sm text-red-700 text-center py-2">
                        ... and {errorDetails.length - 100} more errors
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex justify-end gap-3">
                <Button onClick={handleReset} variant="outline">
                   {t.common.import} Another File
                </Button>
                <Button onClick={() => window.location.href = '/'}>
                   Go to {t.sidebar.dashboard}
                </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mt-12">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Loader2 className="h-5 w-5 text-gray-400" />
            Recent {t.common.import}s
        </h2>
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
            <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                    <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">{t.common.date}</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">File {t.common.name}</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">{t.calendar.type}</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Rows</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Imported</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">Errors</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">{t.common.status}</th>
                    </tr>
                </thead>
                <tbody className="divide-y">
                    {importLogs.length > 0 ? (
                        importLogs.map(log => (
                            <tr key={log.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-gray-500">{new Date(log.created_date).toLocaleString()}</td>
                                <td className="px-4 py-3 font-medium">{log.file_name}</td>
                                <td className="px-4 py-3 text-gray-600">{log.entity_type}</td>
                                <td className="px-4 py-3">{log.total_rows}</td>
                                <td className="px-4 py-3 text-green-600 font-medium">{log.imported_count}</td>
                                <td className="px-4 py-3 text-red-600">{log.error_count}</td>
                                <td className="px-4 py-3">
                                    <Badge variant={log.status === 'completed' ? 'success' : 'outline'} className={log.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}>
                                        {log.status?.replace('_', ' ')}
                                    </Badge>
                                </td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan="7" className="px-4 py-8 text-center text-gray-400">No {t.common.import} history found.</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
      </div>
    </div>
  );
}