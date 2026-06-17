// One-off: create a restricted, read-only HANA user (MCP_READER) for the
// cds-db-nlquery-mcp package, scoped to the entities in MCP_ALLOWED_ENTITIES.
// Connects directly as DBADMIN via @sap/hana-client — CREATE USER is account-level,
// not something the app's _RT runtime user can do.
'use strict';
require('dotenv').config();
const hana = require('@sap/hana-client');

const SCHEMA = 'B8EC4EAB42CB46BE940B89D1209CC93D';
const MCP_READER_PASSWORD = process.env.MCP_READER_PASSWORD;

// Tables MCP_ALLOWED_ENTITIES grants at the app level — grant SELECT on exactly these.
const ALLOWED_TABLES = [
  'BusinessPartners', 'Loans', 'LoanSchedule', 'LoanStatusCodes', 'BCA_DTI',
  'DFKKOP', 'DFKKOPK', 'BCA_GUARANTOR', 'BCA_COLLATERAL', 'BCA_SECTOR', 'RiskAssessments',
];

function run(conn, sql) {
  return new Promise((resolve, reject) => {
    conn.exec(sql, (err, result) => err ? reject(err) : resolve(result));
  });
}

(async () => {
  if (!MCP_READER_PASSWORD) {
    console.error('Set MCP_READER_PASSWORD in .env first (a strong password for the new user).');
    process.exit(1);
  }

  const conn = hana.createConnection();
  await new Promise((resolve, reject) => {
    conn.connect({
      host: process.env.HANA_HOST,
      port: process.env.HANA_PORT,
      user: process.env.HANA_USER,
      password: process.env.HANA_PASSWORD,
      encrypt: true,
      sslValidateCertificate: false,
    }, err => err ? reject(err) : resolve());
  });
  console.log('Connected as', process.env.HANA_USER);

  try {
    await run(conn, `CREATE USER MCP_READER PASSWORD "${MCP_READER_PASSWORD}" NO FORCE_FIRST_PASSWORD_CHANGE`);
    console.log('OK — user MCP_READER created');
  } catch (e) {
    console.log('CREATE USER:', e.message, '(continuing — may already exist)');
  }

  for (const table of ALLOWED_TABLES) {
    const fq = `"${SCHEMA}"."BANKINGSENTINEL_${table.toUpperCase()}"`;
    try {
      await run(conn, `GRANT SELECT ON ${fq} TO MCP_READER`);
      console.log('OK — GRANT SELECT ON', table);
    } catch (e) {
      console.log('GRANT FAILED on', table, ':', e.message);
    }
  }

  conn.disconnect();
  process.exit(0);
})().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
