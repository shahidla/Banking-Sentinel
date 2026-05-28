'use strict';
require('dotenv').config();
const cds = require('@sap/cds');

(async () => {
  await cds.connect.to('db');

  // Try CDS entity name (auto-resolves to real HDI table name)
  try {
    const rows = await cds.run(SELECT.from('bankingsentinel.RegulatoryDocuments').limit(1));
    console.log('CDS entity query OK — rows returned:', rows.length);
  } catch (e) {
    console.log('CDS entity query failed:', e.message);
  }

  // Check what tables actually exist in the schema
  try {
    const catalog = await cds.run(
      `SELECT TABLE_NAME FROM SYS.TABLES WHERE SCHEMA_NAME = CURRENT_SCHEMA AND TABLE_NAME LIKE '%EGULAT%'`
    );
    console.log('Catalog REGULATORY tables:', JSON.stringify(catalog));

    const all = await cds.run(
      `SELECT TABLE_NAME FROM SYS.TABLES WHERE SCHEMA_NAME = CURRENT_SCHEMA ORDER BY TABLE_NAME`
    );
    console.log('All tables in schema:');
    all.forEach(r => console.log(' ', r.TABLE_NAME));
  } catch (e) {
    console.log('Catalog query failed:', e.message);
  }

  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
