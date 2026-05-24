// Definitive GRAPH_TABLE test — proper HANA SQL syntax
require('dotenv').config();
const hana = require('@sap/hana-client');
const HDI_SCHEMA = 'B8EC4EAB42CB46BE940B89D1209CC93D';

const conn = hana.createConnection();
conn.connect({
  host: process.env.HANA_HOST, port: process.env.HANA_PORT,
  uid:  process.env.HANA_USER, pwd:  process.env.HANA_PASSWORD,
  encrypt: true, sslValidateCertificate: false
}, async (err) => {
  if (err) { console.error('Connect failed:', err.message); process.exit(1); }

  const run = (sql) => new Promise((res, rej) => conn.exec(sql, (e, r) => e ? rej(e) : res(r)));
  const tryRun = (sql) => run(sql).catch(e => { /* ignore */ });

  // Clean up first
  await tryRun(`DROP GRAPH WORKSPACE "DBADMIN"."TEST_GRAPH"`);
  await tryRun(`DROP TABLE "DBADMIN"."TEST_EDGE"`);
  await tryRun(`DROP TABLE "DBADMIN"."TEST_VERTEX"`);

  // Create DBADMIN-owned tables with proper HANA SQL (table-level PRIMARY KEY constraint)
  console.log('--- Create DBADMIN test tables ---');
  await run(`CREATE COLUMN TABLE "DBADMIN"."TEST_VERTEX" ("ID" NVARCHAR(10) NOT NULL, "NAME" NVARCHAR(50), PRIMARY KEY("ID"))`);
  await run(`CREATE COLUMN TABLE "DBADMIN"."TEST_EDGE" ("EDGE_ID" INTEGER NOT NULL, "SRC" NVARCHAR(10) NOT NULL, "TGT" NVARCHAR(10) NOT NULL, PRIMARY KEY("EDGE_ID"))`);
  // Single-row inserts (HANA multi-row VALUES syntax can be tricky)
  for (const row of [['P001','Alice'],['P002','Bob'],['P003','Carol']]) {
    await run(`INSERT INTO "DBADMIN"."TEST_VERTEX" VALUES ('${row[0]}','${row[1]}')`);
  }
  for (const row of [[1,'P001','P002'],[2,'P002','P003']]) {
    await run(`INSERT INTO "DBADMIN"."TEST_EDGE" VALUES (${row[0]},'${row[1]}','${row[2]}')`);
  }
  console.log('Tables created OK\n');

  // Create workspace on DBADMIN tables
  console.log('--- Create workspace on DBADMIN tables ---');
  try {
    await run(`CREATE GRAPH WORKSPACE "DBADMIN"."TEST_GRAPH"
EDGE TABLE "DBADMIN"."TEST_EDGE"
  SOURCE COLUMN SRC
  TARGET COLUMN TGT
  KEY COLUMN EDGE_ID
VERTEX TABLE "DBADMIN"."TEST_VERTEX"
  KEY COLUMN ID`);
    console.log('DBADMIN workspace created!');
  } catch(e) { console.log('Error:', e.message.substring(0, 200)); }

  const ws = await run(`SELECT WORKSPACE_NAME, SCHEMA_NAME FROM SYS.GRAPH_WORKSPACES`).catch(() => []);
  console.log('Workspaces:', JSON.stringify(ws));

  if (ws.some(w => w.WORKSPACE_NAME === 'TEST_GRAPH')) {
    // Test GRAPH_TABLE — try multiple syntax variants to find what HANA Cloud 4.x accepts
    console.log('\n--- GRAPH_TABLE syntax variants ---');

    // v1: SQL/PGQ with IS label + WHERE inline
    try {
      const r = await run(`SELECT "DEST", "H" FROM GRAPH_TABLE ("TEST_GRAPH" MATCH (v IS "TEST_VERTEX" WHERE v."ID" = 'P001') -[e IS "TEST_EDGE"*1..3]-> (u IS "TEST_VERTEX") COLUMNS (u."ID" AS "DEST", $edge_count AS "H"))`);
      console.log('v1 (IS label inline) WORKS:', JSON.stringify(r));
    } catch(e) { console.log('v1 error:', e.message.substring(0, 120)); }

    // v2: colon label syntax
    try {
      const r = await run(`SELECT "DEST", "H" FROM GRAPH_TABLE ("TEST_GRAPH" MATCH (v:"TEST_VERTEX" WHERE v."ID" = 'P001') -[e:"TEST_EDGE"*1..3]-> (u:"TEST_VERTEX") COLUMNS (u."ID" AS "DEST", $edge_count AS "H"))`);
      console.log('v2 (colon label) WORKS:', JSON.stringify(r));
    } catch(e) { console.log('v2 error:', e.message.substring(0, 120)); }

    // v3: no labels, WHERE clause separate
    try {
      const r = await run(`SELECT "DEST", "H" FROM GRAPH_TABLE ("TEST_GRAPH" MATCH (v) -[e*1..3]-> (u) WHERE v."ID" = 'P001' COLUMNS (u."ID" AS "DEST", $edge_count AS "H"))`);
      console.log('v3 (no labels) WORKS:', JSON.stringify(r));
    } catch(e) { console.log('v3 error:', e.message.substring(0, 120)); }

    // v4: minimal — just vertex match, no traversal
    try {
      const r = await run(`SELECT "ID" FROM GRAPH_TABLE ("TEST_GRAPH" MATCH (v) WHERE v."ID" = 'P001' COLUMNS (v."ID" AS "ID"))`);
      console.log('v4 (minimal vertex) WORKS:', JSON.stringify(r));
    } catch(e) { console.log('v4 error:', e.message.substring(0, 120)); }

    // Now try HDI workspace (RELTYP as single-column key — not unique but test syntax)
    console.log('\n--- HDI schema workspace (KEY COLUMN RELTYP) ---');
    await tryRun(`DROP GRAPH WORKSPACE "DBADMIN"."BP_RELATIONSHIP_GRAPH"`);
    await tryRun(`DROP GRAPH WORKSPACE "BP_RELATIONSHIP_GRAPH"`);
    try {
      await run(`CREATE GRAPH WORKSPACE "DBADMIN"."BP_RELATIONSHIP_GRAPH"
EDGE TABLE "${HDI_SCHEMA}"."BANKINGSENTINEL_BUT050"
  SOURCE COLUMN PARTNER1
  TARGET COLUMN PARTNER2
  KEY COLUMN RELTYP
VERTEX TABLE "${HDI_SCHEMA}"."BANKINGSENTINEL_BUSINESSPARTNERS"
  KEY COLUMN PARTNER`);
      console.log('HDI workspace created! (key=RELTYP)');
    } catch(e) { console.log('HDI workspace error:', e.message.substring(0, 250)); }
  }

  // Cleanup DBADMIN test objects
  await tryRun(`DROP GRAPH WORKSPACE "DBADMIN"."TEST_GRAPH"`);
  await tryRun(`DROP TABLE "DBADMIN"."TEST_EDGE"`);
  await tryRun(`DROP TABLE "DBADMIN"."TEST_VERTEX"`);

  const wsFinal = await run(`SELECT WORKSPACE_NAME, SCHEMA_NAME FROM SYS.GRAPH_WORKSPACES`).catch(() => []);
  console.log('\nFinal workspaces:', JSON.stringify(wsFinal));
  conn.disconnect();
});
