// Banking Sentinel — shared LLM JSON extraction
// AI: LLMs sometimes wrap JSON in markdown fences or append trailing prose
//     after the closing brace. A greedy `/\{[\s\S]*\}/` regex over-matches
//     in that case, pulling trailing text (which may itself contain braces)
//     into the parsed string and breaking JSON.parse.
// Banking: a single malformed LLM response must degrade gracefully (fallback
//     value), not crash the whole risk-analysis pipeline.

'use strict';

// Find the first balanced JSON object/array in `text`, tolerating markdown
// code fences and trailing prose. Returns the parsed value, or null if no
// balanced JSON value could be parsed.
function extractJson(text) {
  if (typeof text !== 'string') return null;
  const stripped = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

  const open = stripped.search(/[{[]/);
  if (open === -1) return null;
  const openChar  = stripped[open];
  const closeChar = openChar === '{' ? '}' : ']';

  let depth = 0, inString = false, escape = false;
  for (let i = open; i < stripped.length; i++) {
    const ch = stripped[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(stripped.slice(open, i + 1)); }
        catch { return null; }
      }
    }
  }
  return null;
}

module.exports = { extractJson };
