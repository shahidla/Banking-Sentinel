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

function mapBPRoles(rawRoles) {
  return rawRoles
    .filter(r => r.BusinessPartner && r.BusinessPartnerRole)
    .map(r => ({
      PARTNER: r.BusinessPartner,
      RLTYP:   r.BusinessPartnerRole,
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

function mapBKKN(records) {
  return records.map(r => ({
    VKONT: r.VKONT,
    GPART: r.GPART || r.PARTNER,
    ABWKN: null,
  }));
}

function mapLoanConditions(records) {
  return records.map(r => ({
    LOAN_ID:    r.LOAN_ID,
    COND_TYPE:  'ZINS',
    RATE:       r.INTEREST_RATE,
    VALID_FROM: r.VALID_FROM || r.START_DATE || '2020-01-01',
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
  }));
}

function mapDFKKZP(records) {
  return records.map(r => ({
    PAYMENT_ID: r.ZPBEL || r.PAYMENT_ID,  // ZPBEL is the SAP payment document number
    LOAN_ID:    r.LOAN_ID,
    PARTNER:    r.GPART || r.PARTNER,
    BETRW:      r.BETRW,
    BUDAT:      r.BUDAT,
    AUGBL:      r.AUGBL || null,
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

// Risk class based on story — B-001, B-002, B-003 are stressed
const BCA_RISK_CLASS = [
  { LOAN_ID: 'L-001', RISK_CATEGORY: 'WATCHLIST',     RATING: 'BB',  RATED_AT: new Date().toISOString() },
  { LOAN_ID: 'L-002', RISK_CATEGORY: 'WATCHLIST',     RATING: 'BB',  RATED_AT: new Date().toISOString() },
  { LOAN_ID: 'L-003', RISK_CATEGORY: 'NON_PERFORMING',RATING: 'CCC', RATED_AT: new Date().toISOString() },
  { LOAN_ID: 'L-004', RISK_CATEGORY: 'WATCHLIST',     RATING: 'BB-', RATED_AT: new Date().toISOString() },
  { LOAN_ID: 'L-005', RISK_CATEGORY: 'WATCHLIST',     RATING: 'BB',  RATED_AT: new Date().toISOString() },
  { LOAN_ID: 'L-006', RISK_CATEGORY: 'PERFORMING',    RATING: 'BBB', RATED_AT: new Date().toISOString() },
  { LOAN_ID: 'L-007', RISK_CATEGORY: 'PERFORMING',    RATING: 'A',   RATED_AT: new Date().toISOString() },
  { LOAN_ID: 'L-008', RISK_CATEGORY: 'PERFORMING',    RATING: 'BBB', RATED_AT: new Date().toISOString() },
  { LOAN_ID: 'L-009', RISK_CATEGORY: 'PERFORMING',    RATING: 'A-',  RATED_AT: new Date().toISOString() },
  { LOAN_ID: 'L-010', RISK_CATEGORY: 'PERFORMING',    RATING: 'A',   RATED_AT: new Date().toISOString() },
  { LOAN_ID: 'L-011', RISK_CATEGORY: 'PERFORMING',    RATING: 'AA',  RATED_AT: new Date().toISOString() },
  { LOAN_ID: 'L-012', RISK_CATEGORY: 'WATCHLIST',     RATING: 'BB',  RATED_AT: new Date().toISOString() },
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
    BPRoles:             'bankingsentinel.BPRoles',
    BUT050:              'bankingsentinel.BUT050',
    BKKN:                'bankingsentinel.BKKN',
    Loans:               'bankingsentinel.Loans',
    LoanConditions:      'bankingsentinel.LoanConditions',
    LoanSchedule:        'bankingsentinel.LoanSchedule',
    BCA_GUARANTOR:       'bankingsentinel.BCA_GUARANTOR',
    DFKKOP:              'bankingsentinel.DFKKOP',
    DFKKZP:              'bankingsentinel.DFKKZP',
    BCA_SECTOR:          'bankingsentinel.BCA_SECTOR',
    BCA_DTI:             'bankingsentinel.BCA_DTI',
    BCA_RISK_CLASS:      'bankingsentinel.BCA_RISK_CLASS',
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

  // BP Roles
  const rawRoles = JSON.parse(fs.readFileSync(path.join(RAW, 'ABusinessPartnerRole.json')));
  const rolesArr = rawRoles.d?.results || rawRoles.value || rawRoles;
  await insert(E.BPRoles, mapBPRoles(rolesArr), 'BPRoles');

  // Connected party relationships (BUT050)
  await insert(E.BUT050, mapBUT050(await loadFile('BUT050.json')), 'BUT050');

  // Contract account to BP links
  await insert(E.BKKN, mapBKKN(await loadFile('BKKN.json')), 'BKKN');

  // Loans
  await insert(E.Loans, mapLoans(await loadFile('BCA_LOAN_HDR.json')), 'Loans');

  // Loan conditions (interest rates)
  await insert(E.LoanConditions, mapLoanConditions(await loadFile('BCA_LOAN_COND.json')), 'LoanConditions');

  // Loan repayment schedules
  await insert(E.LoanSchedule, mapLoanSchedule(await loadFile('BCA_LOAN_SCHED.json')), 'LoanSchedule');

  // Guarantor assignments — graph edge 2
  await insert(E.BCA_GUARANTOR, mapBCA_GUARANTOR(await loadFile('BCA_GUARANTOR.json')), 'BCA_GUARANTOR');

  // Open items — primary risk signal
  await insert(E.DFKKOP, mapDFKKOP(await loadFile('DFKKOP.json')), 'DFKKOP');

  // Payment records
  await insert(E.DFKKZP, mapDFKKZP(await loadFile('DFKKZP.json')), 'DFKKZP');

  // Sector classifications
  await insert(E.BCA_SECTOR, mapBCA_SECTOR(await loadFile('BCA_SECTOR.json')), 'BCA_SECTOR');

  // DTI ratios
  await insert(E.BCA_DTI, mapBCA_DTI(await loadFile('BCA_DTI.json')), 'BCA_DTI');

  // Risk classifications (synthetic — aligned with story)
  await insert(E.BCA_RISK_CLASS, BCA_RISK_CLASS, 'BCA_RISK_CLASS');

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
