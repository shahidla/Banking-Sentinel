'use strict';

// Banking Sentinel delegates simple natural-language data questions to the
// published cds-db-nlquery MCP server. The app does not own query planning,
// schema reading, SQL construction, or join execution here.

const { ChatAnthropic } = require('@langchain/anthropic');
const fs = require('fs');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const MCP_PACKAGE = '@shahid.la/cds-db-nlquery-mcp';
const MCP_SERVER_NAME = 'cds-db-nlquery-mcp';

const ANSWER_SYSTEM = `You are Banking Sentinel, an AI risk intelligence system for a major Australian bank.
Answer the user's question using ONLY the query results provided. Be concise and precise. Use AUD currency where applicable.
After your answer, offer: "Would you like a full risk analysis of any specific borrower?"`;

let mcpClientPromise = null;

function envForMcpServer(extraEnv) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  for (const [key, value] of Object.entries(extraEnv || {})) {
    if (typeof value === 'string') env[key] = value;
  }

  // Keep CAP/HANA runtime logs off stdout inside the MCP child process.
  // MCP JSON-RPC uses stdout as the transport, so human-readable pool/info logs
  // must be suppressed or redirected.
  const cdsConfig = {
    log: {
      levels: {
        pool: 'warn',
        hana: 'warn',
        sql: 'warn',
        db: 'warn',
      },
    },
  };
  env.CDS_CONFIG = JSON.stringify(cdsConfig);

  return env;
}

function mcpCommand() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function readMcpServerConfig() {
  const configPath = path.join(process.cwd(), '.mcp.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return parsed?.mcpServers?.[MCP_SERVER_NAME] || null;
  } catch (e) {
    console.warn('[NLQuery MCP] could not read .mcp.json: ' + e.message);
    return null;
  }
}

function childServerParams() {
  const configured = readMcpServerConfig();
  if (!configured) {
    return {
      command: mcpCommand(),
      args: ['-y', MCP_PACKAGE],
      cwd: process.cwd(),
      env: envForMcpServer(),
      stderr: 'pipe',
    };
  }

  return {
    command: configured.command || mcpCommand(),
    args: configured.args || ['-y', MCP_PACKAGE],
    cwd: configured.cwd || process.cwd(),
    env: envForMcpServer(configured.env),
    stderr: 'pipe',
  };
}

async function getMcpClient() {
  if (mcpClientPromise) return mcpClientPromise;

  mcpClientPromise = (async () => {
    const client = new Client(
      { name: 'banking-sentinel', version: '1.0.0' },
      { capabilities: {} }
    );

    const transport = new StdioClientTransport(childServerParams());

    transport.stderr?.on('data', chunk => {
      const text = String(chunk).trim();
      if (text) console.log('[NLQuery MCP] ' + text);
    });

    transport.onerror = err => {
      console.warn('[NLQuery MCP] transport error: ' + err.message);
      mcpClientPromise = null;
    };
    transport.onclose = () => {
      console.warn('[NLQuery MCP] server process closed');
      mcpClientPromise = null;
    };

    await client.connect(transport);
    return client;
  })();

  return mcpClientPromise;
}

function textFromMcpResult(result) {
  return (result.content || [])
    .filter(part => part.type === 'text')
    .map(part => part.text || '')
    .join('\n\n');
}

async function callNaturalLanguageQuery(question) {
  const client = await getMcpClient();
  const result = await client.callTool({
    name: 'natural_language_query',
    arguments: { question },
  });

  if (result.isError) {
    throw new Error(textFromMcpResult(result) || 'MCP query failed');
  }

  return textFromMcpResult(result);
}

async function simpleQueryNode(state) {
  let mcpText;
  try {
    mcpText = await callNaturalLanguageQuery(state.query);
  } catch (e) {
    console.warn('[SimpleQuery] MCP query failed: ' + e.message);
    return {
      simpleQueryResult: 'I couldn\'t answer that question (' + e.message + '). Try rephrasing, or ask for a full risk analysis of a specific customer.',
      totalInputTokens: 0,
      totalOutputTokens: 0,
    };
  }

  const llm = new ChatAnthropic({
    model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxTokens: 800,
  });

  const answerResp = await llm.invoke([
    { role: 'system', content: ANSWER_SYSTEM },
    { role: 'user', content: 'Question: ' + state.query + '\n\nMCP tool result:\n' + mcpText },
  ]);

  const answer = typeof answerResp.content === 'string'
    ? answerResp.content
    : answerResp.content.map(b => b.text || '').join('');

  return {
    simpleQueryResult: answer,
    totalInputTokens: answerResp.usage_metadata?.input_tokens || 0,
    totalOutputTokens: answerResp.usage_metadata?.output_tokens || 0,
  };
}

module.exports = { simpleQueryNode };
