require('dotenv').config();
const neo4j = require('neo4j-driver');

(async () => {
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
  );
  try {
    const info = await driver.getServerInfo();
    console.log('Connected:', info.address, info.serverVersion);
  } catch (e) {
    console.error('Connection failed:', e.message);
  } finally {
    await driver.close();
  }
})();
