// Check HANA instance compute config and BUT050 data
require('dotenv').config();
const hana = require('@sap/hana-client');

const conn = hana.createConnection();
conn.connect({
  host: process.env.HANA_HOST, port: process.env.HANA_PORT,
  uid:  process.env.HANA_USER, pwd:  process.env.HANA_PASSWORD,
  encrypt: true, sslValidateCertificate: false
}, async (err) => {
  if (err) { console.error(err.message); process.exit(1); }
  const run = (sql) => new Promise((res, rej) => conn.exec(sql, (e, r) => e ? rej(e) : res(r)));

  // Instance size / vCPUs
  try {
    const r = await run(`SELECT SYSTEM_ID, VERSION, ALLOCATED_MEMORY_SIZE, CPU_CORES_COUNT
                         FROM SYS.M_HOST_INFORMATION
                         WHERE KEY IN ('cpu_cores_count', 'mem_alloc', 'system_id', 'version')
                         LIMIT 10`);
    console.log('Host info:', JSON.stringify(r));
  } catch(e) {
    try {
      const r2 = await run(`SELECT * FROM SYS.M_SYSTEM_OVERVIEW WHERE NAME IN ('Active Services', 'Memory', 'CPU')`);
      console.log('System overview:', JSON.stringify(r2));
    } catch(e2) { console.log('System info error:', e2.message); }
  }

  // Try a different approach to see compute info
  try {
    const r = await run(`SELECT HOST, VALUE FROM SYS.M_HOST_INFORMATION WHERE KEY = 'cpu_cores_count'`);
    console.log('CPU cores:', JSON.stringify(r));
  } catch(e) { console.log('CPU check error:', e.message); }

  // BUT050 data count
  const HDI = 'B8EC4EAB42CB46BE940B89D1209CC93D';
  try {
    const r = await run(`SELECT COUNT(*) AS CNT FROM "${HDI}"."BANKINGSENTINEL_BUT050"`);
    console.log('BUT050 row count:', r[0]?.CNT);
    const sample = await run(`SELECT * FROM "${HDI}"."BANKINGSENTINEL_BUT050" LIMIT 5`);
    console.log('BUT050 sample:', JSON.stringify(sample));
  } catch(e) { console.log('BUT050 error:', e.message); }

  conn.disconnect();
});
