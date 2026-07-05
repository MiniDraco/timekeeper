#!/usr/bin/env node
/*
 * timekeeper — a tiny, zero-dependency MCP server that gives Claude a clock.
 *
 * Tools:
 *   get_current_time  - what time is it right now
 *   start_timer       - begin a countdown ("do this for 2 hours")
 *   check_timer       - how much time is left / has it expired
 *   list_timers       - all active timers
 *   cancel_timer      - stop a timer
 *
 * Transport: stdio, newline-delimited JSON-RPC 2.0 (the MCP stdio spec).
 * No external packages — the protocol is implemented by hand so there is
 * nothing to install and nothing to break.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const STORE = path.join(__dirname, 'timers.json');
const SERVER_INFO = { name: 'timekeeper', version: '1.0.0' };
const PROTOCOL_VERSION = '2024-11-05';

// ---------------------------------------------------------------------------
// timer persistence
// ---------------------------------------------------------------------------
function loadTimers() {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'));
  } catch {
    return {};
  }
}

function saveTimers(timers) {
  try {
    fs.writeFileSync(STORE, JSON.stringify(timers, null, 2));
  } catch {
    /* best-effort; timers are a convenience, not the source of truth */
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
// Parse "2h", "30m", "90s", "1h30m", "1h 30m 15s", or a bare number (seconds).
function parseDuration(input) {
  if (input == null) return null;
  if (typeof input === 'number') return Math.round(input);
  const str = String(input).trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(str)) return Math.round(parseFloat(str)); // bare = seconds
  const re = /(\d+(?:\.\d+)?)\s*(h|hr|hours?|m|min|mins?|minutes?|s|sec|secs?|seconds?)/g;
  let total = 0;
  let matched = false;
  let m;
  while ((m = re.exec(str)) !== null) {
    matched = true;
    const value = parseFloat(m[1]);
    const unit = m[2];
    if (unit.startsWith('h')) total += value * 3600;
    else if (unit.startsWith('m')) total += value * 60;
    else total += value;
  }
  return matched ? Math.round(total) : null;
}

// Human-friendly "1h 5m 12s"
function humanizeSeconds(sec) {
  const neg = sec < 0;
  sec = Math.abs(Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return (neg ? '-' : '') + parts.join(' ');
}

function nowInfo() {
  const d = new Date();
  return {
    iso: d.toISOString(),
    local: d.toString(),
    unix_ms: d.getTime(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

// ---------------------------------------------------------------------------
// tool definitions
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    name: 'get_current_time',
    description:
      'Return the current date and time (ISO 8601, local string, and unix ms). ' +
      'Call this whenever you need to know what time it is right now.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'start_timer',
    description:
      'Start a named countdown timer. Use this when the user asks you to do ' +
      'something for a fixed amount of time (e.g. "work on this for 2 hours"). ' +
      'Then poll check_timer to see how much time is left and stop when it expires.',
    inputSchema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: 'A short name for the timer, e.g. "refactor" or "session".',
        },
        duration: {
          type: 'string',
          description:
            'How long the timer runs. Accepts "2h", "30m", "90s", "1h30m", ' +
            'or a bare number of seconds.',
        },
      },
      required: ['label', 'duration'],
      additionalProperties: false,
    },
  },
  {
    name: 'check_timer',
    description:
      'Check a running timer: how long it has been running, how much time ' +
      'remains, and whether it has expired. Poll this periodically while ' +
      'working on a time-boxed task.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'The timer name passed to start_timer.' },
      },
      required: ['label'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_timers',
    description: 'List all timers with their remaining time and status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'cancel_timer',
    description: 'Cancel (delete) a named timer.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'The timer name to cancel.' },
      },
      required: ['label'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// tool implementations
// ---------------------------------------------------------------------------
function timerStatus(label, t) {
  const now = Date.now();
  const elapsed = (now - t.started_ms) / 1000;
  const remaining = (t.deadline_ms - now) / 1000;
  const expired = remaining <= 0;
  return {
    label,
    duration: humanizeSeconds(t.duration_s),
    started: new Date(t.started_ms).toISOString(),
    deadline: new Date(t.deadline_ms).toISOString(),
    elapsed: humanizeSeconds(elapsed),
    elapsed_seconds: Math.round(elapsed),
    remaining: expired ? '0s' : humanizeSeconds(remaining),
    remaining_seconds: Math.max(0, Math.round(remaining)),
    expired,
    status: expired ? 'EXPIRED — stop now' : 'running',
  };
}

function callTool(name, args) {
  args = args || {};
  switch (name) {
    case 'get_current_time':
      return nowInfo();

    case 'start_timer': {
      const seconds = parseDuration(args.duration);
      if (!seconds || seconds <= 0) {
        throw new Error(
          `Could not parse duration "${args.duration}". Try "2h", "30m", "90s", or a number of seconds.`
        );
      }
      if (!args.label) throw new Error('A "label" is required.');
      const timers = loadTimers();
      const started = Date.now();
      timers[args.label] = {
        duration_s: seconds,
        started_ms: started,
        deadline_ms: started + seconds * 1000,
      };
      saveTimers(timers);
      return {
        message: `Timer "${args.label}" started for ${humanizeSeconds(seconds)}.`,
        ...timerStatus(args.label, timers[args.label]),
      };
    }

    case 'check_timer': {
      const timers = loadTimers();
      const t = timers[args.label];
      if (!t) throw new Error(`No timer named "${args.label}". Active: ${Object.keys(timers).join(', ') || '(none)'}`);
      return timerStatus(args.label, t);
    }

    case 'list_timers': {
      const timers = loadTimers();
      const labels = Object.keys(timers);
      if (labels.length === 0) return { timers: [], message: 'No active timers.' };
      return { timers: labels.map((l) => timerStatus(l, timers[l])) };
    }

    case 'cancel_timer': {
      const timers = loadTimers();
      if (!timers[args.label]) throw new Error(`No timer named "${args.label}".`);
      delete timers[args.label];
      saveTimers(timers);
      return { message: `Timer "${args.label}" cancelled.` };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC / MCP plumbing
// ---------------------------------------------------------------------------
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function handle(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
      return;

    case 'notifications/initialized':
      return; // notification, no response

    case 'ping':
      reply(id, {});
      return;

    case 'tools/list':
      reply(id, { tools: TOOLS });
      return;

    case 'tools/call': {
      const toolName = params && params.name;
      const toolArgs = (params && params.arguments) || {};
      try {
        const result = callTool(toolName, toolArgs);
        reply(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
      } catch (err) {
        reply(id, {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        });
      }
      return;
    }

    default:
      if (id !== undefined) replyError(id, -32601, `Method not found: ${method}`);
  }
}

// Read newline-delimited JSON from stdin.
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      handle(JSON.parse(line));
    } catch {
      /* ignore malformed lines */
    }
  }
});

process.stdin.on('end', () => process.exit(0));
