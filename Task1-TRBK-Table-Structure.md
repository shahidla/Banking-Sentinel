# Procurement Sentinel — Banking Edition
## Task 1: SAP TRBK Table Structure & Synthetic Data Story

---

## What is SAP TRBK

SAP Transactional Banking (TRBK) is SAP Fioneer's core banking platform built on SAP HANA. It handles end-to-end transaction processing for deposits, loans, payments and foreign exchange. It is the backbone of modern SAP-based banking — event-driven, modular, and AI-augmented by design.

TRBK evolved from SAP Banking Services (BCA prefix tables). The table naming convention BCA_* is the legacy Banking Contract Accounting layer that TRBK builds upon. Understanding these tables is critical because any TRBK implementation will have this data in HANA.

---

## Core TRBK / BCA Table Structure

### 1. Business Partner — The Customer

| Table | Description | Key Fields |
|---|---|---|
| BUT000 | Business Partner master | PARTNER, BU_SORT1, BU_TYPE |
| BUT020 | BP Address data | PARTNER, ADDRNUMBER |
| BUT100 | BP Roles | PARTNER, RLTYP (role type) |
| BP2000 | BP-to-BP Relationship | PARTNER1, PARTNER2, RELTYP |
| BUT0BK | BP Bank Details | PARTNER, BANKL, BANKN |

**BP2000 is the graph edge table.** It stores relationships between business partners — guarantors, connected parties, related entities, group memberships. This is the table that enables connected party risk detection.

**Synthetic data approach:**
Generate 50 business partners. Embed hidden relationships in BP2000 — three borrowers connected to one guarantor. Two borrowers sharing a parent company. This is the graph the AI traverses.

---

### 2. Account Contract — The Loan or Deposit

| Table | Description | Key Fields |
|---|---|---|
| BKKF | Contract account master | VKONT (contract account), BUKRS, GSBER |
| BKKA | Contract account attributes | VKONT, VTREF, VERTR (contract type) |
| BKKN | Contract account — business partner link | VKONT, GPART (partner) |
| BCA_CONTRACT | TRBK Contract header | CONTRACT_ID, PRODUCT_ID, STATUS |
| BCA_CONTRACT_ACC | Contract-Account assignment | CONTRACT_ID, VKONT |

**Contract types in TRBK:**
- Home Loan / Mortgage
- Personal Loan
- Business Loan / Credit Facility
- Term Deposit
- Current Account
- Notice Deposit

**Synthetic data approach:**
Generate contracts of each type. Assign to business partners via BKKN. Include loan amounts, interest rates, start dates, maturity dates. Home loans are largest — $500K-$2M range for Australian market.

---

### 3. Loan Specific Tables

| Table | Description | Key Fields |
|---|---|---|
| BCA_LOAN_HDR | Loan header | LOAN_ID, PARTNER, AMOUNT, CURRENCY |
| BCA_LOAN_COND | Loan conditions | LOAN_ID, COND_TYPE, RATE, VALID_FROM |
| BCA_LOAN_SCHED | Repayment schedule | LOAN_ID, DUE_DATE, AMOUNT_DUE, STATUS |
| BCA_COLLATERAL | Collateral assignment | LOAN_ID, COLLAT_ID, COLLAT_TYPE, VALUE |
| BCA_GUARANTOR | Guarantor assignment | LOAN_ID, GUARANTOR_PARTNER, COVER_AMOUNT |

**BCA_GUARANTOR is the second graph edge table.** It links a loan to its guarantor. Combined with BP2000, this creates the full connected party graph:

```
BusinessPartner → [BP2000 relationship] → BusinessPartner
BusinessPartner → [BKKN] → Contract → [BCA_LOAN_HDR] → Loan
Loan → [BCA_GUARANTOR] → BusinessPartner (guarantor)
Loan → [BCA_LOAN_SCHED] → RepaymentSchedule
```

**Synthetic data approach:**
Generate 30 loans. Assign guarantors deliberately — guarantor G-001 covers loans L-001, L-002, L-003. This creates the concentration. Guarantor G-001 is connected via BP2000 to G-002 who also covers loans L-004, L-005. The AI must find this chain.

---

### 4. Transaction and Payment Tables

| Table | Description | Key Fields |
|---|---|---|
| DFKKOP | Open items (receivables) | OPBEL, GPART, BETRW, FAEDN (due date) |
| DFKKZP | Payment items | VKONT, BETRW, BUDAT (posting date) |
| DFKKLKZ | Payment lock reasons | VKONT, SPERR (lock indicator) |
| BCA_POSTING | Posting document | POST_ID, VKONT, AMOUNT, POSTING_DATE |
| BCA_TRANS_HDR | Transaction header | TRANS_ID, VKONT, TRANS_TYPE, AMOUNT |

**DFKKOP is the risk signal table.** Open items past their due date are overdue. Overdue items against a loan contract indicate missed repayments — the primary credit risk signal.

**Key fields for risk:**
- FAEDN — due date. Compare to current date to calculate days overdue.
- BETRW — amount. Sum for total exposure.
- OPBEL — document number. Links back to the loan.

**Synthetic data approach:**
Generate payment history for each loan. For risk loans — insert DFKKOP records past FAEDN with no corresponding payment in DFKKZP. The gap between due date and posting date = days overdue = credit risk signal.

---

### 5. Product and Risk Classification

| Table | Description | Key Fields |
|---|---|---|
| BCA_PRODUCT | Product definition | PRODUCT_ID, PRODUCT_TYPE, RISK_CLASS |
| BCA_RISK_CLASS | Risk classification | LOAN_ID, RISK_CATEGORY, RATING, VALID_FROM |
| BCA_SECTOR | Industry sector code | PARTNER, SECTOR_CODE, SECTOR_DESC |
| BCA_LTV | Loan to value ratio | LOAN_ID, LTV_RATIO, PROPERTY_VALUE |
| BCA_DTI | Debt to income ratio | PARTNER, DTI_RATIO, INCOME, TOTAL_DEBT |

**BCA_SECTOR enables concentration risk detection.** If multiple borrowers share the same sector code — that is sector concentration. If they share the same postcode — that is geographic concentration.

**BCA_DTI is critical for APRA compliance.** APRA activated debt-to-income limits in February 2026. Any loan with DTI > 6 is flagged. The AI finds borrowers approaching or breaching this threshold.

**Synthetic data approach:**
Assign sector codes to business partners. Cluster three borrowers in SECTOR_CODE = 'RETAIL_PROP' (retail property). Combined with shared guarantor — that is concentration + connected party risk in one chain.

---

### 6. Regulatory and Compliance Tables (synthetic — these may not exist in TRBK exactly but represent data banks hold)

| Table | Description | Key Fields |
|---|---|---|
| RISK_THRESHOLD | Regulatory limits | THRESHOLD_TYPE, LIMIT_VALUE, REGULATOR |
| EXPOSURE_LIMIT | Single borrower exposure | PARTNER, CURRENT_EXPOSURE, LIMIT, BREACH_FLAG |
| CONNECTED_PARTY | Connected party register | PARTNER, CONNECTED_TO, RELATIONSHIP_TYPE |
| SECTOR_EXPOSURE | Sector concentration | SECTOR_CODE, TOTAL_EXPOSURE, LIMIT, UTILISATION |

**Note:** These tables may be implemented as custom Z-tables in a real TRBK implementation or may exist in the regulatory reporting layer. For the prototype these are synthetic but realistic — every Australian bank regulated by APRA maintains this data.

---

## The Synthetic Dataset — What to Generate

### Business Partners (50 records)
- 30 individual borrowers (retail banking)
- 10 corporate borrowers (business banking)
- 8 guarantors (individuals and companies)
- 2 parent entities (holding companies connected to multiple guarantors)

### Hidden Risk Patterns (what the AI must find)
1. **Borrowers B-001, B-002, B-003** share guarantor G-001. All three have overdue repayments. Combined exposure: AUD $4.2M. Regulatory limit: AUD $5M. Utilisation: 84%.

2. **Guarantor G-001** is connected via BP2000 to G-002 (related party — same family trust). G-002 also guarantees borrowers B-004 and B-005. Combined group exposure: AUD $7.8M — breaches APS 221 large exposure limit.

3. **Borrowers B-001, B-002, B-007, B-011** all work in the retail property sector. Combined sector exposure: AUD $12.4M — approaching sector concentration limit.

4. **Borrower B-003** has DTI ratio of 7.2 — above APRA's February 2026 limit of 6. Loan was approved before the limit was activated. Now a regulatory breach.

### Loan Types (60 records)
- 20 home loans (AUD $400K-$2M, 25-30 year terms)
- 10 investment property loans
- 10 personal loans
- 10 business credit facilities
- 10 term deposits (to show deposit side)

### Repayment History (180 records)
- 3 payment records per loan
- Risk loans: 1-2 missed payments (DFKKOP with no DFKKZP match)
- Performing loans: all payments on time

---

## The Graph Model on HANA

```
(BusinessPartner) ──[BP2000: GUARANTEES]──> (BusinessPartner)
(BusinessPartner) ──[BP2000: RELATED_TO]──> (BusinessPartner)
(BusinessPartner) ──[BP2000: SUBSIDIARY_OF]──> (BusinessPartner)
(BusinessPartner) ──[BKKN: HAS_CONTRACT]──> (Contract)
(Contract) ──[BCA_LOAN_HDR: IS_LOAN]──> (Loan)
(Loan) ──[BCA_GUARANTOR: GUARANTEED_BY]──> (BusinessPartner)
(Loan) ──[BCA_LOAN_SCHED: HAS_SCHEDULE]──> (RepaymentSchedule)
(RepaymentSchedule) ──[DFKKOP: HAS_OPEN_ITEM]──> (OpenItem)
(OpenItem) ──[STATUS: OVERDUE]──> (RiskFlag)
(BusinessPartner) ──[BCA_SECTOR: IN_SECTOR]──> (Sector)
(Sector) ──[SECTOR_EXPOSURE: HAS_LIMIT]──> (RegulatoryThreshold)
```

**The graph traversal the AI performs:**
Start at BusinessPartner B-001 → find all connected parties via BP2000 → for each connected party find their loans → for each loan find open items → check due dates → calculate total group exposure → compare against regulatory thresholds → surface breach.

That is a 6-hop traversal. SQL cannot do this in one query. GraphRAG can.

---

## Why This Is Realistic

Every field in these tables exists in a real SAP TRBK implementation. Every relationship is a real banking relationship. Every risk pattern described is a real regulatory concern for Australian banks regulated by APRA.

When you show this to your client and say "this is built on the same table structure as your TRBK system" — they will recognise the data. That recognition is the moment the prototype becomes a proposal.
