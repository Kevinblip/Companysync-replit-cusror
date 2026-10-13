import { isActiveTask } from "@/utils/taskStatus";
import { parseDateOnly } from "@/utils/localDate";
import { base44 } from "@/api/base44Client";

export async function fetchAssignmentRecords(companyId, entityType) {
  const response = await base44.functions.invoke("getAssignmentRecords", { companyId, entityType });
  if (!response?.data?.success) throw new Error(response?.data?.error || "Could not load assignments");
  const records = response.data.records || [];
  records.isTruncated = response.data.truncated === true;
  return records;
}

const asStrings = value => Array.isArray(value) ? value : (value ? String(value).split(",") : []);
const normalized = value => String(value || "").trim().toLowerCase();

export function assignmentMatches(record, identity = {}) {
  const emails = [record?.assigned_to, record?.assigned_to_email, record?.assigned_to_users,
    ...(Array.isArray(record?.assignees) ? record.assignees.flatMap(a => [a?.email, a?.user_email]) : []),
    ...(Array.isArray(record?.team_members) ? record.team_members.flatMap(a => typeof a === "object" ? [a.email, a.user_email] : [a]) : [])]
    .flatMap(asStrings).map(normalized);
  const names = [record?.assigned_to, record?.assigned_to_name, record?.assigned_to_users,
    ...(Array.isArray(record?.assignees) ? record.assignees.map(a => a?.name) : []),
    ...(Array.isArray(record?.team_members) ? record.team_members.map(a => typeof a === "object" ? a.name : null) : [])]
    .flatMap(asStrings).map(normalized);
  return (!!identity.email && emails.includes(normalized(identity.email))) ||
    (!!identity.name && names.includes(normalized(identity.name)));
}

export function hasNoAssignment(record) {
  return !assignmentMatches(record, { email: "__none__", name: "__none__" }) &&
    ![record?.assigned_to, record?.assigned_to_email, record?.assigned_to_name, record?.assigned_to_users, record?.assignees, record?.team_members]
      .some(v => Array.isArray(v) ? v.length > 0 : !!String(v || "").trim());
}

export function dateUrgency(value, now = new Date()) {
  const due = parseDateOnly(value);
  if (!due) return "upcoming";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  if (dueDay.getTime() === today.getTime()) return "today";
  if (dueDay < today) return "overdue";
  return "upcoming";
}

export function actionableTask(task) {
  return isActiveTask(task) && !task?.is_deleted;
}

export function assignmentOwnerPatch(email, name) {
  const owners = {
    assigned_to: email || null,
    assigned_to_email: email || null,
    assigned_to_name: name || null,
    assigned_to_users: email ? [email] : [],
    assignees: email ? [{ email, name: name || "" }] : [],
    team_members: email ? [email] : [],
  };
  return { ...owners, data: { ...owners } };
}

export function taskOwnershipPatch(assignees = []) {
  const unique = [...new Map(assignees.filter(a => a?.email).map(a =>
    [normalized(a.email), { ...a, email: normalized(a.email) }])).values()];
  const owners = {
    assignees: unique,
    assigned_to: unique[0]?.email || "",
    assigned_to_email: unique[0]?.email || "",
    assigned_to_name: unique[0]?.name || "",
    assigned_to_avatar: unique[0]?.avatar || "",
    assigned_to_users: unique.map(a => a.email),
    team_members: unique.map(a => a.email),
  };
  return { ...owners, data: { ...owners } };
}

export function matchesEmployeeScope(record, scope, user, staffProfiles = []) {
  if (scope === "all") return true;
  if (scope === "unassigned") return hasNoAssignment(record);
  const profile = staffProfiles.find(p => p.user_email === scope);
  const ownProfile = staffProfiles.find(p => normalized(p.user_email || p.email) === normalized(user?.email));
  return assignmentMatches(record, {
    email: scope === "mine" ? user?.email : scope,
    name: scope === "mine" ? ownProfile?.full_name : profile?.full_name,
  });
}
