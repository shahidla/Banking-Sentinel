'use strict';

// Single source of truth for all queryable entities.
// Used by simple-query.js to validate descriptors and build CDS queries.
//
// Backend: SAP HANA Cloud via SAP CAP/CDS.
// CDS resolves HANA HDI table names internally — raw SQL cannot access them.
//
// Column types drive condition evaluation in JS (post-fetch):
//   Boolean  — HANA stores as 1/0; CDS returns true/false; LLM "true"/"false" strings normalised
//   Decimal  — parseFloat comparison
//   Integer  — parseInt comparison
//   Date     — Date object comparison (within_days / days_ago operators)
//   String   — equality or like (case-insensitive contains)
//
// joins: named relationship aliases.
//   from:  column in this entity that is the FK
//   to:    column in the target entity (usually its PK)
//   type:  INNER = both sides must exist (mandatory relationship — drops unmatched rows)
//          LEFT  = optional relationship — keeps main row even with no join match
//
// Cardinality rules applied here:
//   INNER — every <from> entity row is guaranteed to have a matching <to> row in production data
//   LEFT  — relationship is optional or the join entity may not have a record for every main row

const SCHEMA = {

  BusinessPartners: {
    label: 'Customers / business partners (demo: 301xxxx; guarantors: 309xxxx)',
    key: 'PARTNER',
    columns: {
      PARTNER:       'String',   // SAP BP number (demo customers: 30100001–30100013)
      BU_SORT1:      'String',   // customer name (use BU_SORT1, NOT "NAME" — that field does not exist)
      BU_TYPE:       'String',   // 1=person, 2=organisation
      SECTOR_CODE:   'String',
      DTI_RATIO:     'Decimal',
      INCOME_SOURCE: 'String',
      INCOME_EXPIRY: 'Date'
    },
    joins: {
      loans:    { entity: 'Loans',   from: 'PARTNER', to: 'PARTNER', type: 'INNER' },
      dti:      { entity: 'BCA_DTI', from: 'PARTNER', to: 'PARTNER', type: 'LEFT'  },
      payments: { entity: 'DFKKOP',  from: 'PARTNER', to: 'GPART',   type: 'LEFT'  }
    }
  },

  BUT050: {
    label: 'Business partner relationships (connected parties / guarantor networks)',
    key: 'PARTNER1',
    columns: {
      PARTNER1:   'String',
      PARTNER2:   'String',
      RELTYP:     'String',   // relationship type: FAMILY_TRUST_MEMBER, CONTACT_PERSON, SUBSIDIARY
      VALID_FROM: 'Date',
      VALID_TO:   'Date'
    },
    joins: {
      partner1: { entity: 'BusinessPartners', from: 'PARTNER1', to: 'PARTNER', type: 'INNER' },
      partner2: { entity: 'BusinessPartners', from: 'PARTNER2', to: 'PARTNER', type: 'INNER' }
    }
  },

  Loans: {
    label: 'Loan accounts',
    key: 'LOAN_ID',
    columns: {
      LOAN_ID:       'String',
      PARTNER:       'String',   // borrower customer ID
      TYPE:          'String',   // LOAN_TYPE field
      AMOUNT:        'Decimal',  // AUD
      INTEREST_RATE: 'Decimal',
      STATUS:        'String',   // A=ACTIVE, C=CLOSED
      APPROVED_DATE: 'Date',
      MATURITY_DATE: 'Date'
    },
    joins: {
      customer:   { entity: 'BusinessPartners', from: 'PARTNER',  to: 'PARTNER',  type: 'INNER' },
      schedule:   { entity: 'LoanSchedule',     from: 'LOAN_ID',  to: 'LOAN_ID',  type: 'LEFT'  },
      guarantors: { entity: 'BCA_GUARANTOR',    from: 'LOAN_ID',  to: 'LOAN_ID',  type: 'LEFT'  },
      payments:   { entity: 'DFKKOP',           from: 'LOAN_ID',  to: 'LOAN_ID',  type: 'LEFT'  }
    }
  },

  LoanSchedule: {
    label: 'Repayment schedule rows per loan (PAID / PENDING / MISSED)',
    key: 'SCHEDULE_ID',
    columns: {
      SCHEDULE_ID: 'String',
      LOAN_ID:     'String',
      PARTNER:     'String',
      DUE_DATE:    'Date',
      AMOUNT_DUE:  'Decimal',  // AUD
      AMOUNT_PAID: 'Decimal',  // AUD
      STATUS:      'String'    // PAID | PENDING | MISSED
    },
    joins: {
      loan:     { entity: 'Loans',            from: 'LOAN_ID', to: 'LOAN_ID', type: 'INNER' },
      customer: { entity: 'BusinessPartners', from: 'PARTNER', to: 'PARTNER', type: 'INNER' }
    }
  },

  BCA_GUARANTOR: {
    label: 'Loan guarantors — who is guaranteeing which loan',
    key: 'LOAN_ID',
    columns: {
      LOAN_ID:           'String',
      GUARANTOR_PARTNER: 'String',  // guarantor customer ID (SAP field name)
      GUARANTOR_NAME:    'String',
      COVER_AMOUNT:      'Decimal', // AUD
      CURRENCY:          'String',
      VALID_TO:          'Date'
    },
    joins: {
      loan:     { entity: 'Loans',            from: 'LOAN_ID',           to: 'LOAN_ID', type: 'INNER' },
      guarantor:{ entity: 'BusinessPartners', from: 'GUARANTOR_PARTNER', to: 'PARTNER', type: 'INNER' },
      // "guarantors who are also borrowers": check if guarantor's BP number is also a loan borrower
      asLoan:   { entity: 'Loans',            from: 'GUARANTOR_PARTNER', to: 'PARTNER', type: 'INNER' }
    }
  },

  BCA_COLLATERAL: {
    label: 'Loan collateral assets',
    key: 'COLLATERAL_ID',
    columns: {
      COLLATERAL_ID: 'String',
      LOAN_ID:       'String',
      TYPE:          'String',
      VALUE:         'Decimal', // AUD
      CURRENCY:      'String'
    },
    joins: {
      loan: { entity: 'Loans', from: 'LOAN_ID', to: 'LOAN_ID', type: 'INNER' }
    }
  },

  BCA_DTI: {
    label: 'Debt-to-income ratios and APRA breach flags per customer',
    key: 'PARTNER',
    columns: {
      PARTNER:       'String',
      DTI_RATIO:     'Decimal',  // debt ÷ income, e.g. 7.2 = 720% of annual income
      TOTAL_DEBT:    'Decimal',  // AUD
      ANNUAL_INCOME: 'Decimal',  // AUD
      BREACH_FLAG:   'Boolean',  // true if DTI exceeds APRA DTI Notice threshold (6.0)
      INCOME_EXPIRY: 'Date'      // date income contract / employment ends
    },
    joins: {
      customer: { entity: 'BusinessPartners', from: 'PARTNER', to: 'PARTNER', type: 'INNER' },
      payments: { entity: 'DFKKOP',           from: 'PARTNER', to: 'GPART',   type: 'LEFT'  },
      loans:    { entity: 'Loans',            from: 'PARTNER', to: 'PARTNER', type: 'LEFT'  }
    }
  },

  BCA_CREDIT_HISTORY: {
    label: 'Historical credit / arrears outcomes per customer',
    key: 'PARTNER',
    columns: {
      PARTNER:         'String',
      DTI_RATIO:       'Decimal',
      arrears_outcome: 'String'  // LOW | MEDIUM | HIGH | CRITICAL
    },
    joins: {
      customer: { entity: 'BusinessPartners', from: 'PARTNER', to: 'PARTNER', type: 'INNER' }
    }
  },

  BCA_SECTOR: {
    label: 'Customer sector classification',
    key: 'PARTNER',
    columns: {
      PARTNER:     'String',
      SECTOR_CODE: 'String',
      SECTOR_NAME: 'String'
    },
    joins: {
      customer: { entity: 'BusinessPartners', from: 'PARTNER', to: 'PARTNER', type: 'INNER' }
    }
  },

  RegulatoryThresholds: {
    label: 'APRA regulatory thresholds (DTI limits, LVR caps etc)',
    key: 'THRESHOLD_TYPE',
    columns: {
      THRESHOLD_TYPE: 'String',
      LIMIT_PCT:      'Decimal'
    },
    joins: {}
  },

  ExposureLimits: {
    label: 'Per-customer credit exposure limits',
    key: 'PARTNER',
    columns: {
      PARTNER:      'String',
      LIMIT_AMOUNT: 'Decimal', // AUD
      CURRENCY:     'String'
    },
    joins: {
      customer: { entity: 'BusinessPartners', from: 'PARTNER', to: 'PARTNER', type: 'INNER' }
    }
  },

  SectorExposureLimits: {
    label: 'Maximum sector concentration limits',
    key: 'SECTOR_CODE',
    columns: {
      SECTOR_CODE:           'String',
      MAX_CONCENTRATION_PCT: 'Decimal'
    },
    joins: {}
  },

  DFKKOP: {
    label: 'Open payment items — current ledger (OPEN=unpaid/overdue, CLEARED=paid)',
    key: 'OPBEL',
    columns: {
      OPBEL:        'String',
      GPART:        'String',   // customer ID (SAP FI-CA field for business partner)
      LOAN_ID:      'String',
      BETRW:        'Decimal',  // payment amount AUD
      FAEDN:        'Date',     // due date
      STATUS:       'String',   // OPEN | CLEARED
      DAYS_OVERDUE: 'Integer'
    },
    joins: {
      customer: { entity: 'BusinessPartners', from: 'GPART',   to: 'PARTNER', type: 'INNER' },
      loan:     { entity: 'Loans',            from: 'LOAN_ID', to: 'LOAN_ID', type: 'INNER' },
      dti:      { entity: 'BCA_DTI',          from: 'GPART',   to: 'PARTNER', type: 'LEFT'  }
    }
  },

  DFKKOPK: {
    label: 'Cleared payment history — settled items (historical track record)',
    key: 'OPBEL',
    columns: {
      OPBEL:    'String',
      GPART:    'String',   // customer ID
      LOAN_ID:  'String',
      BETRW:    'Decimal',  // amount paid AUD
      FAEDN:    'Date',     // original due date
      AUGDT:    'Date',     // date payment was applied / cleared
      AUGBL:    'String',   // clearing document number
      CURRENCY: 'String',
      MAHNS:    'Integer'   // dunning level: 0=on time, 1=1st notice, 2=2nd notice, 3=final
    },
    joins: {
      customer: { entity: 'BusinessPartners', from: 'GPART',   to: 'PARTNER', type: 'INNER' },
      loan:     { entity: 'Loans',            from: 'LOAN_ID', to: 'LOAN_ID', type: 'INNER' }
    }
  }

};

// ── Schema prompt for LLM ────────────────────────────────────────────────────

function buildSchemaPrompt() {
  const lines = [];
  for (const [name, def] of Object.entries(SCHEMA)) {
    const cols = Object.entries(def.columns)
      .map(([c, t]) => `${c}:${t}`)
      .join(', ');
    const joins = Object.entries(def.joins || {})
      .map(([alias, j]) => `"${alias}"→${j.entity}(${j.from}=${j.to},${j.type})`)
      .join(', ');
    lines.push(`${name} [${def.label}]`);
    lines.push(`  columns: ${cols}`);
    if (joins) lines.push(`  joins:   ${joins}`);
  }
  return lines.join('\n');
}

// ── Column resolver ──────────────────────────────────────────────────────────

function resolveColumn(col, entityName, joinAlias, joinEntityName) {
  const entityDef = SCHEMA[entityName];
  const joinDef   = joinEntityName ? SCHEMA[joinEntityName] : null;

  if (col.includes('.')) {
    const [alias, colName] = col.split('.', 2);
    if (alias !== joinAlias) return { valid: false, error: `Join alias "${alias}" not declared; declared alias is "${joinAlias}"` };
    if (!joinDef?.columns[colName]) return { valid: false, error: `Column "${colName}" not in entity "${joinEntityName}"` };
    return { valid: true, inMain: false, inJoin: true, resolvedName: colName };
  }

  const inMain = !!entityDef?.columns[col];
  const inJoin = !!joinDef?.columns[col];
  if (!inMain && !inJoin) {
    const hint = joinDef ? ` or "${joinEntityName}"` : '';
    return { valid: false, error: `Column "${col}" not found in "${entityName}"${hint}` };
  }
  return { valid: true, inMain, inJoin, resolvedName: col };
}

module.exports = { SCHEMA, buildSchemaPrompt, resolveColumn };
