# NL Query Test Cases — cds-db-nlquery-mcp

Tests for `@shahid.la/cds-db-nlquery-mcp` against Banking Sentinel HANA schema.
Run via: MCP tool `natural_language_query` with question as input.

---

## 1. Simple queries
Single entity, one or two filter conditions. Should resolve with zero joins.

| # | Question | Expected entity | Key columns |
|---|---|---|---|
| S1 | "List all customers with a DTI ratio above 6" | BCA_DTI | PARTNER, DTI_RATIO, BREACH_FLAG |
| S2 | "Show all active loans" | Loans | LOAN_ID, PARTNER, AMOUNT, STATUS |
| S3 | "Which customers have BREACH_FLAG set to true?" | BCA_DTI | PARTNER, DTI_RATIO, BREACH_FLAG |
| S4 | "Show all overdue payments" | DFKKOP | OPBEL, GPART, DAYS_OVERDUE, STATUS |
| S5 | "List all loan guarantors" | BCA_GUARANTOR | LOAN_ID, GUARANTOR_PARTNER, COVER_AMOUNT |
| S6 | "Show loans maturing in the next 90 days" | Loans | LOAN_ID, MATURITY_DATE, AMOUNT |
| S7 | "List all payments cleared in the last 30 days" | DFKKOPK | OPBEL, GPART, AUGDT, BETRW |
| S8 | "Show customers in the MINING sector" | BCA_SECTOR | PARTNER, SECTOR_CODE, SECTOR_NAME |
| S9 | "What are the current APRA regulatory thresholds?" | RegulatoryThresholds | THRESHOLD_TYPE, LIMIT_VALUE, LIMIT_PCT |
| S10 | "List all business partner relationships" | BUT050 | PARTNER1, PARTNER2, RELTYP |

---

## 2. Complex queries
Multi-condition filters, joined entities, ordered results.

| # | Question | Expected entity + join | Notes |
|---|---|---|---|
| C1 | "Which customers have income expiring in the next 90 days AND a DTI above 5?" | BCA_DTI + customer | Two conditions, date + decimal |
| C2 | "Show HOME loans with a loan amount above 500000 in ACTIVE status" | Loans | Three conditions |
| C3 | "List customers in the CONSTRUCTION sector who have overdue payments" | DFKKOP + customer | Sector in customer, overdue in payment |
| C4 | "Show all guarantors with a cover amount above 200000, ordered by cover amount descending" | BCA_GUARANTOR | Sort + threshold |
| C5 | "Which customers have a DTI ratio between 5 and 7?" | BCA_DTI | Range condition (two where clauses) |
| C6 | "Show all BUSINESS loans approved in the last 180 days that are still active" | Loans | Date range + status + type |
| C7 | "List payment history rows where dunning level was 3 (final notice)" | DFKKOPK | MAHNS = 3 |
| C8 | "Which loans have collateral of type PROPERTY?" | BCA_COLLATERAL + loan | Join to Loans |
| C9 | "Show all customers whose income contract expires within 30 days and who have any overdue items" | BCA_DTI + customer | Forward-looking risk signal |
| C10 | "List all FAMILY_TRUST_MEMBER relationships between business partners" | BUT050 | RELTYP filter |

---

## 3. Old hardcoded queries (re-test in MCP)
These were the example queries embedded in `srv/agents/simple-query.js` and `srv/utils/query-schema.js`.
Must return equivalent results — verifies backwards compatibility.

| # | Original question | Expected descriptor | Source |
|---|---|---|---|
| H1 | "Which customers have a DTI above 5?" | entity:BCA_DTI, join:customer, where DTI_RATIO>5 | simple-query.js example |
| H2 | "Show customers with DTI breach and overdue payments" | entity:DFKKOP, join:dti, where STATUS=OPEN AND dti.BREACH_FLAG=true | simple-query.js example |
| H3 | "Which customers have income expiring in the next 90 days?" | entity:BCA_DTI, join:customer, where INCOME_EXPIRY within_days 90 | simple-query.js example |
| H4 | "Which guarantors are also borrowers at this bank?" | entity:BCA_GUARANTOR, join:asLoan | simple-query.js example |
| H5 | "List loans with their guarantor names" | entity:BCA_GUARANTOR, join:guarantor | simple-query.js example |
| H6 | "Show customers with overdue payments above 60 days" | entity:DFKKOP, where DAYS_OVERDUE>60 | query-schema.js usage |
| H7 | "List home loans for customer 30100001" | entity:Loans, where PARTNER=30100001 AND LOAN_TYPE=HOME | direct lookup |
| H8 | "Show all OPEN payment items for loan L-001" | entity:DFKKOP, where LOAN_ID=L-001 AND STATUS=OPEN | targeted query |

---

## 4. Queries not possible with the old hardcoded schema
The old `query-schema.js` was manually written and incomplete. These require the MCP's dynamic CDS model reading.

| # | Question | Why it needed MCP | Entity |
|---|---|---|---|
| N1 | "Show risk assessment results for customer 30100003" | RiskAssessments not in old schema | RiskAssessments |
| N2 | "How many LLM calls were made in the last 7 days?" | AuditLog not in old schema | AuditLog |
| N3 | "Show all audit log entries for risk_analysis actions" | AuditLog not in old schema | AuditLog |
| N4 | "What sector exposure limits are configured?" | SectorExposureLimits not in old schema | SectorExposureLimits |
| N5 | "Show APRA single-borrower exposure limits" | ExposureLimits not in old schema | ExposureLimits |
| N6 | "List credit history cases with HIGH arrears outcome" | BCA_CREDIT_HISTORY available in MCP via CDS | BCA_CREDIT_HISTORY |
| N7 | "Show LoanSchedule rows for loan L-004 that are MISSED" | LoanSchedule joins available via CDS assoc | LoanSchedule + loan |
| N8 | "List collateral assets for loans above 1 million AUD" | BCA_COLLATERAL → Loans join auto-discovered | BCA_COLLATERAL + loan |
| N9 | "Show all DFKKOPK history for customer 30100001 ordered by due date" | DFKKOPK now properly in schema with associations | DFKKOPK |
| N10 | "Which guarantors belong to a family trust (RELTYP=FAMILY_TRUST_MEMBER) and are also guaranteeing active loans?" | BUT050 + BCA_GUARANTOR cross-reference | Multi-hop — hard before |

---

## 5. Queries that generate big or complex SQL
These test scalability and correctness of multi-join + large result scenarios.

| # | Question | Why complex | Risk |
|---|---|---|---|
| B1 | "For every customer with an active loan, show their DTI ratio, total loan amount, and whether they have any overdue payment" | 3-entity join: Loans + BCA_DTI + DFKKOP | Row explosion possible |
| B2 | "Show all customers with their sector, DTI ratio, and all their payment history records" | BusinessPartners + BCA_DTI + DFKKOPK | Up to 1015 × 12 rows |
| B3 | "List every scheduled repayment that is overdue (past due date) for all customers" | LoanSchedule with date comparison | Could be large |
| B4 | "Show all loans, their guarantors, and the guarantors' DTI ratios" | BCA_GUARANTOR → BCA_DTI two hops | LLM must chain joins |
| B5 | "Show all payment items in the last 12 months with borrower name and loan type" | DFKKOP + customer + loan three-way | Three entities, LLM picks best 2 |
| B6 | "List all loans where total collateral value is less than the loan amount" | BCA_COLLATERAL aggregation → Loans | Would need aggregation — LLM may approximate |
| B7 | "Which customers have more than 3 overdue payment items?" | DFKKOP aggregation | COUNT — likely returns all then filter |
| B8 | "Show all payment history items from 2025 for customers in the RETAIL_PROP sector" | DFKKOPK + BCA_SECTOR year filter | Date range + sector join |

---

## 6. Queries now possible via MCP (not covered above)
These are genuinely new analytical capabilities that weren't wired at all before the MCP — even in hardcoded simple-query.

| # | Question | What makes it new |
|---|---|---|
| M1 | "Show me the LLM token cost breakdown by action type from the audit log" | AuditLog TOKENS_IN/OUT — new analytical entity |
| M2 | "Which customers have been assessed as HIGH or CRITICAL risk in their last assessment?" | RiskAssessments.RISK_LEVEL — pipeline output as queryable data |
| M3 | "Show me all regulatory documents uploaded for APS221 standard" | RegulatoryDocuments — APRA knowledge base as queryable table |
| M4 | "List loans in sectors that are close to their concentration limit" | SectorExposureLimits + BCA_SECTOR — two reference entities joined |
| M5 | "Show me customers where income expires before their loan matures" | BCA_DTI.INCOME_EXPIRY vs Loans.MATURITY_DATE — cross-entity date compare |
| M6 | "Which customers have a but050 SUBSIDIARY relationship and loans above 500000?" | BUT050 + Loans — graph structure queried as relational |
| M7 | "List all models used in the audit log and their average token cost" | AuditLog.MODEL + TOKENS_IN aggregation — LLMOps query |
| M8 | "Show loans approved before the APRA DTI Notice effective date (Feb 2026) that now breach the limit" | Loans.APPROVED_DATE + BCA_DTI.BREACH_FLAG — temporal policy query |
| M9 | "Which customers have cleared all their scheduled payments on time (no DFKKOPK rows with MAHNS > 0)?" | DFKKOPK.MAHNS = 0 across all history — track record query |
| M10 | "Show customers whose guarantors also have active loans — potential connected exposure" | BCA_GUARANTOR → Loans (asLoan join) — APS 221 connected party exposure |

---

## Testing approach

For each query:
1. Send via MCP tool `natural_language_query`
2. Check stderr for the descriptor logged by the server
3. Verify: correct entity selected, reasonable join, appropriate where conditions
4. Check row count and spot-check first 3 rows against known seed data

**Known data anchors for spot-checks:**
- Customer `30100003` = L-004, DTI breach, 6 months DFKKOPK history
- Customer `30100001` = L-001 + L-002, overdue, 12 months DFKKOPK history
- Customer `30900001` = guarantor for multiple loans (BUT050 rows)
- Loan `L-004` = BUSINESS loan, $500k, approved 2025-08-10
- Total DFKKOPK rows: 138 (11×12 + 1×6 months)
