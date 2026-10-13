'use strict';
const { createPool } = require('./lib/db-pool.cjs');
const crypto = require('crypto');
const pool = createPool({ connectionString: process.env.DATABASE_URL });

const MASTER_ID = '695944e3c1fb00b7ab716c6f';

const REPORT_TEMPLATES = [
  {
    template_name: 'Standard Insurance Inspection',
    insurance_carrier: 'Multi-Carrier',
    description: 'Full insurance claim report: cover page, property details, damage assessment, photos by section, Xactimate estimate, storm data, and inspector certification.',
    layout_style: 'standard',
    photo_layout: '2_per_page',
    estimate_format: 'line_items_table',
    include_sections: {
      cover_page: true,
      executive_summary: false,
      property_details: true,
      damage_assessment: true,
      photos_by_section: true,
      xactimate_estimate: true,
      storm_data: true,
      inspector_certification: true,
      recommendations: false,
    },
    show_photo_captions: true,
    branding: { show_company_logo: true, primary_color: '#2563eb', header_text: '', footer_text: '' },
    is_default: true,
    is_active: true,
  },
  {
    template_name: 'State Farm Report',
    insurance_carrier: 'State Farm',
    description: 'State Farm preferred format with Age/Life depreciation table, O&P breakdown, and adjuster sign-off section.',
    layout_style: 'state_farm',
    photo_layout: '2_per_page',
    estimate_format: 'line_items_table',
    include_sections: {
      cover_page: true,
      executive_summary: false,
      property_details: true,
      damage_assessment: true,
      photos_by_section: true,
      xactimate_estimate: true,
      storm_data: true,
      inspector_certification: true,
      recommendations: false,
    },
    show_photo_captions: true,
    branding: { show_company_logo: true, primary_color: '#dc2626', header_text: 'State Farm Preferred Contractor', footer_text: 'All work meets State Farm guidelines.' },
    is_default: false,
    is_active: true,
  },
  {
    template_name: 'Retail / Cash Bid Report',
    insurance_carrier: '',
    description: 'Clean homeowner-facing report with no insurance fields. Shows property details, damage photos, and a straightforward line-item estimate.',
    layout_style: 'retail',
    photo_layout: '2_per_page',
    estimate_format: 'line_items_table',
    include_sections: {
      cover_page: true,
      executive_summary: false,
      property_details: true,
      damage_assessment: true,
      photos_by_section: true,
      xactimate_estimate: false,
      storm_data: false,
      inspector_certification: false,
      recommendations: true,
    },
    show_photo_captions: true,
    branding: { show_company_logo: true, primary_color: '#16a34a', header_text: '', footer_text: '' },
    is_default: false,
    is_active: true,
  },
  {
    template_name: 'Executive Summary Report',
    insurance_carrier: 'Multi-Carrier',
    description: 'Brief executive summary for adjusters: cover, summary paragraph, key damage findings, and total estimate — no per-photo detail.',
    layout_style: 'summary',
    photo_layout: '4_per_page',
    estimate_format: 'summary_totals',
    include_sections: {
      cover_page: true,
      executive_summary: true,
      property_details: true,
      damage_assessment: true,
      photos_by_section: false,
      xactimate_estimate: true,
      storm_data: true,
      inspector_certification: true,
      recommendations: false,
    },
    show_photo_captions: false,
    branding: { show_company_logo: true, primary_color: '#7c3aed', header_text: '', footer_text: '' },
    is_default: false,
    is_active: true,
  },
  {
    template_name: 'Allstate / Farmers Report',
    insurance_carrier: 'Allstate',
    description: 'Compatible with Allstate and Farmers formats. Includes depreciation schedule, O&P, recoverable depreciation, and claim number fields.',
    layout_style: 'standard',
    photo_layout: '2_per_page',
    estimate_format: 'line_items_table',
    include_sections: {
      cover_page: true,
      executive_summary: false,
      property_details: true,
      damage_assessment: true,
      photos_by_section: true,
      xactimate_estimate: true,
      storm_data: true,
      inspector_certification: true,
      recommendations: false,
    },
    show_photo_captions: true,
    branding: { show_company_logo: true, primary_color: '#0284c7', header_text: '', footer_text: 'Licensed & Insured. All estimates subject to carrier approval.' },
    is_default: false,
    is_active: true,
  },
];

async function seed() {
  const { rows: existing } = await pool.query(
    `SELECT data->>'template_name' AS name FROM generic_entities WHERE entity_type='InspectionReportTemplate' AND company_id=$1`,
    [MASTER_ID]
  );
  const existingNames = new Set(existing.map(r => r.name));

  let added = 0;
  for (const t of REPORT_TEMPLATES) {
    if (!existingNames.has(t.template_name)) {
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'InspectionReportTemplate', $2, $3::jsonb, NOW(), NOW())`,
        [crypto.randomUUID(), MASTER_ID, JSON.stringify(t)]
      );
      added++;
    }
  }
  console.log(`Report templates added: ${added}`);
  await pool.end();
}

seed().catch(e => { console.error(e.message); process.exit(1); });
