// Banking Sentinel — HANA Cloud Seed Script
// Loads Data/processed/*.json files into HANA via CAP hybrid profile
// Run: node scripts/seed.js

'use strict';
const cds = require('@sap/cds');
const fs = require('fs');
const path = require('path');

const PROCESSED = path.join(__dirname, '..', 'Data', 'processed');
const RAW = path.join(__dirname, '..', 'Data');

// ─── FIELD MAPPERS ────────────────────────────────────────────────────────────

function mapBusinessPartners(rawBPs) {
  // Load story mapping to enrich BPs with sector and role data
  const storyMap = JSON.parse(fs.readFileSync(path.join(PROCESSED, 'story-mapping.json')));
  const sectorMap = {};
  [...storyMap.borrowers, ...storyMap.guarantors].forEach(bp => {
    sectorMap[bp.bp_id] = bp.sector || null;
  });

  return rawBPs
    .filter(bp => bp.BusinessPartner)
    .map(bp => ({
      PARTNER:       bp.BusinessPartner,
      BU_TYPE:       bp.BusinessPartnerCategory || '2',
      BU_SORT1:      bp.BusinessPartnerFullName || bp.BusinessPartner,
      SECTOR_CODE:   sectorMap[bp.BusinessPartner] || null,
      DTI_RATIO:     null,
      INCOME_SOURCE: null,
      INCOME_EXPIRY: null,
    }));
}

function mapBUT050(records) {
  return records.map(r => ({
    PARTNER1:   r.PARTNER1,
    PARTNER2:   r.PARTNER2,
    RELTYP:     r.RELATIONSHIP_TYPE,
    VALID_FROM: r.VALID_FROM,
    VALID_TO:   r.VALID_TO === '9999-12-31' ? '9999-12-31' : r.VALID_TO,
  }));
}

function mapLoans(records) {
  return records.map(r => ({
    LOAN_ID:       r.LOAN_ID,
    PARTNER:       r.PARTNER,
    VKONT:         r.VKONT,
    AMOUNT:        r.AMOUNT,
    CURRENCY:      r.CURRENCY || 'AUD',
    STATUS:        r.STATUS === 'ACTIVE' ? 'A' : 'C',
    SECTOR_CODE:   r.SECTOR_CODE || null,
    LOAN_TYPE:     r.PRODUCT_ID || r.LOAN_TYPE || 'LOAN',
    APPROVED_DATE: r.START_DATE || r.APPROVED_DATE,
    MATURITY_DATE: r.MATURITY_DATE,
  }));
}

function mapBCA_GUARANTOR(records) {
  return records.map(r => ({
    LOAN_ID:           r.LOAN_ID,
    GUARANTOR_PARTNER: r.GUARANTOR_PARTNER,
    GUARANTOR_NAME:    r.GUARANTOR_NAME || null,
    COVER_AMOUNT:      r.COVER_AMOUNT,
    CURRENCY:          r.CURRENCY || 'AUD',
    VALID_FROM:        r.VALID_FROM,
    VALID_TO:          r.VALID_TO,
    STATUS:            r.STATUS || 'ACTIVE',
  }));
}

function mapBCA_COLLATERAL(records) {
  return records.map(r => ({
    LOAN_ID:    r.LOAN_ID,
    COLLAT_ID:  r.COLLAT_ID,
    COLLAT_TYPE: r.COLLAT_TYPE,
    VALUE:      r.VALUE,
    CURRENCY:   r.CURRENCY || 'AUD',
  }));
}

function mapLoanSchedule(records) {
  return records.map(r => ({
    LOAN_ID:    r.LOAN_ID,
    DUE_DATE:   r.DUE_DATE,
    AMOUNT_DUE: r.AMOUNT_DUE,
    PRINCIPAL:  r.PRINCIPAL || 0,
    INTEREST:   r.INTEREST || 0,
  }));
}

function mapDFKKOP(records) {
  return records.map(r => ({
    OPBEL:        r.OPBEL,
    VKONT:        r.VKONT,
    GPART:        r.GPART,
    LOAN_ID:      r.LOAN_ID,
    BETRW:        r.BETRW,
    FAEDN:        r.FAEDN,
    BUDAT:        r.BUDAT || null,
    DAYS_OVERDUE: r.DAYS_OVERDUE,
    STATUS:       r.STATUS,
    CURRENCY:     r.CURRENCY || 'AUD',
    MAHNS:        r.MAHNS ?? 0,
  }));
}

function mapDFKKOPK(records) {
  return records.map(r => ({
    OPBEL:    r.OPBEL,
    VKONT:    r.VKONT,
    GPART:    r.GPART,
    LOAN_ID:  r.LOAN_ID,
    BETRW:    r.BETRW,
    FAEDN:    r.FAEDN,
    AUGDT:    r.AUGDT,
    AUGBL:    r.AUGBL,
    CURRENCY: r.CURRENCY || 'AUD',
    MAHNS:    r.MAHNS ?? 0,
  }));
}

function mapBCA_SECTOR(records) {
  return records.map(r => ({
    PARTNER:     r.PARTNER,
    SECTOR_CODE: r.SECTOR_CODE,
    SECTOR_NAME: r.SECTOR_NAME || r.SECTOR_CODE,
  }));
}

function mapBCA_DTI(records) {
  return records.map(r => ({
    PARTNER:       r.PARTNER,
    DTI_RATIO:     r.DTI_RATIO,
    TOTAL_DEBT:    r.TOTAL_DEBT,
    ANNUAL_INCOME: r.ANNUAL_INCOME,
    CURRENCY:      r.CURRENCY || 'AUD',
    APRA_LIMIT:    r.APRA_LIMIT || 6.0,
    BREACH_FLAG:   r.BREACH_FLAG || false,
    BREACH_DATE:   r.BREACH_DATE || null,
    INCOME_SOURCE: r.INCOME_SOURCE || null,
    INCOME_EXPIRY: r.INCOME_EXPIRY || null,
  }));
}

function mapBCA_CREDIT_HISTORY(records) {
  return records.map(r => ({
    CASE_ID:         r.CASE_ID,
    DTI_RATIO:       r.DTI_RATIO,
    TOTAL_DEBT:      r.TOTAL_DEBT,
    ANNUAL_INCOME:   r.ANNUAL_INCOME,
    BREACH_FLAG:     r.BREACH_FLAG,
    ARREARS_OUTCOME: r.ARREARS_OUTCOME,
  }));
}

function mapRegulatoryThresholds(records) {
  return records.map(r => ({
    THRESHOLD_TYPE:  r.THRESHOLD_TYPE,
    LIMIT_VALUE:     r.LIMIT_VALUE,
    LIMIT_PCT:       r.LIMIT_PCT || null,
    REGULATOR:       r.REGULATOR || 'APRA',
    EFFECTIVE_DATE:  r.EFFECTIVE_DATE,
    DESCRIPTION:     r.DESCRIPTION || r.THRESHOLD_TYPE,
  }));
}

// ─── SYNTHETIC REFERENCE DATA ─────────────────────────────────────────────────

const EXPOSURE_LIMITS = [
  { LIMIT_TYPE: 'SINGLE', LIMIT_AUD: 5000000,  NOTIFICATION_PCT: 90, REGULATOR: 'APRA' },
  { LIMIT_TYPE: 'GROUP',  LIMIT_AUD: 7500000,  NOTIFICATION_PCT: 90, REGULATOR: 'APRA' },
];

const SECTOR_LIMITS = [
  { SECTOR_CODE: 'RETAIL_PROP',  LIMIT_AUD: 50000000, LIMIT_PCT: 30, ALERT_PCT: 25 },
  { SECTOR_CODE: 'COMMERCIAL',   LIMIT_AUD: 30000000, LIMIT_PCT: 20, ALERT_PCT: 15 },
  { SECTOR_CODE: 'CONSTRUCTION', LIMIT_AUD: 20000000, LIMIT_PCT: 15, ALERT_PCT: 12 },
  { SECTOR_CODE: 'AGRICULTURE',  LIMIT_AUD: 15000000, LIMIT_PCT: 10, ALERT_PCT: 8  },
  { SECTOR_CODE: 'MINING',       LIMIT_AUD: 25000000, LIMIT_PCT: 15, ALERT_PCT: 12 },
];

// ─── MAIN SEED FUNCTION ───────────────────────────────────────────────────────

async function loadFile(filename) {
  const data = JSON.parse(fs.readFileSync(path.join(PROCESSED, filename)));
  return data.records || [];
}

async function seed() {
  console.log('\n Banking Sentinel — HANA Seed Script');
  console.log('======================================\n');

  await cds.connect.to('db');

  // CDS 8 — use fully qualified entity names as strings
  const E = {
    BusinessPartners:    'bankingsentinel.BusinessPartners',
    BUT050:              'bankingsentinel.BUT050',
    Loans:               'bankingsentinel.Loans',
    LoanSchedule:        'bankingsentinel.LoanSchedule',
    BCA_GUARANTOR:       'bankingsentinel.BCA_GUARANTOR',
    BCA_COLLATERAL:      'bankingsentinel.BCA_COLLATERAL',
    DFKKOP:              'bankingsentinel.DFKKOP',
    DFKKOPK:             'bankingsentinel.DFKKOPK',
    BCA_SECTOR:          'bankingsentinel.BCA_SECTOR',
    BCA_DTI:             'bankingsentinel.BCA_DTI',
    BCA_CREDIT_HISTORY:  'bankingsentinel.BCA_CREDIT_HISTORY',
    RegulatoryThresholds:'bankingsentinel.RegulatoryThresholds',
    ExposureLimits:      'bankingsentinel.ExposureLimits',
    SectorExposureLimits:'bankingsentinel.SectorExposureLimits',
  };

  async function insert(entity, records, label) {
    if (!records || records.length === 0) {
      console.log(`  SKIP  ${label} — no records`);
      return;
    }
    try {
      await DELETE.from(entity);
      await INSERT.into(entity).entries(records);
      console.log(`  OK    ${label} — ${records.length} records`);
    } catch (e) {
      console.error(`  FAIL  ${label} — ${e.message}`);
    }
  }

  // BusinessPartners from raw SAP sandbox data
  const rawBPs = JSON.parse(fs.readFileSync(path.join(RAW, 'ABusinessPartner.json')));
  const bpArr = rawBPs.d?.results || rawBPs.value || rawBPs;
  await insert(E.BusinessPartners, mapBusinessPartners(bpArr), 'BusinessPartners');

  // Connected party relationships (BUT050)
  await insert(E.BUT050, mapBUT050(await loadFile('BUT050.json')), 'BUT050');

  // Loans
  await insert(E.Loans, mapLoans(await loadFile('BCA_LOAN_HDR.json')), 'Loans');

  // Loan repayment schedules
  await insert(E.LoanSchedule, mapLoanSchedule(await loadFile('BCA_LOAN_SCHED.json')), 'LoanSchedule');

  // Guarantor assignments — graph edge 2
  await insert(E.BCA_GUARANTOR, mapBCA_GUARANTOR(await loadFile('BCA_GUARANTOR.json')), 'BCA_GUARANTOR');

  // Collateral assets — offsets exposure, used by pattern-agent LLM anomaly detection
  await insert(E.BCA_COLLATERAL, mapBCA_COLLATERAL(await loadFile('BCA_COLLATERAL.json')), 'BCA_COLLATERAL');

  // Open items — primary risk signal
  await insert(E.DFKKOP, mapDFKKOP(await loadFile('DFKKOP.json')), 'DFKKOP');

  // Cleared items — settled payment history (pairs with DFKKOP open items)
  await insert(E.DFKKOPK, mapDFKKOPK(await loadFile('DFKKOPK.json')), 'DFKKOPK');

  // Sector classifications
  await insert(E.BCA_SECTOR, mapBCA_SECTOR(await loadFile('BCA_SECTOR.json')), 'BCA_SECTOR');

  // DTI ratios
  await insert(E.BCA_DTI, mapBCA_DTI(await loadFile('BCA_DTI.json')), 'BCA_DTI');

  // RPT-1 in-context learning corpus — historical loan performance cases
  await insert(E.BCA_CREDIT_HISTORY, mapBCA_CREDIT_HISTORY(await loadFile('BCA_CREDIT_HISTORY.json')), 'BCA_CREDIT_HISTORY');

  // Regulatory thresholds
  await insert(E.RegulatoryThresholds, mapRegulatoryThresholds(await loadFile('RISK_THRESHOLD.json')), 'RegulatoryThresholds');

  // Exposure limits (APS 221 — synthetic reference data)
  await insert(E.ExposureLimits, EXPOSURE_LIMITS, 'ExposureLimits');

  // Sector exposure limits (synthetic reference data)
  await insert(E.SectorExposureLimits, SECTOR_LIMITS, 'SectorExposureLimits');

  console.log('\n Seed complete.\n');
  process.exit(0);
}

seed().catch(e => {
  console.error('\nSeed failed:', e);
  process.exit(1);
});
