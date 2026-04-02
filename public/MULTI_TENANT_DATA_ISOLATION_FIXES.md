# CRITICAL: Multi-Tenant Data Isolation Fixes

## Summary

There are **130+ entity queries** across **40+ pages** that use `.list()` or `.filter()` **without company_id filtering**. This means any user with multiple companies (or admin impersonation) will see **all companies' data mixed together** — customers, invoices, leads, estimates, payments, and more.

## The Fix Pattern

Every `.list()` and `.filter()` call that fetches tenant-specific data must include `company_id` in the filter. The `useCurrentCompany` hook (at `src/components/hooks/useCurrentCompany.jsx`) is the single source of truth for resolving the active company.

### Before (BROKEN):
```js
queryFn: () => base44.entities.Customer.list("-created_date", 10000)
```

### After (FIXED):
```js
queryFn: () => myCompany 
  ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_date", 10000) 
  : []
```

### Setup in each page:
```js
import useCurrentCompany from "@/components/hooks/useCurrentCompany";

// Inside the component:
const { company: myCompany } = useCurrentCompany(user);

// Then in every useQuery:
queryKey: ['customers', myCompany?.id],  // include company id in cache key
queryFn: () => myCompany 
  ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_date", 10000) 
  : [],
enabled: !!myCompany,
```

---

## Pages Requiring Fixes (Grouped by Severity)

### CRITICAL — Financial / Sensitive Data Leaking

#### 1. Analytics.jsx (6 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 56 | `Invoice.list("-created_date", 10000)` | `Invoice.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 62 | `Lead.list("-created_date", 10000)` | `Lead.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 68 | `Customer.list("-created_date", 10000)` | `Customer.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 74 | `Estimate.list("-created_date", 10000)` | `Estimate.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 80 | `Payment.list("-payment_date", 10000)` | `Payment.filter({ company_id: myCompany.id }, "-payment_date", 10000)` |
| 92 | `RevenueGoal.list()` | `RevenueGoal.filter({ company_id: myCompany.id })` |

#### 2. ReportBuilder.jsx (7 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 115 | `SavedReport.list("-created_date")` | `SavedReport.filter({ company_id: myCompany.id }, "-created_date")` |
| 121 | `Invoice.list("-created_date", 10000)` | `Invoice.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 135 | `Customer.list("-created_date", 10000)` | `Customer.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 142 | `Estimate.list("-created_date", 10000)` | `Estimate.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 160 | `Payment.list("-payment_date", 10000)` | `Payment.filter({ company_id: myCompany.id }, "-payment_date", 10000)` |
| 178 | `Customer.list("-created_date", 10000)` | `Customer.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 194 | `Lead.list("-created_date", 10000)` | `Lead.filter({ company_id: myCompany.id }, "-created_date", 10000)` |

#### 3. Reports.jsx (11 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 73 | `Invoice.list("-created_date", 10000)` | `Invoice.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 79 | `Estimate.list("-created_date", 10000)` | `Estimate.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 85 | `Proposal.list("-created_date", 10000)` | `Proposal.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 91 | `Payment.list("-payment_date", 10000)` | `Payment.filter({ company_id: myCompany.id }, "-payment_date", 10000)` |
| 97 | `Customer.list("-created_date", 10000)` | `Customer.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 103 | `Item.list("-created_date", 10000)` | `Item.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 109 | `Lead.list("-created_date", 10000)` | `Lead.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 121 | `FamilyMember.list("-created_date", 10000)` | `FamilyMember.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 127 | `FamilyCommissionRecord.list("-created_date", 10000)` | `FamilyCommissionRecord.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 133 | `CommissionDeduction.list("-created_date", 10000)` | `CommissionDeduction.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 139 | `CommissionPayment.list("-created_date", 10000)` | `CommissionPayment.filter({ company_id: myCompany.id }, "-created_date", 10000)` |

#### 4. SalesDashboard.jsx (7 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 50 | `Payment.list("-payment_date", 10000)` | `Payment.filter({ company_id: myCompany.id }, "-payment_date", 10000)` |
| 56 | `Lead.list("-created_date", 10000)` | `Lead.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 62 | `Invoice.list("-created_date", 10000)` | `Invoice.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 68 | `Estimate.list("-created_date", 10000)` | `Estimate.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 74 | `Customer.list("-created_date", 10000)` | `Customer.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 80 | `Communication.list("-created_date", 1000)` | `Communication.filter({ company_id: myCompany.id }, "-created_date", 1000)` |
| 86 | `LeadScore.list("-total_score", 500)` | `LeadScore.filter({ company_id: myCompany.id }, "-total_score", 500)` |

#### 5. CommissionReport.jsx (3 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 102 | `Invoice.list("-created_date", 10000)` | `Invoice.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 108 | `Customer.list("-created_date", 10000)` | `Customer.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 114 | `Payment.list("-created_date", 10000)` | `Payment.filter({ company_id: myCompany.id }, "-created_date", 10000)` |

#### 6. CommissionTracking.jsx (1 unfiltered query)
| Line | Current Code | Fix |
|------|-------------|-----|
| 81 | `Invoice.list("-created_date", 10000)` | `Invoice.filter({ company_id: myCompany.id }, "-created_date", 10000)` |

#### 7. AccountingReports.jsx (3 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 58 | `Invoice.list()` | `Invoice.filter({ company_id: myCompany.id })` |
| 64 | `Payment.list()` | `Payment.filter({ company_id: myCompany.id })` |
| 70 | `Expense.list()` | `Expense.filter({ company_id: myCompany.id })` |

#### 8. AccountsReceivableReport.jsx (1 unfiltered query)
| Line | Current Code | Fix |
|------|-------------|-----|
| 18 | `Invoice.list("-issue_date", 1000)` | `Invoice.filter({ company_id: myCompany.id }, "-issue_date", 1000)` |

#### 9. Utilities.jsx (4 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 89 | `Customer.list("-created_date", 10000)` | `Customer.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 95 | `Invoice.list("-created_date", 10000)` | `Invoice.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 101 | `Payment.list("-created_date", 10000)` | `Payment.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 929 | `Payment.list('-created_date', 10000)` | `Payment.filter({ company_id: myCompany.id }, '-created_date', 10000)` |

#### 10. invoice-details.jsx (2 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 357 | `Payment.list('-created_date', 1000)` | `Payment.filter({ company_id: myCompany.id }, '-created_date', 1000)` |
| 459 | `Payment.list('-created_date', 1000)` | `Payment.filter({ company_id: myCompany.id }, '-created_date', 1000)` |

---

### HIGH — Customer/Lead/Job Data Leaking

#### 11. Calendar.jsx (3 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 335 | `Customer.list('-created_date', 500)` | `Customer.filter({ company_id: myCompany.id }, '-created_date', 500)` |
| 341 | `Lead.list('-created_date', 500)` | `Lead.filter({ company_id: myCompany.id }, '-created_date', 500)` |
| 356 | `Invoice.list('-created_date', 10000)` | `Invoice.filter({ company_id: myCompany.id }, '-created_date', 10000)` |

#### 12. SalesTracking.jsx (2 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 66 | `Lead.list("-created_date")` | `Lead.filter({ company_id: myCompany.id }, "-created_date")` |
| 72 | `Invoice.list("-created_date")` | `Invoice.filter({ company_id: myCompany.id }, "-created_date")` |

#### 13. Campaigns.jsx (5 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 108 | `Lead.list("-created_date", 5000)` | `Lead.filter({ company_id: myCompany.id }, "-created_date", 5000)` |
| 114 | `Customer.list("-created_date", 5000)` | `Customer.filter({ company_id: myCompany.id }, "-created_date", 5000)` |
| 120 | `EmailTemplate.list()` | `EmailTemplate.filter({ company_id: myCompany.id })` |
| 126 | `SMSTemplate.list()` | `SMSTemplate.filter({ company_id: myCompany.id })` |
| 132 | `Workflow.list()` | `Workflow.filter({ company_id: myCompany.id })` |

#### 14. ContractTemplates.jsx (2 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 127 | `Customer.list('-created_date', 1000)` | `Customer.filter({ company_id: myCompany.id }, '-created_date', 1000)` |
| 133 | `Lead.list('-created_date', 1000)` | `Lead.filter({ company_id: myCompany.id }, '-created_date', 1000)` |

#### 15. ContractSigning.jsx (5 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 58 | `ContractSigningSession.list("-created_date", 500)` | `ContractSigningSession.filter({ company_id: myCompany.id }, "-created_date", 500)` |
| 64 | `Customer.list("-created_date", 500)` | `Customer.filter({ company_id: myCompany.id }, "-created_date", 500)` |
| 70 | `Estimate.list("-created_date", 500)` | `Estimate.filter({ company_id: myCompany.id }, "-created_date", 500)` |
| 76 | `Contract.list("-created_date", 500)` | `Contract.filter({ company_id: myCompany.id }, "-created_date", 500)` |
| 118 | `ContractSigningSession.list('-created_date', 1000)` | `ContractSigningSession.filter({ company_id: myCompany.id }, '-created_date', 1000)` |

#### 16. Documents.jsx (3 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 110 | `Document.list("-created_date")` | `Document.filter({ company_id: myCompany.id }, "-created_date")` |
| 116 | `Customer.list()` | `Customer.filter({ company_id: myCompany.id })` |
| 122 | `Project.list()` | `Project.filter({ company_id: myCompany.id })` |

#### 17. Proposals.jsx (2 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 131 | `Customer.list()` | `Customer.filter({ company_id: myCompany.id })` |
| 137 | `Proposal.list("-created_date")` | `Proposal.filter({ company_id: myCompany.id }, "-created_date")` |

#### 18. SignContractRep.jsx (2 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 84 | `Customer.list('-created_date', 1000)` | `Customer.filter({ company_id: myCompany.id }, '-created_date', 1000)` |
| 90 | `Lead.list('-created_date', 1000)` | `Lead.filter({ company_id: myCompany.id }, '-created_date', 1000)` |

#### 19. CustomerProfile.jsx (4 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 270 | `Estimate.list('-created_date', 200)` | `Estimate.filter({ company_id: myCompany.id }, '-created_date', 200)` |
| 335 | `Payout.list("-created_date", 10000)` | `Payout.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 377 | `TaskBoard.list("-created_date")` | `TaskBoard.filter({ company_id: myCompany.id }, "-created_date")` |
| 762 | `Payment.list('-created_date', 10000)` | `Payment.filter({ company_id: myCompany.id }, '-created_date', 10000)` |

#### 20. customer-profile.jsx (lowercase, 1 unfiltered query)
| Line | Current Code | Fix |
|------|-------------|-----|
| 80 | `Customer.list()` | `Customer.filter({ company_id: myCompany.id })` |

#### 21. Payouts.jsx (1 unfiltered query)
| Line | Current Code | Fix |
|------|-------------|-----|
| 89 | `Customer.list("-created_date", 10000)` | `Customer.filter({ company_id: myCompany.id }, "-created_date", 10000)` |

#### 22. Expenses.jsx (1 unfiltered query)
| Line | Current Code | Fix |
|------|-------------|-----|
| 114 | `Customer.list()` | `Customer.filter({ company_id: myCompany.id })` |

#### 23. ManageSubscription.jsx (2 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 43 | `Customer.list()` | `Customer.filter({ company_id: myCompany.id })` |
| 49 | `Lead.list()` | `Lead.filter({ company_id: myCompany.id })` |

#### 24. TaskCustomerLinker.jsx (3 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 24 | `Task.list('-created_date', 5000)` | `Task.filter({ company_id: myCompany.id }, '-created_date', 5000)` |
| 30 | `Customer.list('-created_date', 5000)` | `Customer.filter({ company_id: myCompany.id }, '-created_date', 5000)` |
| 36 | `Lead.list('-created_date', 5000)` | `Lead.filter({ company_id: myCompany.id }, '-created_date', 5000)` |

#### 25. EstimateEditor.jsx (3 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 117 | `Estimate.list('-created_date', 10000)` | `Estimate.filter({ company_id: myCompany.id }, '-created_date', 10000)` |
| 138 | `Customer.list('-created_date', 1000)` | `Customer.filter({ company_id: myCompany.id }, '-created_date', 1000)` |
| 144 | `Lead.list('-created_date', 1000)` | `Lead.filter({ company_id: myCompany.id }, '-created_date', 1000)` |

#### 26. CreateEstimate.jsx (1 unfiltered query)
| Line | Current Code | Fix |
|------|-------------|-----|
| 63 | `Estimate.list("-created_date", 100)` | `Estimate.filter({ company_id: myCompany.id }, "-created_date", 100)` |

#### 27. Estimates.jsx (1 unfiltered query)
| Line | Current Code | Fix |
|------|-------------|-----|
| 168 | `Estimate.list("-created_date", 10000)` | `Estimate.filter({ company_id: myCompany.id }, "-created_date", 10000)` |

---

### MEDIUM — Operations / Field Data Leaking

#### 28. AIEstimator.jsx (7 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 286 | `Customer.list("-created_date", 100)` | `Customer.filter({ company_id: myCompany.id }, "-created_date", 100)` |
| 292 | `Lead.list("-created_date", 100)` | `Lead.filter({ company_id: myCompany.id }, "-created_date", 100)` |
| 298 | `Estimate.list("-created_date", 100)` | `Estimate.filter({ company_id: myCompany.id }, "-created_date", 100)` |
| 317 | `InspectionJob.list("-created_date", 100)` | `InspectionJob.filter({ company_id: myCompany.id }, "-created_date", 100)` |
| 366 | `PriceListItem.list("-created_date", 10000)` | `PriceListItem.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 4334 | `Customer.list('-created_date', 10000)` | `Customer.filter({ company_id: myCompany.id }, '-created_date', 10000)` |
| 4451 | `Customer.list('-created_date', 10000)` | `Customer.filter({ company_id: myCompany.id }, '-created_date', 10000)` |

#### 29. Subcontractors.jsx (2 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 102 | `Task.list('-created_date', 500)` | `Task.filter({ company_id: myCompany.id }, '-created_date', 500)` |
| 108 | `Payout.list('-created_date', 500)` | `Payout.filter({ company_id: myCompany.id }, '-created_date', 500)` |

#### 30. FieldSalesTracker.jsx (2 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 98 | `FieldActivity.list("-created_date", 10000)` | `FieldActivity.filter({ company_id: myCompany.id }, "-created_date", 10000)` |
| 105 | `RepLocation.list("-updated_date", 100)` | `RepLocation.filter({ company_id: myCompany.id }, "-updated_date", 100)` |

#### 31. FieldRepApp.jsx (2 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 107 | `FieldActivity.list("-created_date", 1000)` | `FieldActivity.filter({ company_id: myCompany.id }, "-created_date", 1000)` |
| 129 | `FieldActivity.list("-created_date", 10000)` | `FieldActivity.filter({ company_id: myCompany.id }, "-created_date", 10000)` |

#### 32. SMSTemplates.jsx (1 unfiltered query)
| Line | Current Code | Fix |
|------|-------------|-----|
| 55 | `SMSTemplate.list("-created_date", 1000)` | `SMSTemplate.filter({ company_id: myCompany.id }, "-created_date", 1000)` |

#### 33. EmailTemplates.jsx (1 unfiltered query)
| Line | Current Code | Fix |
|------|-------------|-----|
| 58 | `EmailTemplate.list("-created_date", 1000)` | `EmailTemplate.filter({ company_id: myCompany.id }, "-created_date", 1000)` |

#### 34. ConversationHistory.jsx (1 unfiltered query)
| Line | Current Code | Fix |
|------|-------------|-----|
| 15 | `ConversationHistory.list('-created_date', 500)` | `ConversationHistory.filter({ company_id: myCompany.id }, '-created_date', 500)` |

#### 35. StormTracking.jsx (2 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 153 | `StormEvent.list('-start_time', 20000)` | `StormEvent.filter({ company_id: myCompany.id }, '-start_time', 20000)` |
| 160 | `StormAlertSettings.list()` | `StormAlertSettings.filter({ company_id: myCompany.id })` |

#### 36. StormReport.jsx (3 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 51 | `StormEvent.list("-start_time")` | `StormEvent.filter({ company_id: myCompany.id }, "-start_time")` |
| 57 | `Lead.list("-created_date")` | `Lead.filter({ company_id: myCompany.id }, "-created_date")` |
| 63 | `Customer.list("-created_date")` | `Customer.filter({ company_id: myCompany.id }, "-created_date")` |

#### 37. LadderAssistDashboard.jsx (1 unfiltered query)
| Line | Current Code | Fix |
|------|-------------|-----|
| 41 | `InspectionJob.list("-created_date", 1000)` | `InspectionJob.filter({ company_id: myCompany.id }, "-created_date", 1000)` |

#### 38. InspectionCapture.jsx (1 unfiltered query)
| Line | Current Code | Fix |
|------|-------------|-----|
| 155 | `Estimate.list('-created_date', 100)` | `Estimate.filter({ company_id: myCompany.id }, '-created_date', 100)` |

#### 39. Inspectors.jsx (1 unfiltered query)
| Line | Current Code | Fix |
|------|-------------|-----|
| 147 | `InspectorProfile.list()` | `InspectorProfile.filter({ company_id: myCompany.id })` |

#### 40. CalendarSettings.jsx (1 unfiltered query)
| Line | Current Code | Fix |
|------|-------------|-----|
| 49 | `CalendarEvent.list("-start_time", 1000)` | `CalendarEvent.filter({ company_id: myCompany.id }, "-start_time", 1000)` |

#### 41. TaskImporter.jsx (1 unfiltered query)
| Line | Current Code | Fix |
|------|-------------|-----|
| 43 | `TaskBoard.list("-created_date")` | `TaskBoard.filter({ company_id: myCompany.id }, "-created_date")` |

#### 42. Reminders.jsx (2 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 31 | `Task.list('-due_date', 1000)` | `Task.filter({ company_id: myCompany.id }, '-due_date', 1000)` |
| 50 | `CalendarEvent.list('-start_time', 500)` | `CalendarEvent.filter({ company_id: myCompany.id }, '-start_time', 500)` |

#### 43. PermitAssistant.jsx (1 unfiltered query)
| Line | Current Code | Fix |
|------|-------------|-----|
| 57 | `Customer.list("-created_date", 1000)` | `Customer.filter({ company_id: myCompany.id }, "-created_date", 1000)` |

#### 44. DroneInspections.jsx (1 unfiltered query)
| Line | Current Code | Fix |
|------|-------------|-----|
| 151 | `StormEvent.list('-start_time', 5000)` | `StormEvent.filter({ company_id: myCompany.id }, '-start_time', 5000)` |

#### 45. ReviewRequests.jsx (1 unfiltered query)
| Line | Current Code | Fix |
|------|-------------|-----|
| 39 | `ReviewRequest.list('-created_date', 1000)` | `ReviewRequest.filter({ company_id: myCompany.id }, '-created_date', 1000)` |

#### 46. LeadProfile.jsx (3 unfiltered queries)
| Line | Current Code | Fix |
|------|-------------|-----|
| 126 | `Communication.list("-created_date")` | `Communication.filter({ company_id: myCompany.id }, "-created_date")` |
| 133 | `CalendarEvent.list("-start_time")` | `CalendarEvent.filter({ company_id: myCompany.id }, "-start_time")` |
| 140 | `LeadScore.list()` | `LeadScore.filter({ company_id: myCompany.id })` |

#### 47. CustomFormats.jsx (1 unfiltered query)
| Line | Current Code | Fix |
|------|-------------|-----|
| 72 | `EstimateFormat.list("-created_date")` | `EstimateFormat.filter({ company_id: myCompany.id }, "-created_date")` |

---

### ALSO CHECK — .filter() calls missing company_id

These pages use `.filter()` but filter by name/email/status instead of including `company_id`:

#### CustomerProfile.jsx
- L20: `Estimate.filter({ customer_name: customer.name })` → add `company_id: myCompany.id`
- L21: `Invoice.filter({ customer_name: customer.name })` → add `company_id: myCompany.id`
- L22: `Payment.filter({ customer_name: customer.name })` → add `company_id: myCompany.id`
- L24: `Project.filter({ customer_name: customer.name })` → add `company_id: myCompany.id`
- L25: `Task.filter({ related_to: customer.name })` → add `company_id: myCompany.id`
- L26: `Communication.filter({ contact_name: customer.name })` → add `company_id: myCompany.id`
- L27: `Proposal.filter({ customer_name: customer.name })` → add `company_id: myCompany.id`
- L28: `Contract.filter({ customer_name: customer.name })` → add `company_id: myCompany.id`
- L29: `CalendarEvent.filter({ related_customer: customer.name })` → add `company_id: myCompany.id`
- L30: `InspectionJob.filter({ client_name: customer.name })` → add `company_id: myCompany.id`
- L32: `Document.filter({ related_customer: customer.name })` → add `company_id: myCompany.id`
- L33: `Invoice.filter(...)` → add `company_id: myCompany.id`

#### customer-profile.jsx (lowercase)
- L46: `Estimate.filter({ customer_name: customerName })` → add `company_id: myCompany.id`
- L47: `Invoice.filter({ customer_name: customerName })` → add `company_id: myCompany.id`
- L48: `Payment.filter({ customer_name: customerName })` → add `company_id: myCompany.id`

#### Workflows.jsx
- L14: `WorkflowExecution.filter({ status: 'active' })` → add `company_id: myCompany.id`

#### LiveCallDashboard.jsx
- L56-57: `Communication.filter(...)` → add `company_id: myCompany.id`

#### LeadProfile.jsx
- L42: `Document.filter({ related_customer: lead.name })` → add `company_id: myCompany.id`

#### MarcusMarketing.jsx
- L40: `EmailTemplate.filter({ is_default: true })` → add `company_id: myCompany.id`
- L41: `SMSTemplate.filter({ is_default: true })` → add `company_id: myCompany.id`

#### EstimateEditor.jsx
- L10: `EstimateFormat.filter({ is_active: true })` → add `company_id: myCompany.id`

#### Templates.jsx
- L45: `EstimateTemplate.filter({ is_active: true })` → add `company_id: myCompany.id`

---

## Entities That Are OK Without company_id

These entities are either global/shared or uniquely identified, so `.list()` without company_id is acceptable:
- **Company** — fetching companies to find your own
- **StaffProfile** — filtered by user_email
- **User** — system-level
- **XactimatePriceList** — global pricing data
- **SubscriptionPlan** — global plans
- **SubscriptionPackages** — global packages
- **PlatformMenuSettings** — global platform settings

---

## Recommended Platform-Level Fix

Instead of patching 45+ pages individually, Base44 could implement **automatic company_id scoping** at the SDK level:

1. When a user calls `.list()` or `.filter()`, the SDK automatically injects `company_id` based on the authenticated user's active company
2. Only `asServiceRole` calls bypass this filter
3. This eliminates the possibility of future pages accidentally leaking data

This is how most multi-tenant platforms (Salesforce, HubSpot, etc.) handle data isolation — at the platform layer, not the application layer.
