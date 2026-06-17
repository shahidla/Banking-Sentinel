// Banking Sentinel — HANA Cloud Schema
// AI: Entity graph for multi-hop relationship traversal and vector RAG
// Banking: SAP TRBK table structure for connected party risk detection
// SAP: CDS entities mapped to HANA Cloud — relational, graph, and vector engines

namespace bankingsentinel;

// ─── BUSINESS PARTNER ───────────────────────────────────────────────────────

@NLP.label: 'Customers and business partners — demo borrowers: 301xxxx, guarantors: 309xxxx'
entity BusinessPartners {
  key PARTNER       : String(10);    // SAP BP number
  @title: 'Partner Type Code'
  @NLP.label: 'Partner type code: 1=person, 2=organisation — NOT a name, never use for name lookups'
  BU_TYPE           : String(2);
  @title: 'Customer / Business Partner Name'
  BU_SORT1          : String(50);
  SECTOR_CODE       : String(20);    // RETAIL_PROP, COMMERCIAL, CONSTRUCTION, AGRICULTURE, MINING
  DTI_RATIO         : Decimal(5,2);
  INCOME_SOURCE     : String(100);   // contract employer name
  INCOME_EXPIRY     : Date;          // contract end date — trajectory signal

  // Unmanaged associations — FK already exists as PARTNER in this entity
  @NLP.joinType: 'LEFT'
  dti           : Association to BCA_DTI        on dti.PARTNER     = PARTNER;
  loans         : Association to many Loans     on loans.PARTNER   = PARTNER;
  payments      : Association to many DFKKOP    on payments.GPART  = PARTNER;
  history       : Association to many DFKKOPK   on history.GPART   = PARTNER;
}

// AI: Graph edge table 1 — connected party relationships
// Banking: Family trust, guarantor network, subsidiary structures — APS 221 exposure chains
// SAP: BUT050
@NLP.label: 'Business partner relationships — connected parties, family trusts, subsidiaries'
entity BUT050 {
  key PARTNER1      : String(10);
  key PARTNER2      : String(10);
  key RELTYP        : String(30);    // FAMILY_TRUST_MEMBER, CONTACT_PERSON, SUBSIDIARY
  VALID_FROM        : Date;
  VALID_TO          : Date;

  partner1 : Association to BusinessPartners on partner1.PARTNER = PARTNER1;
  partner2 : Association to BusinessPartners on partner2.PARTNER = PARTNER2;
}

// ─── LOANS ───────────────────────────────────────────────────────────────────

@NLP.label: 'Loan accounts — borrower, amount, status, maturity'
entity Loans {
  key LOAN_ID       : String(15);
  PARTNER           : String(10);    // borrower BP number
  @title: 'Contract Account'
  VKONT             : String(20);
  AMOUNT            : Decimal(15,2); // AUD
  CURRENCY          : String(3);
  @title: 'Loan Status'
  @Common.Text: status.TEXT
  STATUS            : String(1);
  SECTOR_CODE       : String(20);
  LOAN_TYPE         : String(10);    // HOME, INVEST, PERSONAL, BUSINESS, TERM_DEP
  APPROVED_DATE     : Date;
  MATURITY_DATE     : Date;

  customer   : Association to BusinessPartners on customer.PARTNER   = PARTNER;
  schedule   : Association to many LoanSchedule on schedule.LOAN_ID  = LOAN_ID;
  guarantors : Association to many BCA_GUARANTOR on guarantors.LOAN_ID = LOAN_ID;
  payments   : Association to many DFKKOP       on payments.LOAN_ID  = LOAN_ID;
  // Value help (SAP-standard pattern): adding a new status is an INSERT into
  // LoanStatusCodes, never a schema change/redeploy — unlike a hardcoded enum.
  status     : Association to LoanStatusCodes  on status.CODE       = STATUS;
}

// SAP-standard value-help check table — adding a new loan status is a data INSERT here,
// never a schema/code change. Demonstrates @Common.Text vs the hardcoded-enum approach.
@NLP.label: 'Loan status code lookup — value-help check table for Loans.STATUS'
entity LoanStatusCodes {
  key CODE : String(1);
  TEXT     : String(20);
}

@NLP.label: 'Repayment schedule — the contractual due dates/amounts per loan. No status column here. For "missed", "overdue", or "unpaid scheduled payment" questions, do NOT query this entity — query DFKKOP instead and filter STATUS=OPEN (an open DFKKOP item IS the missed/overdue scheduled payment). This entity is only useful for due dates and instalment amounts, not payment status'
entity LoanSchedule {
  key LOAN_ID       : String(15);
  key DUE_DATE      : Date;
  AMOUNT_DUE        : Decimal(15,2); // AUD
  PRINCIPAL         : Decimal(15,2);
  INTEREST          : Decimal(15,2);

  loan : Association to Loans on loan.LOAN_ID = LOAN_ID;
}

@NLP.label: 'Loan guarantors — who guarantees which loan, cover amount'
entity BCA_GUARANTOR {
  key LOAN_ID           : String(15);
  key GUARANTOR_PARTNER : String(10);   // guarantor BP number
  GUARANTOR_NAME        : String(80);
  COVER_AMOUNT          : Decimal(15,2); // AUD
  CURRENCY              : String(3);
  VALID_FROM            : Date;
  VALID_TO              : Date;
  @NLP.label: 'Guarantee status: "ACTIVE" or "EXPIRED"'
  STATUS                : String(10);

  loan     : Association to Loans            on loan.LOAN_ID         = LOAN_ID;
  guarantor: Association to BusinessPartners on guarantor.PARTNER    = GUARANTOR_PARTNER;
  // "guarantors who are also borrowers" — check if guarantor BP is also a loan borrower
  asLoan   : Association to Loans            on asLoan.PARTNER       = GUARANTOR_PARTNER;
}

@NLP.label: 'Collateral assets pledged against a loan — property, vehicle, cash'
entity BCA_COLLATERAL {
  key LOAN_ID       : String(15);
  key COLLAT_ID     : String(15);
  @NLP.label: 'Collateral type: PROPERTY, VEHICLE, or CASH — always include this when describing what collateral is held, not just the value'
  COLLAT_TYPE       : String(10);
  VALUE             : Decimal(15,2); // AUD
  CURRENCY          : String(3);

  loan : Association to Loans on loan.LOAN_ID = LOAN_ID;
}

// ─── TRANSACTIONS AND RISK SIGNALS ───────────────────────────────────────────

@NLP.label: 'Open payment items — current ledger; STATUS=OPEN means unpaid or overdue, CLEARED means paid'
entity DFKKOP {
  key OPBEL         : String(20);    // document number
  @NLP.label: 'Contract account number (SAP FI-CA field) — an account identifier, not a customer or loan ID'
  VKONT             : String(20);
  @NLP.label: 'Business partner / customer ID (SAP FI-CA field name for partner) — join to BusinessPartners.PARTNER for customer details'
  GPART             : String(10);
  LOAN_ID           : String(15);
  @NLP.label: 'Payment amount in AUD (SAP FI-CA field, German "Betrag" = amount)'
  BETRW             : Decimal(15,2);
  FAEDN             : Date;          // due date
  BUDAT             : Date;          // posting date
  DAYS_OVERDUE      : Integer;
  @NLP.label: 'Item status: "OPEN" (unpaid/overdue) or "CLEARED" (paid)'
  STATUS            : String(10);
  CURRENCY          : String(3);
  @NLP.label: 'Dunning (payment reminder) level, 0-3. Higher = more overdue reminders sent'
  MAHNS             : Integer;

  customer : Association to BusinessPartners on customer.PARTNER = GPART;
  loan     : Association to Loans            on loan.LOAN_ID     = LOAN_ID;
  @NLP.joinType: 'LEFT'
  dti      : Association to BCA_DTI          on dti.PARTNER      = GPART;
}

@NLP.label: 'Cleared payment history — settled instalments, track record before current schedule window'
entity DFKKOPK {
  key OPBEL         : String(20);    // history document number: OP-Lxxx-Hnn
  @NLP.label: 'Contract account number (SAP FI-CA field) — an account identifier, not a customer or loan ID'
  VKONT             : String(20);
  @NLP.label: 'Business partner / customer ID (SAP FI-CA field name for partner) — join to BusinessPartners.PARTNER for customer details'
  GPART             : String(10);
  LOAN_ID           : String(15);
  @NLP.label: 'Payment amount cleared, in AUD (SAP FI-CA field, German "Betrag" = amount)'
  BETRW             : Decimal(15,2);
  FAEDN             : Date;          // original due date
  @NLP.label: 'Clearing date — the date this payment was actually applied/settled'
  AUGDT             : Date;
  @NLP.label: 'Clearing document number — reference ID for the settlement transaction'
  AUGBL             : String(20);
  CURRENCY          : String(3);
  @NLP.label: 'Dunning (payment reminder) level, 0-3. Higher = more overdue reminders sent before this was cleared'
  MAHNS             : Integer;

  customer : Association to BusinessPartners on customer.PARTNER = GPART;
  loan     : Association to Loans            on loan.LOAN_ID     = LOAN_ID;
}

@NLP.label: 'Customer sector classification — industry grouping for concentration risk'
entity BCA_SECTOR {
  key PARTNER       : String(10);
  SECTOR_CODE       : String(20);
  SECTOR_NAME       : String(50);

  customer : Association to BusinessPartners on customer.PARTNER = PARTNER;
}

@NLP.label: 'Debt-to-income ratios — BREACH_FLAG=true means DTI exceeds APRA 6.0 limit'
entity BCA_DTI {
  key PARTNER       : String(10);
  DTI_RATIO         : Decimal(5,2);  // e.g. 7.2 = 720% of annual income
  TOTAL_DEBT        : Decimal(15,2); // AUD
  ANNUAL_INCOME     : Decimal(15,2); // AUD
  CURRENCY          : String(3);
  APRA_LIMIT        : Decimal(5,2);  // 6.0 as of Feb 2026
  BREACH_FLAG       : Boolean;       // true if DTI > APRA limit
  BREACH_DATE       : Date;
  INCOME_SOURCE     : String(100);
  INCOME_EXPIRY     : Date;          // income contract end — forward DTI signal

  customer : Association to BusinessPartners on customer.PARTNER = PARTNER;
  payments : Association to many DFKKOP      on payments.GPART   = PARTNER;
  loans    : Association to many Loans       on loans.PARTNER    = PARTNER;
}

@NLP.label: 'Historical credit outcomes — closed loan book with observed arrears results (RPT-1 training corpus)'
entity BCA_CREDIT_HISTORY {
  key CASE_ID        : String(10);   // HIST-0001..HIST-0200
  DTI_RATIO          : Decimal(5,2);
  TOTAL_DEBT         : Decimal(15,2);
  ANNUAL_INCOME      : Decimal(15,2);
  BREACH_FLAG        : Boolean;
  ARREARS_OUTCOME    : String(10);   // LOW / MEDIUM / HIGH / CRITICAL
}

// ─── REGULATORY REFERENCE DATA ───────────────────────────────────────────────

@NLP.label: 'APRA regulatory thresholds — APS 221 large exposure, DTI limit, sector limits'
entity RegulatoryThresholds {
  key THRESHOLD_TYPE  : String(30);  // APS221_LARGE_EXPOSURE, DTI_LIMIT, SECTOR_LIMIT
  LIMIT_VALUE         : Decimal(15,2);
  LIMIT_PCT           : Decimal(5,2);
  REGULATOR           : String(10);  // APRA
  EFFECTIVE_DATE      : Date;
  DESCRIPTION         : String(200);
}

@NLP.label: 'Per-customer credit exposure limits — APS 221 single and group counterparty caps'
entity ExposureLimits {
  key LIMIT_TYPE    : String(20);    // SINGLE, GROUP
  LIMIT_AUD         : Decimal(15,2);
  NOTIFICATION_PCT  : Decimal(5,2); // board notification threshold e.g. 90%
  REGULATOR         : String(10);
}

@NLP.label: 'Sector concentration limits — maximum portfolio exposure per industry sector'
entity SectorExposureLimits {
  key SECTOR_CODE       : String(20);
  LIMIT_AUD         : Decimal(15,2);
  LIMIT_PCT         : Decimal(5,2); // % of total portfolio
  ALERT_PCT         : Decimal(5,2);
}

// ─── AI SYSTEM TABLES ─────────────────────────────────────────────────────────

@NLP.label: 'Risk assessment outputs — persisted LangGraph synthesis results, APRA audit trail'
entity RiskAssessments {
  key SESSION_ID    : String(36);    // UUID
  PARTNER           : String(10);
  RISK_SCORE        : Integer;       // 0-100
  RISK_LEVEL        : String(10);    // LOW / MEDIUM / HIGH / CRITICAL
  FINDINGS          : LargeString;   // JSON array
  CONFIDENCE        : Decimal(3,2);
  APPROVED_BY       : String(50);
  APPROVED_AT       : DateTime;
  CREATED_AT        : DateTime;
}

@NLP.label: 'APRA regulatory documents — chunked and embedded for vector RAG search'
entity RegulatoryDocuments {
  key DOC_ID        : String(36);    // UUID
  TITLE             : String(200);
  STANDARD          : String(20);    // APS221, CPS230, DTI_NOTICE
  CONTENT           : LargeString;
  EMBEDDING         : LargeString;   // JSON float array — switch to Vector(1536) in CDS 10
  UPLOADED_AT       : DateTime;
}

@NLP.label: 'Audit log — every LLM call traced for CPS 230 compliance and LLMOps'
entity AuditLog {
  key LOG_ID        : String(36);    // UUID
  SESSION_ID        : String(36);
  ACTION            : String(100);   // risk_analysis, simple_query, rejection, approval
  QUERY             : LargeString;
  RESPONSE          : LargeString;
  MODEL             : String(50);
  TOKENS_IN         : Integer;
  TOKENS_OUT        : Integer;
  COST_AUD          : Decimal(8,4);
  LATENCY_MS        : Integer;
  CREATED_AT        : DateTime;
}
