# Task 2: Australian Banking — Real Problems & How This Prototype Solves Them

---

## The Banking Context

This prototype is built for a major Australian bank regulated by APRA (Australian Prudential Regulation Authority). The specific client is not named — the problems described below are common to all APRA-regulated Authorised Deposit-taking Institutions (ADIs) in Australia, particularly the larger banks classified as Domestic Systemically Important Banks (D-SIBs).

Australian major banks are among the most heavily regulated in the world. They operate under Basel III capital requirements adapted by APRA, with additional prudential standards that go beyond international minimums. The regulatory pressure is constant, the consequences of failure are systemic, and the expectations for AI governance are increasing rapidly.

---

## The Regulatory Environment

### APRA Standards Relevant to This Prototype

**APS 221 — Large Exposures**
Limits a bank's exposure to a single counterparty or group of connected counterparties. A connected group that individually looks healthy but collectively breaches the large exposure limit is a regulatory failure. APRA will find it during supervision even if the bank did not.

**APS 112 / APS 113 — Credit Risk Capital**
Governs how banks measure and hold capital against credit risk. Larger banks use the Internal Ratings-Based (IRB) approach — the most sophisticated and most scrutinised. Every credit decision, every risk classification, every connected party assessment is subject to APRA review.

**CPS 230 — Operational Resilience**
Came into effect July 2025. Requires banks to identify critical operations, map dependencies, and demonstrate resilience. AI systems used in risk management must be transparent, auditable, and resilient. This standard directly drives the need for AI observability and explainability.

**Debt-to-Income Limits — Activated February 2026**
APRA activated DTI limits in February 2026 restricting new lending at DTI ratios of 6 or greater. Banks must now monitor their existing book for loans approved before the limit that now breach it — creating an immediate and urgent monitoring need.

**The Hayne Royal Commission Legacy**
The 2019 Royal Commission into financial services misconduct resulted in Australian banks paying billions in remediation and regulatory costs. The core finding was consistent — risk governance failed not because data did not exist, but because it was not connected, interpreted, or acted upon in time. This prototype directly addresses that failure mode.

---

## The Real Problems

### Problem 1: Connected Party Risk Is Manual and Slow

**The real situation:**
A borrower applies for a loan. The credit analyst checks their individual financials — looks fine. Approves. What the analyst did not check — and the system did not surface — is that this borrower's guarantor also guarantees four other loans at the same bank, all in the same sector, and together their combined exposure breaches the APS 221 large exposure limit.

This is not hypothetical. Connected party risk failures contributed to the GFC, the collapse of multiple regional banks globally, and significant APRA enforcement actions in Australia.

**Why it is hard today:**
Connected party relationships sit in multiple systems — loan origination, credit risk, KYC, AML. No single system traverses all relationships in real time and calculates group exposure. Analysts do this manually using spreadsheets during credit review cycles — not continuously.

**What the prototype does:**
The Graph Traversal Agent traverses the TRBK data automatically. It finds connected parties via the BP2000 relationship table, calculates group exposure across all loans, compares against regulatory thresholds, and surfaces the breach before it becomes a regulatory finding.

---

### Problem 2: Credit Risk Early Warning Signals Are Missed

**The real situation:**
A borrower misses one payment. The system records the open item in DFKKOP. The collections team contacts the borrower. Isolated event — managed.

But what if that same borrower has a co-guarantor who is also showing early payment stress? And both are connected to a third party who has just had a credit facility reduced elsewhere? The pattern indicates systemic stress — not an isolated missed payment. Today that pattern is invisible until a credit review cycle runs — quarterly at best.

**What the prototype does:**
The Risk Scoring Agent runs continuously. It detects the pattern across the graph — borrower stress plus guarantor stress plus connected party credit events — and generates an early warning brief before the next quarterly review.

---

### Problem 3: APRA Reporting Is Reactive Not Proactive

**The real situation:**
Banks submit detailed risk data to APRA under APS 330 Public Disclosure requirements. This data is historical — it describes what happened last quarter. APRA increasingly expects banks to demonstrate forward-looking risk management — identifying risks before they crystallise.

The DTI limit activation in February 2026 is a perfect example. Banks must now identify which borrowers in their existing book breach the new limit, understand their connected relationships, and assess total exposure.

**What the prototype does:**
The Policy Agent runs Hybrid RAG against APRA prudential standards stored in the knowledge base. When the Risk Agent identifies a potential breach, the Policy Agent surfaces the specific regulatory reference, the threshold, and the current utilisation. The risk brief becomes APRA-ready documentation — not a manual compliance exercise.

---

### Problem 4: Sector Concentration Is Discovered Too Late

**The real situation:**
The Australian residential property sector accounts for the majority of Australian bank lending. Banks manage this concentration carefully — but sector exposure data is aggregated monthly, not monitored in real time at the relationship level.

When interest rates rise rapidly, sector stress hits multiple borrowers simultaneously. The bank discovers its concentration too late to manage it proactively.

**What the prototype does:**
The Graph Traversal Agent finds sector clustering — multiple borrowers in the same sector connected through shared guarantors. The Risk Agent scores the combined exposure. The bank sees sector concentration risk at the relationship level, not just the aggregate level.

---

### Problem 5: AI Governance and Explainability

**The real situation:**
Australian banks are investing heavily in AI. But APRA's message is clear: "AI can be a valuable co-pilot — but it should never be your autopilot." Every AI decision in a regulated context must be explainable, auditable, and have human oversight.

**What the prototype demonstrates:**
Every agent decision is visible in the UI — which graph hops were made, which policy documents were retrieved, what confidence score was assigned, why the Risk Agent re-queried. Langfuse traces every call. RAGAS scores every retrieval. The risk brief includes an evidence trail linking every finding to source TRBK data.

This is not just an AI demo. It is a demonstration of governed, explainable, auditable AI — exactly what APRA expects.

---

## The Prototype's Value Proposition

**In one sentence:**
An AI system that continuously monitors TRBK data, traverses connected party relationships the way a skilled analyst would, and surfaces regulatory risk before APRA finds it — with a full evidence trail that satisfies CPS 230 audit requirements.

**What it replaces:**
Manual quarterly credit review cycles for connected party exposure.

**What it adds:**
Continuous, automated, explainable risk intelligence on the same HANA data that already exists in TRBK.

**Why SAP BTP:**
TRBK data is already in HANA. Building on SAP BTP means no data movement, no new infrastructure, no security exceptions. The AI lives where the data lives.

---

## One Sentence for Any Client Meeting

"This prototype listens to your TRBK data the way a skilled risk analyst would — except it works continuously, never misses a connected party relationship, and produces a regulatory-ready risk brief with a full evidence trail."
