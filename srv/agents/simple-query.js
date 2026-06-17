'use strict';
// NOTE: We do NOT ask the LLM to generate SQL or CDS script directly.
// The LLM outputs a JSON query descriptor (entity + conditions + named join).
// This module translates that descriptor into CAP CDS queries:
//   SELECT.from('bankingsentinel.Entity').limit(n)
// CDS then resolves HANA HDI table names internally — raw SQL cannot do this.
// All validation, type coercion and join key resolution happen here against
// the schema registry (query-schema.js) before any CDS call is made.

const { ChatAnthropic } = require('@langchain/anthropic');
const cds = require('@sap/cds');
const { extractJson }                       = require('../utils/llm-json');
const { SCHEMA, buildSchemaPrompt, resolveColumn } = require('../utils/query-schema');

// ── System prompt ────────────────────────────────────────────────────────────

const QUERY_SYSTEM = `You are the query planner for Banking Sentinel, an AI risk intelligence system.

BACKEND CONTEXT (important — shapes what you can request):
- Database: SAP HANA Cloud
- Query layer: SAP CAP (Cloud Application Programming Model) / CDS (Core Data Services)
- You do NOT write SQL. You output a JSON descriptor. The framework builds CDS queries:
    SELECT.from('bankingsentinel.BCA_DTI').where({BREACH_FLAG: true}).limit(50)
- Raw SQL is not used because HANA HDI (HANA Deployment Infrastructure) manages internal table
  names. Only CDS can resolve them. The framework handles all of this from your JSON.
- Conditions, date comparisons, boolean normalization, and join key resolution are all
  handled by the framework — you just describe WHAT data you want.

YOUR JOB: Translate the user's question into a JSON query descriptor.

DESCRIPTOR FORMAT:
{
  "entity":   "<entity name from schema>",
  "join":     "<join alias from entity's joins list>" or null,
  "select":   ["COL", "joinAlias.COL", ...] or null (null = return all columns),
  "where": [
    { "col": "COLUMN_OR_joinAlias.COLUMN", "op": "...", "val": ... }
  ],
  "orderBy":  "COLUMN" or null,
  "orderDir": "ASC" | "DESC",
  "limit":    50
}

The join type (INNER/LEFT) is declared in the schema and applied automatically by the framework:
- INNER = mandatory relationship (both sides guaranteed to exist — e.g. every loan has a borrower)
- LEFT  = optional relationship (main row kept even if join has no match)
You do not specify join type in the descriptor — the schema declares it.

OPERATORS for "op":
  "="  "!="  ">"  "<"  ">="  "<="  — standard comparison (framework handles type coercion)
  "like"        — case-insensitive string contains
  "within_days" — date column is between today and today+val days (use for expiry/maturity)
  "days_ago"    — date column fell within the last val days

IMPORTANT RULES:
1. Use ONLY entity names and column names from the schema below — no guessing.
2. To include a column from the joined entity in select or where, prefix it: "join_alias.COLUMN_NAME"
   Example: join "customer" → "customer.BU_SORT1" in select, "customer.SECTOR_CODE" in where
3. One join maximum. If two entities are needed, pick the one that best answers the question.
4. BREACH_FLAG is a Boolean column — pass val as true or false (not "true").
5. Do not invent SQL functions (CURRENT_DATE, ADD_DAYS etc) — use "within_days" / "days_ago" operators instead.
6. Return ONLY the JSON object, no markdown, no explanation.

SCHEMA (entity → columns with types → named joins):
${buildSchemaPrompt()}

EXAMPLES:

Q: "Which customers have a DTI above 5?"
A: {"entity":"BCA_DTI","join":"customer","select":["PARTNER","DTI_RATIO","ANNUAL_INCOME","customer.BU_SORT1"],"where":[{"col":"DTI_RATIO","op":">","val":5}],"orderBy":"DTI_RATIO","orderDir":"DESC","limit":50}

Q: "Which guarantors are also borrowers at this bank?"
A: {"entity":"BCA_GUARANTOR","join":"asLoan","select":["GUARANTOR_PARTNER","LOAN_ID","COVER_AMOUNT","asLoan.LOAN_ID","asLoan.AMOUNT"],"where":[],"orderBy":null,"orderDir":"ASC","limit":50}

Q: "Show customers with DTI breach and overdue payments"
A: {"entity":"DFKKOP","join":"dti","select":["GPART","LOAN_ID","DAYS_OVERDUE","STATUS","dti.DTI_RATIO","dti.BREACH_FLAG"],"where":[{"col":"STATUS","op":"=","val":"OPEN"},{"col":"dti.BREACH_FLAG","op":"=","val":true}],"orderBy":"DAYS_OVERDUE","orderDir":"DESC","limit":50}

Q: "Which customers have income expiring in the next 90 days?"
A: {"entity":"BCA_DTI","join":"customer","select":["PARTNER","INCOME_EXPIRY","DTI_RATIO","customer.BU_SORT1"],"where":[{"col":"INCOME_EXPIRY","op":"within_days","val":90}],"orderBy":"INCOME_EXPIRY","orderDir":"ASC","limit":50}

Q: "List loans with their guarantor names"
A: {"entity":"BCA_GUARANTOR","join":"guarantor","select":["LOAN_ID","GUARANTOR_PARTNER","GUARANTOR_NAME","COVER_AMOUNT","guarantor.NAME"],"where":[],"orderBy":"COVER_AMOUNT","orderDir":"DESC","limit":50}`;

// ── Answer prompt ────────────────────────────────────────────────────────────

const ANSWER_SYSTEM = `You are Banking Sentinel, an AI risk intelligence system for a major Australian bank.
Answer the user's question using ONLY the query results provided. Be concise and precise. Use AUD currency where applicable.
After your answer, offer: "Would you like a full risk analysis of any specific borrower?"`;

// ── Type-aware condition evaluator ───────────────────────────────────────────

function coerce(val, type) {
  if (type === 'Boolean') {
    if (val === 'true'  || val === 1 || val === '1') return true;
    if (val === 'false' || val === 0 || val === '0') return false;
    return Boolean(val);
  }
  if (type === 'Decimal' || type === 'Integer') return parseFloat(val);
  return val;
}

function applyConditions(rows, conditions, entityDef, joinDef, joinAlias) {
  if (!conditions || conditions.length === 0) return rows;
  const today = new Date();

  return rows.filter(row => conditions.every(({ col, op, val }) => {
    // Resolve column: prefixed cols like "customer.BU_SORT1" look in the joined entity
    let v, colType;
    if (col.includes('.')) {
      const [, colName] = col.split('.', 2);
      v       = row[`__join__${colName}`] ?? row[colName];
      colType = joinDef?.columns[colName] || 'String';
    } else {
      v       = row[col];
      colType = entityDef.columns[col] || joinDef?.columns[col] || 'String';
    }

    // Skip if column genuinely absent (shouldn't happen post-join validation)
    if (v === undefined || v === null) return false;

    const coercedVal = coerce(val, colType);
    const coercedV   = coerce(v,   colType);

    switch (op) {
      case '=':    return coercedV == coercedVal;
      case '!=':   return coercedV != coercedVal;
      case '>':    return coercedV  > coercedVal;
      case '<':    return coercedV  < coercedVal;
      case '>=':   return coercedV >= coercedVal;
      case '<=':   return coercedV <= coercedVal;
      case 'like': return String(v).toLowerCase().includes(String(val).toLowerCase());
      case 'within_days': {
        const d      = new Date(v);
        const future = new Date(today);
        future.setDate(future.getDate() + parseInt(val));
        return d >= today && d <= future;
      }
      case 'days_ago': {
        const d    = new Date(v);
        const past = new Date(today);
        past.setDate(past.getDate() - parseInt(val));
        return d >= past && d <= today;
      }
      default: return true;
    }
  }));
}

// ── Schema-driven descriptor executor ───────────────────────────────────────

async function executeDescriptor(descriptor) {
  const { entity, join: joinAlias, select, where, orderBy, orderDir, limit } = descriptor;

  // 1. Validate entity
  const entityDef = SCHEMA[entity];
  if (!entityDef) {
    const known = Object.keys(SCHEMA).join(', ');
    throw new Error(`Unknown entity "${entity}". Valid entities: ${known}`);
  }

  // 2. Resolve join
  let joinAliasDef = null;   // { entity, from, to }
  let joinEntityDef = null;  // SCHEMA entry for the joined entity
  if (joinAlias) {
    joinAliasDef = entityDef.joins?.[joinAlias];
    if (!joinAliasDef) {
      const valid = Object.keys(entityDef.joins || {}).join(', ') || 'none';
      throw new Error(`No join "${joinAlias}" on "${entity}". Valid joins: ${valid}`);
    }
    joinEntityDef = SCHEMA[joinAliasDef.entity];
    if (!joinEntityDef) throw new Error(`Join target entity "${joinAliasDef.entity}" not in schema`);
  }

  // 3. Validate select columns
  if (select) {
    for (const col of select) {
      const r = resolveColumn(col, entity, joinAlias, joinAliasDef?.entity);
      if (!r.valid) throw new Error(`select: ${r.error}`);
      if (r.inJoin && !joinAlias) throw new Error(`select: "${col}" requires a join — add "join": "<alias>"`);
    }
  }

  // 4. Validate where columns
  if (where) {
    for (const cond of where) {
      const r = resolveColumn(cond.col, entity, joinAlias, joinAliasDef?.entity);
      if (!r.valid) throw new Error(`where: ${r.error}`);
      if (r.inJoin && !joinAlias) throw new Error(`where: "${cond.col}" requires a join — add "join": "<alias>"`);
    }
  }

  // 5. Fetch main entity (all columns — projection happens in JS after join)
  let rows = await cds.run(SELECT.from(`bankingsentinel.${entity}`).limit(500));
  console.log(`  [SimpleQuery] Fetched ${rows.length} rows from ${entity}`);

  // 6. Merge joined entity
  if (joinAliasDef) {
    const joinRows = await cds.run(
      SELECT.from(`bankingsentinel.${joinAliasDef.entity}`).limit(500)
    );
    console.log(`  [SimpleQuery] Fetched ${joinRows.length} rows from ${joinAliasDef.entity} (join "${joinAlias}")`);

    // Build lookup map keyed by the join's "to" column
    const joinMap = new Map();
    for (const r of joinRows) joinMap.set(r[joinAliasDef.to], r);

    // Join type comes from the schema (joinAliasDef.type): INNER or LEFT.
    // INNER: mandatory relationship — both sides must exist (e.g. Loans.PARTNER → BusinessPartners)
    // LEFT:  optional relationship — keep main row even with no join match (e.g. DFKKOP → BCA_DTI)
    const isInner = (joinAliasDef.type || 'INNER') === 'INNER';
    const beforeCount = rows.length;
    rows = rows
      .map(row => {
        const matched = joinMap.get(row[joinAliasDef.from]);
        if (!matched) return isInner ? null : row; // INNER drops unmatched; LEFT keeps them
        const joined = {};
        for (const [k, v] of Object.entries(matched)) {
          joined[`__join__${k}`] = v;
          if (!(k in row)) joined[k] = v;
        }
        return { ...row, ...joined };
      })
      .filter(Boolean);

    console.log(`  [SimpleQuery] After ${isInner ? 'inner' : 'left'} join: ${rows.length}/${beforeCount} rows matched`);
  }

  // 7. Apply conditions (post-join so both entity columns are present)
  if (where && where.length > 0) {
    rows = applyConditions(rows, where, entityDef, joinEntityDef, joinAlias);
    console.log(`  [SimpleQuery] After conditions: ${rows.length} rows`);
  }

  // 8. Sort
  if (orderBy) {
    const dir = orderDir === 'DESC' ? -1 : 1;
    rows.sort((a, b) => {
      const av = a[orderBy] ?? a[`__join__${orderBy}`];
      const bv = b[orderBy] ?? b[`__join__${orderBy}`];
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av > bv ? 1 : av < bv ? -1 : 0) * dir;
    });
  }

  // 9. Column projection — strip internal __join__ keys, resolve alias.COL references
  let result = rows.slice(0, limit || 50);
  if (select && select.length > 0) {
    result = result.map(row => {
      const projected = {};
      for (const col of select) {
        if (col.includes('.')) {
          const [, colName] = col.split('.', 2);
          projected[colName] = row[`__join__${colName}`] ?? row[colName];
        } else {
          projected[col] = row[col];
        }
      }
      return projected;
    });
  } else {
    // No explicit select: strip internal keys, return everything else
    result = result.map(row =>
      Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('__join__')))
    );
  }

  return result;
}

// ── LangGraph node ───────────────────────────────────────────────────────────

async function simpleQueryNode(state) {
  const llm = new ChatAnthropic({
    model:     process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
    apiKey:    process.env.ANTHROPIC_API_KEY,
    maxTokens: 800
  });

  let context;
  try {
    const response = await llm.invoke([
      { role: 'system', content: QUERY_SYSTEM },
      { role: 'user',   content: state.query }
    ]);

    const raw = typeof response.content === 'string'
      ? response.content
      : response.content.map(b => b.text || '').join('');

    const descriptor = extractJson(raw);
    if (!descriptor?.entity) throw new Error('LLM did not return a valid descriptor');

    console.log('  [SimpleQuery] ── Generated descriptor ──────────────────────────');
    console.log(`  [SimpleQuery]   entity : ${descriptor.entity}`);
    if (descriptor.join)    console.log(`  [SimpleQuery]   join   : "${descriptor.join}" → ${descriptor.entity}`);
    if (descriptor.select)  console.log(`  [SimpleQuery]   select : ${descriptor.select.join(', ')}`);
    if (descriptor.where?.length) {
      descriptor.where.forEach(w =>
        console.log(`  [SimpleQuery]   where  : ${w.col} ${w.op} ${JSON.stringify(w.val)}`)
      );
    }
    if (descriptor.orderBy) console.log(`  [SimpleQuery]   order  : ${descriptor.orderBy} ${descriptor.orderDir || 'ASC'}`);
    console.log(`  [SimpleQuery]   limit  : ${descriptor.limit || 50}`);
    console.log('  [SimpleQuery] ────────────────────────────────────────────────────');

    const rows = await executeDescriptor(descriptor);
    console.log(`  [SimpleQuery] → ${rows.length} rows returned to answer LLM`);

    const preview = JSON.stringify(rows.slice(0, 20), null, 2);
    context = `Descriptor: ${JSON.stringify(descriptor)}\n\nResults (${rows.length} rows):\n${preview}`;

  } catch (e) {
    console.warn(`  [SimpleQuery] Query failed: ${e.message}`);
    return {
      simpleQueryResult: `I couldn't answer that question (${e.message}). Try rephrasing, or ask for a full risk analysis of a specific customer.`,
      totalInputTokens:  0,
      totalOutputTokens: 0
    };
  }

  const answerResp = await llm.invoke([
    { role: 'system', content: ANSWER_SYSTEM },
    { role: 'user',   content: `Question: ${state.query}\n\nData:\n${context}` }
  ]);

  const answer = typeof answerResp.content === 'string'
    ? answerResp.content
    : answerResp.content.map(b => b.text || '').join('');

  return {
    simpleQueryResult: answer,
    totalInputTokens:  answerResp.usage_metadata?.input_tokens  || 0,
    totalOutputTokens: answerResp.usage_metadata?.output_tokens || 0
  };
}

module.exports = { simpleQueryNode };
