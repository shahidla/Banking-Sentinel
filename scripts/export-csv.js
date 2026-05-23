// Banking Sentinel — Export all HANA table data to local CSV files
// Exports every entity including RegulatoryDocuments with EMBEDDING field
// Run: cds bind --exec node scripts/export-csv.js

'use strict';
const cds = require('@sap/cds');
const fs = require('fs');
const path = require('path');

const EXPORT_DIR = path.join(__dirname, '../Data/exports');

const ENTITIES = [
  'bankingsentinel.BusinessPartners',
  'bankingsentinel.BPRoles',
  'bankingsentinel.BUT050',
  'bankingsentinel.ContractAccounts',
  'bankingsentinel.BKKN',
  'bankingsentinel.Loans',
  'bankingsentinel.LoanConditions',
  'bankingsentinel.LoanSchedule',
  'bankingsentinel.BCA_GUARANTOR',
  'bankingsentinel.BCA_COLLATERAL',
  'bankingsentinel.DFKKOP',
  'bankingsentinel.DFKKZP',
  'bankingsentinel.BCA_SECTOR',
  'bankingsentinel.BCA_DTI',
  'bankingsentinel.BCA_RISK_CLASS',
  'bankingsentinel.RegulatoryThresholds',
  'bankingsentinel.ExposureLimits',
  'bankingsentinel.SectorExposureLimits',
  'bankingsentinel.RegulatoryDocuments',
  'bankingsentinel.RiskAssessments',
  'bankingsentinel.AuditLog'
];

function escapeCell(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Wrap in quotes if contains comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function rowsToCsv(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const headerLine = headers.map(escapeCell).join(',');
  const dataLines = rows.map(row =>
    headers.map(h => escapeCell(row[h])).join(',')
  );
  return [headerLine, ...dataLines].join('\n');
}

async function exportAll() {
  console.log('\n Banking Sentinel — Export All HANA Tables to CSV');
  console.log('===================================================\n');

  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
  }

  await cds.connect.to('db');

  let exported = 0;
  let empty = 0;
  let errors = 0;

  for (const entity of ENTITIES) {
    const tableName = entity.split('.').pop();
    const filename = `${tableName}.csv`;
    const filepath = path.join(EXPORT_DIR, filename);

    try {
      const rows = await cds.run(SELECT.from(entity));

      if (rows.length === 0) {
        console.log(`  EMPTY  ${tableName} (0 rows)`);
        // Write empty CSV with just headers if we can determine them
        fs.writeFileSync(filepath, '');
        empty++;
      } else {
        const csv = rowsToCsv(rows);
        fs.writeFileSync(filepath, csv, 'utf8');
        console.log(`  OK     ${tableName}: ${rows.length} rows → ${filename}`);
        exported++;
      }
    } catch (err) {
      console.log(`  ERROR  ${tableName}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n${'='.repeat(51)}`);
  console.log(`  Exported: ${exported} tables`);
  console.log(`  Empty:    ${empty} tables`);
  console.log(`  Errors:   ${errors} tables`);
  console.log(`  Output:   Data/exports/`);
  console.log();

  process.exit(errors > 0 ? 1 : 0);
}

exportAll().catch(e => {
  console.error('Export failed:', e);
  process.exit(1);
});
