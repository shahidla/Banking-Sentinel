// Banking Sentinel — CAP Service Definition
// AI: Exposes the LangGraph agent graph via OData and A2A protocol
// Banking: Entry point for all risk intelligence queries (and Joule in enterprise)
// SAP: CAP service — actions map to LangGraph graph invocations

using { bankingsentinel } from '../db/schema';

service BankingSentinelService {

  // A2A primary entry point — called by HTML UI and Joule
  // JSON-RPC 2.0 wrapper handled by /a2a/agent Express route in server.js
  action analyseRisk(query: String, customerId: String, sessionId: String) returns String;

  // Human-in-the-loop resume — risk officer approves after interrupt()
  action approveRiskBrief(sessionId: String) returns Boolean;

  // Regulatory document upload — Twinkle 2: zero code change policy update
  action uploadRegulatoryDocument(content: String, title: String, standard: String) returns Boolean;

  // Session management
  action resetSession(sessionId: String) returns Boolean;

  // OData entity projections — visible in CAP explorer and for reporting
  entity RiskAssessments    as projection on bankingsentinel.RiskAssessments;
  entity RegulatoryDocuments as projection on bankingsentinel.RegulatoryDocuments;
  entity AuditLog           as projection on bankingsentinel.AuditLog;

}
