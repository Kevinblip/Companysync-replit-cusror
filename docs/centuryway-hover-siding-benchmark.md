# Centuryway HOVER siding benchmark evidence

## Verified reference

- **Report:** HOVER Complete Measurements, dated June 10, 2026
- **Printed property:** 20638 Centuryway Rd, Maple Heights, OH 44137-3117
- **HOVER property ID:** 22005438
- **Scope:** siding tables, elevation drawings, facades, and opening detail are present.

The report identity matches the Centuryway subject before any comparison is
eligible. No Lakesedge or other-property HOVER report is used.

## HOVER evidence extracted from the report

| Category | Reported value | Interpretation |
| --- | ---: | --- |
| Siding facade area | 1,003 ft² | HOVER states its siding values **include openings**. This is pre-opening siding facade area, not net siding. |
| Siding opening area | 278 ft² | Gross HOVER siding-opening area; it is not automatically CompanySync's deductible area. |
| Opening perimeter | 216′5″ | HOVER total perimeter; CompanySync J-channel applies its garage-at-grade rule, so any comparison is geometry-sensitive. |
| Level starter | 144′3″ | Direct trim reference. |
| Siding facets | 8 (SI-1 through SI-8) | Four elevation drawings are covered. |
| Coverage exception | 8 ft² unknown / missing photos | HOVER explicitly identifies this uncertainty. |
| Window groups | 13 (WG-1 through WG-13) | Rough-opening assemblies from the HOVER opening table. |
| Window units | 18 (W-001 through W-118) | Physical window products inside those groups; sash rails and panes are not extra units. |
| Entry doors | 2 (D-1 and D-2) | One front and one rear walk-through door. |
| Shutters | 0 | Both the siding and brick facade tables report zero. |
| Vents | 2 | Separate from windows in the siding facade table. |

The detailed opening sheets use a different grouping vocabulary from the
summary. They must be retained as assemblies and components rather than
collapsed into one count. If an extraction cannot reconcile the table and
summary counts, that category remains unavailable.

## CompanySync historical evidence

The available Centuryway photo-siding snapshot is a Grade C, ±15% result that
reports 558 ft² net wall area, two windows, no entry doors, and one garage
door. Its complete historical canonical graph was not retained with the
snapshot.

| Required comparison | Result | Discrepancy classification |
| --- | --- | --- |
| Canonical wall facets | Unavailable: historical graph is absent | evidence coverage |
| Rough-opening assemblies | Unavailable: only summary counts survive | classification |
| Individual opening components | Unavailable: component graph is absent | classification |
| Opening deductions | Unavailable: historical deductible-area rule output is absent | estimate conversion |
| J-channel perimeter | Unavailable: historical trim graph is absent | geometry |
| Net siding | Unavailable: HOVER does not print a post-opening net siding total | estimate conversion |
| Level starter / trim | Unavailable: historical trim graph is absent | estimate conversion |
| Coverage | HOVER covers four elevations with 8 ft² unknown; CompanySync snapshot is Grade C / ±15% | evidence coverage |

No missing value is treated as zero. The 558 ft² historical CompanySync value
is not compared with HOVER's 1,003 ft² facade value because they are different
measurement stages. Accordingly, there is no aggregate accuracy score and no
calibration change from this evidence.

## Live full-coverage photo-path benchmark

The production Centuryway inspection contains 161 media rows and has Front,
Rear, Left, and Right Elevation sections. Only the Front section contains a
full-wall image; the other three sections are damage close-ups. Its historical
2-window / 0-door / 1-garage-door snapshot is therefore not evidence of a
complete-house count.

The matching HOVER report embeds its original full-facade capture photos. One
front, rear, left-side, and right-side house image was passed through the live
`analyzeHousePhotosForSiding` handler with satellite inference disabled. The
canonical coverage graph accepted all four faces and reported no missing
elevation.

| Count | HOVER | Before prompt/aggregation fix | After fix |
| --- | ---: | ---: | ---: |
| Window groups / assemblies | 13 | 9 | 14 |
| Window units | 18 | 12 | 18 |
| Entry doors | 2 | 2 | 2 |
| House garage-door openings | 0 | 0 | 0 |
| Shutter panels | 0 | 0 | 0 |
| Vents | 2 | 0 | 1 |

The original run under-counted four window assemblies and six units. The fixed
run finds every HOVER window unit and both doors. Its one remaining discrepancy
is a foundation-opening classification: CompanySync reports 14 window groups
plus 1 vent where HOVER reports 13 window groups plus 2 vents. This is not an
opening omission; both inventories account for the same 17 physical house
openings when the two entry doors are included. No deterministic geometry rule
was added because a real small basement window and a foundation vent can have
the same size and position.

The detached garage is a separate structure in the report. A separate live
garage-front run returned 1 garage-door opening, matching the visible opening;
it was intentionally excluded from the four-face house inventory.

### Summary/elevation parity

The fixed house response reports 14 window assemblies, 2 entry doors, 0 house
garage doors, and 0 shutters. Its canonical elevation inventory contains
exactly 14 window groups and 2 entry-door groups. The separate garage response
reports and draws exactly 1 garage-door group. The Measurement Summary resolver
prefers these same canonical fields, so the displayed counts and elevation
drawings are in lockstep.

### Scope note

The unrelated screenshot showing 33 windows, 12 doors, and 8 shutters has no
property identity and is not attributable to Centuryway. It remains display
provenance test data only and must not be presented as this address's HOVER
ground truth.