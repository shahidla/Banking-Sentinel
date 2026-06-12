// One-shot script: deploys PAL_RUN_ISOLATION_FOREST procedure to HANA HDI schema
// Uses the DT (design-time) user who has DDL rights in the HDI container.
// Run: node scripts/deploy-procedure.js

'use strict';
const hana = require('@sap/hana-client');
require('dotenv').config();

const conn = hana.createConnection();

conn.connect({
  host:                 '3ad6bab2-7da6-42bc-bd91-13248e061d01.hna1.prod-us10.hanacloud.ondemand.com',
  port:                 443,
  uid:                  'B8EC4EAB42CB46BE940B89D1209CC93D_2YVP9Q1VW2PDKGOWTJN27DE7F_DT',
  pwd:                  '***REMOVED-HANA-HDI-DT-PASSWORD***',
  currentSchema:        'B8EC4EAB42CB46BE940B89D1209CC93D',
  encrypt:              true,
  sslValidateCertificate: false
}, (err) => {
  if (err) { console.error('Connection failed:', err.message); process.exit(1); }
  console.log('Connected as DT user to HDI schema');

  // AI: Feature set mirrors ml/anomaly-service.py exactly — [payment_delay_days, dunning_level (MAHNS)],
  //     trained on DFKKOP (open items) + DFKKOPK (cleared history) portfolio-wide, scored for one customer.
  //     NUM_TREES=100/SEED=42 mirror scikit's n_estimators=100/random_state=42. PAL has no 'auto'
  //     contamination equivalent — CONTAMINATION=0.1 is the closest fixed approximation.
  const sql = `CREATE OR REPLACE PROCEDURE "PAL_RUN_ISOLATION_FOREST" (IN customer_id NVARCHAR(20))
LANGUAGE SQLSCRIPT
SQL SECURITY INVOKER
AS
BEGIN
    DECLARE lt_train TABLE ("PAYMENT_DELAY_DAYS" DOUBLE, "DUNNING_LEVEL" DOUBLE);
    DECLARE lt_train_param TABLE ("PARAM_NAME" NVARCHAR(256), "INT_VALUE" INTEGER, "DOUBLE_VALUE" DOUBLE, "STRING_VALUE" NVARCHAR(100));
    DECLARE lt_model TABLE ("TREE_INDEX" INTEGER, "MODEL_CONTENT" NCLOB);
    DECLARE lt_score TABLE ("ID" NVARCHAR(20), "PAYMENT_DELAY_DAYS" DOUBLE, "DUNNING_LEVEL" DOUBLE);
    DECLARE lt_explain_param TABLE ("PARAM_NAME" NVARCHAR(256), "INT_VALUE" INTEGER, "DOUBLE_VALUE" DOUBLE, "STRING_VALUE" NVARCHAR(100));
    DECLARE lt_result TABLE ("ID" NVARCHAR(20), "SCORE" DOUBLE, "LABEL" INTEGER, "REASON_CODE" NCLOB);

    -- Training — portfolio-wide: DFKKOP open items + DFKKOPK cleared history (mirrors scikit X_train)
    lt_train =
        SELECT TOP 500
            CAST("DAYS_OVERDUE" AS DOUBLE) AS "PAYMENT_DELAY_DAYS",
            CAST("MAHNS" AS DOUBLE) AS "DUNNING_LEVEL"
        FROM "BANKINGSENTINEL_DFKKOP"
        UNION ALL
        SELECT TOP 500
            CAST(DAYS_BETWEEN("FAEDN", "AUGDT") AS DOUBLE) AS "PAYMENT_DELAY_DAYS",
            CAST("MAHNS" AS DOUBLE) AS "DUNNING_LEVEL"
        FROM "BANKINGSENTINEL_DFKKOPK";

    lt_train_param =
        SELECT CAST('SEED' AS NVARCHAR(256)) AS "PARAM_NAME", CAST(42 AS INTEGER) AS "INT_VALUE", CAST(NULL AS DOUBLE) AS "DOUBLE_VALUE", CAST(NULL AS NVARCHAR(100)) AS "STRING_VALUE" FROM DUMMY
        UNION ALL SELECT CAST('NUM_TREES' AS NVARCHAR(256)), CAST(100 AS INTEGER), CAST(NULL AS DOUBLE), CAST(NULL AS NVARCHAR(100)) FROM DUMMY
        UNION ALL SELECT CAST('MAX_SAMPLES' AS NVARCHAR(256)), CAST(-1 AS INTEGER), CAST(NULL AS DOUBLE), CAST(NULL AS NVARCHAR(100)) FROM DUMMY;

    CALL _SYS_AFL.PAL_ISOLATION_FOREST(:lt_train, :lt_train_param, lt_model);

    -- Scoring — this customer's rows: DFKKOP open items (P-prefix) + DFKKOPK history (H-prefix), same features (mirrors scikit X_score)
    lt_score =
        SELECT
            'P' || TO_NVARCHAR(ROW_NUMBER() OVER(ORDER BY "OPBEL")) AS "ID",
            CAST("DAYS_OVERDUE" AS DOUBLE) AS "PAYMENT_DELAY_DAYS",
            CAST("MAHNS" AS DOUBLE) AS "DUNNING_LEVEL"
        FROM "BANKINGSENTINEL_DFKKOP"
        WHERE "GPART" = :customer_id
        UNION ALL
        SELECT
            'H' || TO_NVARCHAR(ROW_NUMBER() OVER(ORDER BY "OPBEL")) AS "ID",
            CAST(DAYS_BETWEEN("FAEDN", "AUGDT") AS DOUBLE) AS "PAYMENT_DELAY_DAYS",
            CAST("MAHNS" AS DOUBLE) AS "DUNNING_LEVEL"
        FROM "BANKINGSENTINEL_DFKKOPK"
        WHERE "GPART" = :customer_id;

    lt_explain_param =
        SELECT CAST('CONTAMINATION' AS NVARCHAR(256)) AS "PARAM_NAME", CAST(NULL AS INTEGER) AS "INT_VALUE", CAST(0.1 AS DOUBLE) AS "DOUBLE_VALUE", CAST(NULL AS NVARCHAR(100)) AS "STRING_VALUE" FROM DUMMY
        UNION ALL SELECT CAST('EXPLAIN_SCOPE' AS NVARCHAR(256)), CAST(1 AS INTEGER), CAST(NULL AS DOUBLE), CAST(NULL AS NVARCHAR(100)) FROM DUMMY;

    CALL _SYS_AFL.PAL_ISOLATION_FOREST_EXPLAIN(:lt_score, :lt_model, :lt_explain_param, lt_result);

    SELECT "ID", "SCORE", "LABEL", "REASON_CODE" FROM :lt_result;
END`;

  conn.exec(sql, (err) => {
    if (err) {
      console.error('CREATE OR REPLACE PROCEDURE failed:', err.message);
      conn.disconnect();
      process.exit(1);
    }
    console.log('Procedure PAL_RUN_ISOLATION_FOREST deployed successfully');

    // Verify: grant EXECUTE to RT user
    const grantSql = `GRANT EXECUTE ON "PAL_RUN_ISOLATION_FOREST" TO "B8EC4EAB42CB46BE940B89D1209CC93D_2YVP9Q1VW2PDKGOWTJN27DE7F_RT"`;
    conn.exec(grantSql, (err2) => {
      if (err2) console.warn('GRANT warning (may already exist):', err2.message);
      else console.log('EXECUTE granted to RT user');
      conn.disconnect();
    });
  });
});
