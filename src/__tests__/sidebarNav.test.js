import { describe, expect, it } from "vitest";
import { applyEditorToLegacyMenu, applyNodeOrder, applySavedMenuToEditor, buildSidebarEditorTree, buildSidebarModel, captureSidebarOrder, collectVisibleSources } from "@/lib/sidebarNav";

function fullNavigation() {
  return [
    { id: "dashboard" },
    {
      id: "ai-tools",
      submenu: [
        { id: "ai-estimator" },
        { id: "lexi" },
        { id: "lexi-memory" },
        { id: "permit-assistant" },
        { id: "daily-reports" },
        { id: "ai-staff" },
        { id: "ai-training" },
        { id: "video-training" },
      ],
    },
    {
      id: "lead-manager",
      submenu: [
        { id: "all-leads" },
        { id: "lead-finder" },
        { id: "storm-tracking" },
      ],
    },
    {
      id: "sales",
      submenu: [
        { id: "customers" },
        { id: "sales-dashboard" },
        { id: "estimates" },
        { id: "proposals" },
        { id: "invoices" },
        { id: "payments" },
        { id: "items" },
        { id: "commissions" },
        { id: "family-commissions" },
      ],
    },
    {
      id: "accounting",
      submenu: [
        { id: "accounting-setup" },
        { id: "accounting-dashboard" },
        { id: "bills" },
        { id: "transactions" },
        { id: "journal-entry" },
        { id: "transfer" },
        { id: "chart-of-accounts" },
        { id: "reconcile" },
        { id: "reports" },
        { id: "expenses" },
        { id: "payouts" },
        { id: "mapping-rules" },
      ],
    },
    {
      id: "field-operations",
      submenu: [
        { id: "field-sales-tracker" },
        { id: "field-rep-app" },
        { id: "territory-manager" },
        { id: "build-schedule" },
      ],
    },
    {
      id: "operations",
      submenu: [
        { id: "crewcam-dashboard" },
        { id: "new-crewcam" },
        { id: "crewcam-capture" },
        { id: "ai-damage" },
        { id: "subcontractors" },
        { id: "tasks" },
        { id: "review-requests" },
        { id: "reminders" },
        { id: "projects" },
        { id: "activity" },
      ],
    },
    { id: "smart-glasses" },
    { id: "calendar" },
    {
      id: "communication",
      submenu: [
        { id: "live-call-dashboard" },
        { id: "communication-hub" },
        { id: "campaigns" },
        { id: "ad-builder" },
        { id: "workflow-automation" },
        { id: "ai-dashboard" },
        { id: "mailbox" },
        { id: "messages" },
        { id: "zoom" },
      ],
    },
    {
      id: "documents",
      submenu: [
        { id: "all-documents" },
        { id: "contracts" },
        { id: "contract-templates" },
        { id: "contract-signing" },
      ],
    },
    {
      id: "reports",
      submenu: [
        { id: "analytics-dashboard" },
        { id: "report-builder" },
        { id: "sales-reports" },
        { id: "competitor-analysis" },
      ],
    },
    { id: "map" },
    { id: "knowledge-base" },
    { id: "subscription" },
    { id: "feature-comparison" },
    { id: "coming-soon" },
  ];
}

const settingsItems = [
  { id: "saas-admin" },
  { id: "platform-menu-restrictions" },
  { id: "billing-api-keys" },
  { id: "backup-manager" },
  { id: "cleanup-restart" },
  { id: "feature-comparison" },
  { id: "quick-setup" },
  { id: "launch-checklist" },
  { id: "general-settings" },
  { id: "company-setup" },
  { id: "stripe-connect" },
  { id: "pdf-branding" },
  { id: "report-templates" },
  { id: "staff-management" },
  { id: "roles-management" },
  { id: "round-robin" },
  { id: "templates" },
  { id: "data-import" },
  { id: "property-importer" },
  { id: "utilities" },
  { id: "one-click-repair" },
  { id: "custom-fields" },
  { id: "menu-setup" },
  { id: "email-templates" },
  { id: "sms-templates" },
  { id: "api-keys" },
  { id: "integration-manager" },
  { id: "google-chat" },
  { id: "slack" },
];

function labels(nodes, acc = []) {
  for (const node of nodes) {
    if (node.items) labels(node.items, acc);
    else acc.push(node.label);
  }
  return acc;
}

describe("sidebar model", () => {
  const sources = collectVisibleSources(fullNavigation(), settingsItems);
  const model = buildSidebarModel({
    visibleSources: sources,
    canOpenSettings: true,
    isPlatformStaff: true,
  });

  it("sends Home to the dashboard", () => {
    const home = model.sections.find((section) => section.id === "home");
    expect(home.url).toBe("/Dashboard");
  });

  it("uses the nine job-order sections", () => {
    expect(model.sections.map((section) => section.label)).toEqual([
      "Home",
      "Leads & Storms",
      "Customers & Jobs",
      "Inspections & Photos",
      "Estimates & Contracts",
      "Production / Crew Schedule",
      "Invoices & Money",
      "Messages & Marketing",
      "Automations & AI",
    ]);
  });

  it("keeps one Storm Tracker and the renamed daily tools", () => {
    const storm = model.pages.filter((page) => page.url === "/StormTracking");
    expect(storm).toHaveLength(1);
    expect(storm[0].label).toBe("Storm Tracker");
    expect(labels(model.sections)).toEqual(expect.arrayContaining([
      "My Work" in labels(model.sections) ? "My Work" : "Tasks",
      "Jobs",
      "Inspections",
      "+ New Inspection",
      "Take Photos",
      "Install Schedule",
      "Payments Received",
      "Inbox",
      "Ask Lexi",
    ]));
    expect(labels(model.sections)).not.toContain("My Work");
  });

  it("moves plan, roadmap, and competitor analysis out of the daily sections", () => {
    const sectionLabels = labels(model.sections);
    expect(sectionLabels).not.toContain("Plan & Billing");
    expect(sectionLabels).not.toContain("Compare Plans");
    expect(sectionLabels).not.toContain("What's Coming");
    expect(sectionLabels).not.toContain("Competitor Analysis");
    expect(model.account.map((item) => item.label)).toEqual(["Plan & Billing", "Compare Plans"]);
    expect(labels(model.footer)).toEqual(expect.arrayContaining(["What's Coming", "Training Videos", "Help Articles"]));
    const platform = model.settingsGroups.find((group) => group.id === "settings-platform");
    expect(labels(platform.items)).toContain("Competitor Analysis");
  });

  it("does not invent pages that have no route", () => {
    const all = model.pages.map((page) => page.label);
    expect(all).not.toContain("Route Planner");
    expect(all).not.toContain("Marketing Videos");
    expect(all).not.toContain("Insurance Claim Audit");
    expect(all).not.toContain("My Work");
  });

  it("keeps accounting reports distinct from the reports section", () => {
    const financial = model.pages.find((page) => page.label === "Financial Reports");
    const sales = model.pages.find((page) => page.label === "Sales Reports");
    expect(financial.url).toBe("/AccountingReports");
    expect(sales.url).toBe("/Reports?category=sales");
  });

  it("hides plan-gated groups when their legacy ids are absent", () => {
    const basicNav = fullNavigation().filter((item) => !["field-operations", "accounting", "reports"].includes(item.id));
    const basic = buildSidebarModel({
      visibleSources: collectVisibleSources(basicNav, settingsItems.filter((item) => item.id !== "saas-admin")),
      canOpenSettings: true,
      isPlatformStaff: false,
    });
    const names = labels([...basic.sections, ...basic.footer, ...basic.settingsGroups]);
    expect(names).not.toContain("Install Schedule");
    expect(names).not.toContain("Financial Reports");
    expect(names).not.toContain("Business Overview");
    expect(names).not.toContain("Competitor Analysis");
    expect(names).toContain("Invoices");
    expect(names).toContain("Sales Performance");
  });

  it("shows the job sidebar on the menu editor instead of the old groups", () => {
    const tree = buildSidebarEditorTree();
    expect(tree.map((section) => section.title)).toEqual([
      "Home",
      "Leads & Storms",
      "Customers & Jobs",
      "Inspections & Photos",
      "Estimates & Contracts",
      "Production / Crew Schedule",
      "Invoices & Money",
      "Messages & Marketing",
      "Automations & AI",
      "Reports",
      "Help & Training",
    ]);
    expect(tree[0].items.map((item) => item.title)).toEqual([
      "Dashboard",
      "Calendar",
      "Tasks",
      "Reminders",
      "Team Activity",
    ]);
    expect(JSON.stringify(tree)).not.toContain("AI Tools");
    expect(JSON.stringify(tree)).not.toContain("Lead Manager");

    const hidden = applySavedMenuToEditor(tree, [
      { id: "lead-manager", enabled: true, submenuItems: [{ id: "storm-tracking", enabled: false }] },
    ]);
    const leads = hidden.find((section) => section.id === "leads");
    const storm = leads.items.find((item) => item.source === "lead-manager/storm-tracking");
    expect(storm.enabled).toBe(false);

    const legacy = applyEditorToLegacyMenu(
      [{ id: "lead-manager", title: "Lead Manager", enabled: true, hasSubmenu: true, submenuItems: [{ id: "storm-tracking", title: "Storm Tracking", enabled: true }, { id: "all-leads", title: "All Leads", enabled: true }] }],
      hidden
    );
    expect(legacy[0].submenuItems.find((item) => item.id === "storm-tracking").enabled).toBe(false);
    expect(legacy[0].submenuItems.find((item) => item.id === "all-leads").enabled).toBe(true);
  });

  it("reorders sidebar sections from the menu editor handles", () => {
    const tree = buildSidebarEditorTree();
    const moved = applyNodeOrder(tree, [
      { id: "leads" },
      { id: "home" },
    ]);
    expect(moved.slice(0, 2).map((section) => section.id)).toEqual(["leads", "home"]);
    const saved = applySavedMenuToEditor(buildSidebarEditorTree(), [], captureSidebarOrder(moved));
    expect(saved[0].id).toBe("leads");
    const model = buildSidebarModel({
      visibleSources: sources,
      canOpenSettings: true,
      isPlatformStaff: true,
      sidebarOrder: captureSidebarOrder(moved),
    });
    expect(model.sections[0].id).toBe("leads");
    expect(model.sections[1].id).toBe("home");
  });

  it("indexes old names in search text", () => {
    const inspections = model.pages.find((page) => page.label === "Inspections");
    expect(inspections.synonyms.join(" ")).toMatch(/PhotoSync/);
    expect(inspections.tooltip).toMatch(/photo reports/i);
  });
});
