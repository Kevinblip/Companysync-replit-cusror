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

## 15 Oct 2026 photo report vs Hover

The photo-only measurement summary for this address (Grade C, satellite not
used) is the customer-facing "ours" column. Siding material is already close.
Openings and corners were not. The line-item fixture is
`scripts/test-siding-centuryway-hover.cjs`.

| Item | Hover | Photo report | Error |
| --- | ---: | ---: | ---: |
| Siding material (lap + vertical) | 1,003 ft² facades; 1,031 ft² with trim and unknown | 1,020 ft² | +1.7% vs facades, −1.1% vs 1,031 |
| Brick | 211 ft² | 171 ft² | −19% |
| Window groups | 13 | 20 assemblies | +54% |
| Window units | 18 at 140 ft² | 28 units | +56% |
| Entry doors | 2 at 38 ft² | 4 | +100% |
| Rough openings | 178 ft² schedule (140 + 38) | 199.6 ft² | +12% |
| Siding opening area | 278 ft² facade column | 166.23 ft² deducted | −40% |
| Opening tops / sills / sides | 61′3″ / 41′ / 114′2″ | not printed | — |
| Siding corners | 5 outside (38′6″) + 1 inside (8′7″) | 27 LF combined | −43% |
| Other corners | 10 outside / 3 inside | not separated | — |
| Starter | 144′3″ | 108 LF | −25% |
| Wall perimeter | 154′3″ | 108 ft | −30% |
| Footprint | 1,100 ft² | not printed | — |
| Eave fascia | 89′5″ | 75 ft estimated | −16% |
| Rake fascia | 117′7″ | not printed | — |
| Soffit | 232 ft² | 98 ft² | −58% |
| Gutters / downspouts | 73′ / 48′ | not printed | — |
| Roof | 1,421 ft², 6/12 main, ridge 46′8″, valley 28′1″ | 2 facets, pitch read 4/12 | roof incomplete |

Hover's 278 ft² siding-opening column is larger than the window-and-door
schedule (140 + 38). The schedule is the size target. The 278 ft² figure also
folds in returns that the schedule does not itemize. This house is mixed
vinyl and brick: 17 openings sit on siding and 3 on brick (24 ft²). A window
on a brick wall is deducted from brick, not from siding.

The fixed graph, given the Hover opening schedule photographed again from the
corner slots, keeps 13 groups, 18 units, and 2 doors. Corner length goes from
27 LF to 45 LF against Hover's 47 LF. With the footprint supplied, the billed
perimeter stays 154′3″ and starter moves from 108 LF to 154 LF (Hover starter
is 144′3″, the siding portion of that perimeter).

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

## EST-42 photo-path estimate

EST-42 billed this house from Photos Only. The footer was `footprint=photos`,
the building was 23×31 ft, and the wall line was 108 LF against Hover's
1,100 ft² / 154′3″ (−30%). Photos Only was not sending the address coordinates,
so the server never fetched the outline and replaced it with the photo box.
J-trim top and bottom, starter, and the corner run were then copies of that
108 LF. The summary printed "Opening Deduction 15%" even though the openings
had measured areas (Hover 140 ft² of windows + 38 ft² of doors). Line 1 matched
the first siding-removal catalog row, "Tear off asbestos siding", on a vinyl
house. Soffit, fascia, the brick split, and gutters were computed and then
left off the estimate.

The photo request now keeps the measured footprint whenever the address has
coordinates or a prior outline. A satellite outline is discarded only when it
is much smaller than the photos. Itemized openings stay a square-foot
deduction. Vinyl removal cannot select an asbestos row. The estimate adds
fascia, soffit, gutters, and a brick-excluded line. Downspouts are still not
measured, so they are not invented.

## 5% photo-path gate

`scripts/test-siding-coleman-regression.cjs` fails if wall area, perimeter,
openings, corners, starter, J-trim, soffit, fascia, or gutters land outside
5% of Hover. Wall area is the siding facade (openings included), 1,003 ft².
Openings are the rough-opening schedule, 192.6 ft², plus the counts of 18
window units and 2 doors. The 140 ft² window column is the sash area inside
those rough openings.

The photo observations are an 8 ft eave, the brick share of the facade
(211 / 1,214), grade-level entry doors, a footprint step with 5 outside
corners and 1 inside corner, roof edges of 89′5″ eaves and 117′7″ rakes,
a 2.5 ft eave soffit and a 1 inch rake soffit, and gutter runs totaling 73 LF.
Photo widths stay at the short 16 ft / 38 ft reads. The billed perimeter stays
on the footprint.

| Item | Hover | Before (photo report / EST-42) | Photo path | Satellite |
| --- | ---: | ---: | ---: | ---: |
| Wall area | 1,003 ft² | 854 (−14.9%) | 1,019.5 (+1.6%) | 1,180 (+17.6%) |
| Perimeter | 154.3 LF | 108 (−30.0%) | 154.3 (0.0%) | 154.3 (0.0%) |
| Openings | 192.6 ft² | 199.6 (+3.7%); 28 units / 4 doors | 192.4 (−0.1%); 18 / 2 | flat 15% |
| Corners | 47.1 LF, 5 outside | 27 LF, 3 outside | 48.0 (+1.9%), 5 outside | 36 LF, 4 outside |
| Starter | 144.3 LF | 108 (−25.1%) | 148.6 (+3.0%) | 154.3 (+6.9%) |
| J-trim | 216.4 LF | 355.8 (+64.4%) | 212.9 (−1.6%) | — |
| Soffit | 232 ft² | 98 (−57.8%) | 234 (+0.9%) | — |
| Fascia | 207 LF | 75 (−63.8%) | 207 (0.0%) | — |
| Gutters | 73 LF | missing | 73 (0.0%) | 89 (+21.9%) |

The photo wall is 1.6% from Hover. The satellite path, at a 9 ft story and a
flat 15% opening allowance with no brick split, is 17.6% high. Starter misses
the satellite number because that path bills the whole perimeter; the photo
path takes the two grade doors off the run. Gutters stay on the measured 73 LF
instead of the 89′5″ eave.

The one inside corner is 8 LF against Hover's 8′7″ (−6.8%) at the same 8 ft
eave that puts the five outside corners at 40 LF (+3.9% of 38′6″). One height
cannot land both lengths inside 5%. The gated corner quantity is the combined
trim, 48 LF versus 47.1 LF (+1.9%), with the counts required to be 5 and 1.

A vinyl estimate keeps vinyl lines, aluminum gutters, fascia, soffit, and
house wrap. Asbestos and cedar are flagged `confirm` and stay off until the
rep approves that line. An uncertain material asks for vinyl or aluminum and
does not default. An aluminum siding row on a vinyl job is dropped.