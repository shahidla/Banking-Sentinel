// Banking Sentinel — HANA Cloud Schema
// AI: Entity graph for multi-hop relationship traversal and vector RAG
// Banking: SAP TRBK table structure for connected party risk detection
// SAP: CDS entities mapped to HANA Cloud — relational, graph, and vector engines

namespace bankingsentinel;

// ─── BUSINESS PARTNER ───────────────────────────────────────────────────────

// AI: Primary node in the borrower relationship graph
// Banking: Customer master — every borrower, guarantor, and corporate entity
// SAP: BUT000 — Business Partner master table in SAP TRBK
entity BusinessPartners {
  key PARTNER       : String(10);
  BU_TYPE           : String(2);    // 1=person, 2=organisation
  BU_SORT1          : String(50);   // name
  SECTOR_CODE       : String(20);   // RETAIL_PROP, COMMERCIAL etc
  DTI_RATIO         : Decimal(5,2);
  INCOME_SOURCE     : String(100);  // contract employer name
  INCOME_EXPIRY     : Date;         // contract end date — trajectory signal
}

// AI: Graph edge table 1 — connected party relationships
// Banking: Family trust, guarantor network, subsidiary structures — APS 221 exposure chains
// SAP: BUT050 (NOT BP2000 — confirmed by bank architects, BP2000 does not exist in TRBK)
entity BUT050 {
  key PARTNER1      : String(10);
  key PARTNER2      : String(10);
  key RELTYP        : String(30);   // FAMILY_TRUST_MEMBER, CONTACT_PERSON, SUBSIDIARY
  VALID_FROM        : Date;
  VALID_TO          : Date;
}

// ─── LOANS ───────────────────────────────────────────────────────────────────

// AI: Loan node — primary financial exposure unit
// Banking: The loan record — amount, currency, status, approval date
// SAP: BCA_LOAN_HDR — Loan header
entity Loans {
  key LOAN_ID       : String(15);
  PARTNER           : String(10);
  VKONT             : String(20);
  AMOUNT            : Decimal(15,2);
  CURRENCY          : String(3);    // AUD
  STATUS            : String(1);    // A=active, C=closed
  SECTOR_CODE       : String(20);
  LOAN_TYPE         : String(10);   // HOME, INVEST, PERSONAL, BUSINESS, TERM_DEP
  APPROVED_DATE     : Date;
  MATURITY_DATE     : Date;
}

// AI: Repayment schedule node — expected cash flow pattern
// Banking: When payments are due — baseline for identifying missed payments
// SAP: BCA_LOAN_SCHED — Repayment schedule
entity LoanSchedule {
  key LOAN_ID       : String(15);
  key DUE_DATE      : Date;
  AMOUNT_DUE        : Decimal(15,2);
  PRINCIPAL         : Decimal(15,2);
  INTEREST          : Decimal(15,2);
}

// AI: Graph edge table 2 — guarantor assignments
// Banking: Who guarantees which loan — creates exposure consolidation obligation under APS 221
// SAP: BCA_GUARANTOR — Guarantor assignment
entity BCA_GUARANTOR {
  key LOAN_ID           : String(15);
  key GUARANTOR_PARTNER : String(10);   // guarantor BP number
  GUARANTOR_NAME        : String(80);
  COVER_AMOUNT          : Decimal(15,2);
  CURRENCY              : String(3);
  VALID_FROM            : Date;
  VALID_TO              : Date;
  STATUS                : String(10);   // ACTIVE, EXPIRED
}

// AI: Collateral node — security value offsetting exposure
// Banking: Property or asset pledged against the loan
// SAP: BCA_COLLATERAL — Collateral
entity BCA_COLLATERAL {
  key LOAN_ID       : String(15);
  key COLLAT_ID     : String(15);
  COLLAT_TYPE       : String(10);   // PROPERTY, VEHICLE, CASH
  VALUE             : Decimal(15,2);
  CURRENCY          : String(3);
}

// ─── TRANSACTIONS AND RISK SIGNALS ───────────────────────────────────────────

// AI: Primary risk signal node — overdue payment detection
// Banking: Open items = missed or partial payments. Absence of DFKKZP match = confirmed missed payment
// SAP: DFKKOP — Open items (financial accounting)
entity DFKKOP {
  key OPBEL         : String(20);   // document number
  VKONT             : String(20);   // contract account
  GPART             : String(10);   // business partner (SAP FI-CA field name)
  LOAN_ID           : String(15);
  BETRW             : Decimal(15,2); // amount
  FAEDN             : Date;          // due date
  BUDAT             : Date;          // posting date (null if not cleared)
  DAYS_OVERDUE      : Integer;
  STATUS            : String(10);    // OPEN, CLEARED
  CURRENCY          : String(3);
}

// AI: Sector classification node — concentration risk grouping
// Banking: Industry sector of borrower — used to calculate portfolio concentration against internal limits
// SAP: BCA_SECTOR — Industry sector classification
entity BCA_SECTOR {
  key PARTNER       : String(10);
  SECTOR_CODE       : String(20);
  SECTOR_NAME       : String(50);
}

// AI: DTI ratio node — regulatory breach detection input
// Banking: Debt-to-income ratio — APRA February 2026 limit is 6.0. Income expiry creates trajectory signal
// SAP: BCA_DTI — Debt to income ratio
entity BCA_DTI {
  key PARTNER       : String(10);
  DTI_RATIO         : Decimal(5,2);
  TOTAL_DEBT        : Decimal(15,2);
  ANNUAL_INCOME     : Decimal(15,2);
  CURRENCY          : String(3);
  APRA_LIMIT        : Decimal(5,2);  // 6.0 as of Feb 2026
  BREACH_FLAG       : Boolean;
  BREACH_DATE       : Date;          // date limit was activated / breach detected
  INCOME_SOURCE     : String(100);   // contract employer — trajectory signal
  INCOME_EXPIRY     : Date;          // contract end — future DTI signal for Trajectory Agent
}

// ─── REGULATORY REFERENCE DATA ───────────────────────────────────────────────

// AI: Policy threshold node — regulatory limit lookup for threshold breach detection
// Banking: APRA prudential limits — APS 221 large exposure, DTI limit (Feb 2026)
// SAP: RISK_THRESHOLD — synthetic regulatory thresholds table
entity RegulatoryThresholds {
  key THRESHOLD_TYPE  : String(30);  // APS221_LARGE_EXPOSURE, DTI_LIMIT, SECTOR_LIMIT
  LIMIT_VALUE         : Decimal(15,2);
  LIMIT_PCT           : Decimal(5,2); // percentage limit where applicable
  REGULATOR           : String(10);   // APRA
  EFFECTIVE_DATE      : Date;
  DESCRIPTION         : String(200);
}

// AI: Exposure limit node — single and group borrower limits
// Banking: APS 221 single counterparty and connected group limits
// SAP: EXPOSURE_LIMIT — synthetic exposure limits table
entity ExposureLimits {
  key LIMIT_TYPE    : String(20);    // SINGLE, GROUP
  LIMIT_AUD         : Decimal(15,2);
  NOTIFICATION_PCT  : Decimal(5,2);  // board notification threshold (e.g. 90%)
  REGULATOR         : String(10);
}

// AI: Sector concentration limit node
// Banking: Internal portfolio limits by sector — concentration risk management
// SAP: SECTOR_EXPOSURE — synthetic sector exposure limits table
entity SectorExposureLimits {
  key SECTOR_CODE       : String(20);
  LIMIT_AUD         : Decimal(15,2);
  LIMIT_PCT         : Decimal(5,2);  // % of total portfolio
  ALERT_PCT         : Decimal(5,2);  // alert threshold
}

// ─── AI SYSTEM TABLES ─────────────────────────────────────────────────────────

// AI: Risk assessment output — persisted LangGraph synthesis result
// Banking: The APRA-ready risk brief — audit trail for CPS 230 compliance
// SAP: RiskAssessments — Banking Sentinel output table
entity RiskAssessments {
  key SESSION_ID    : String(36);    // UUID — LangGraph thread_id
  PARTNER           : String(10);
  RISK_SCORE        : Integer;       // 0-100
  RISK_LEVEL        : String(10);    // LOW/MEDIUM/HIGH/CRITICAL
  FINDINGS          : LargeString;   // JSON array of findings
  CONFIDENCE        : Decimal(3,2);  // 0.00-1.00
  APPROVED_BY       : String(50);    // human-in-the-loop approver
  APPROVED_AT       : DateTime;
  CREATED_AT        : DateTime;
}

// AI: Vector store — APRA regulatory documents embedded for semantic search
// Banking: Live regulatory knowledge base — upload new APRA doc, system applies immediately (Twinkle 2)
// SAP: RegulatoryDocuments — HANA Vector Engine table (switch EMBEDDING to Vector(1536) with CDS 10)
entity RegulatoryDocuments {
  key DOC_ID        : String(36);    // UUID
  TITLE             : String(200);
  STANDARD          : String(20);    // APS221, CPS230, DTI_NOTICE etc
  CONTENT           : LargeString;
  EMBEDDING         : LargeString;   // JSON array — switch to Vector(1536) when CDS 10 available
  UPLOADED_AT       : DateTime;
}

// AI: Audit log — every LLM call traced for LLMOps and regulatory compliance
// Banking: CPS 230 requires every AI decision to be auditable — who asked, what was reasoned, what was recommended
// SAP: AuditLog — cost tracking + compliance trail
entity AuditLog {
  key LOG_ID        : String(36);    // UUID
  SESSION_ID        : String(36);
  ACTION            : String(100);   // risk_analysis, simple_query, rejection, approval
  QUERY             : LargeString;
  RESPONSE          : LargeString;
  MODEL             : String(50);    // claude-sonnet-4-6, claude-opus-4-7
  TOKENS_IN         : Integer;
  TOKENS_OUT        : Integer;
  COST_AUD          : Decimal(8,4);  // calculated per analysis
  LATENCY_MS        : Integer;
  CREATED_AT        : DateTime;
}
