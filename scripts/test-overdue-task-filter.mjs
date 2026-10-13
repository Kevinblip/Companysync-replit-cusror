#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { isActiveTask } from "../src/utils/taskStatus.js";

const tasksPage = fs.readFileSync("src/pages/Tasks.jsx", "utf8");
const overdueBranchStart = tasksPage.indexOf("if (activeFilter === 'overdue')");
const overdueBranchEnd = tasksPage.indexOf("} else if (activeFilter === 'unassigned')", overdueBranchStart);
assert.ok(overdueBranchStart >= 0, "the overdue route branch must exist");
assert.ok(overdueBranchEnd > overdueBranchStart, "the overdue route branch must be bounded");
assert.match(
  tasksPage.slice(overdueBranchStart, overdueBranchEnd),
  /isActiveTask\(task\)/,
  "the overdue route must apply the active-task guard before checking the due date"
);

const openStatuses = ["todo", "not_started", "in_progress", "pending", "open", "active"];
for (const status of openStatuses) {
  assert.equal(
    isActiveTask({ status, due_date: "2020-01-01" }),
    true,
    `${status} should remain eligible for overdue filtering`
  );
}

const terminalStatuses = [
  "Complete",
  "Complete ",
  "complete (archived)",
  "completed",
  "done",
  "Job Completed/Archive",
  "Job Completed / Archive",
  "completed archive",
  "job_completed",
  "archived",
  "closed",
];
for (const status of terminalStatuses) {
  assert.equal(
    isActiveTask({ status, due_date: "2020-01-01" }),
    false,
    `${status} must be excluded from overdue filtering`
  );
}

assert.equal(
  isActiveTask({ status: "in_progress", column: "Job Completed/Archive", due_date: "2020-01-01" }),
  false,
  "a terminal archive column must be excluded even when status is active"
);
assert.equal(
  isActiveTask({ status: "in_progress", is_archived: true, due_date: "2020-01-01" }),
  false,
  "archived tasks must be excluded"
);

console.log("PASS: overdue task filtering only admits active, non-archived tasks");