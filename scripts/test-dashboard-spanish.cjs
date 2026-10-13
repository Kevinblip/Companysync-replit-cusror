const assert = require("node:assert/strict");
const fs = require("node:fs");

async function main() {
  const { default: translations } = await import("../src/utils/translations.js");
  const dashboardSource = fs.readFileSync("src/pages/Dashboard.jsx", "utf8");
  const layoutSource = fs.readFileSync("src/Layout.jsx", "utf8");

  const requiredDashboardKeys = [
    "welcomeBack", "allYears", "taskHealthMonitor", "workflowMonitor",
    "pendingInstallsRepairs", "noBuildsScheduled", "dayEvents",
    "noEventsForDay", "invalidDate", "invalidTime", "addNewEvent",
    "editEvent", "createEvent", "updateEvent", "myPendingCommission",
  ];
  const requiredSidebarKeys = [
    "myAssignments", "repPerformance", "mappingRules", "routePlanner",
    "buildSchedule", "workOrders", "laborRates", "leaderboard", "teamChat",
  ];

  for (const key of requiredDashboardKeys) {
    assert.equal(typeof translations.en.dashboard[key], typeof translations.es.dashboard[key], `dashboard key parity: ${key}`);
  }
  for (const key of requiredSidebarKeys) {
    assert.equal(typeof translations.en.sidebar[key], typeof translations.es.sidebar[key], `sidebar key parity: ${key}`);
  }
  assert.equal(translations.en.dashboard.welcomeBack, "Welcome back");
  assert.equal(translations.es.dashboard.welcomeBack, "Bienvenido de nuevo");
  assert.equal(translations.en.dashboard.invoicesCount(2), "2 invoices");
  assert.equal(translations.es.dashboard.invoicesCount(2), "2 facturas");
  assert.equal(translations.en.dashboard.invoicesCount(1), "1 invoice");
  assert.equal(translations.es.dashboard.invoicesCount(1), "1 factura");

  for (const literal of [
    "All Years", "Task Health Monitor", "Workflow Monitor",
    "Day Events", "No events for this day.", "Invalid Date",
    "Invalid Time", "Add New Event", "Edit Event", "Update Event",
    "Create Event", "My Pending Commission",
  ]) {
    assert.equal(dashboardSource.includes(`>${literal}<`), false, `hardcoded dashboard label remains: ${literal}`);
  }
  assert.equal(layoutSource.includes("title: 'My Assignments'"), false);
  assert.equal(layoutSource.includes("title: 'Rep Performance'"), false);

  console.log("Dashboard Spanish translation coverage checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});