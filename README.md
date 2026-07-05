# timekeeper

A tiny, zero-dependency MCP extension that gives Claude Code a clock and a
stopwatch, so you can say things like *"work on this for 2 hours"* and Claude
can actually track the deadline instead of guessing.

## Tools it adds

| Tool | What it does |
|------|--------------|
| `get_current_time` | Current date/time (ISO, local, unix ms, timezone). |
| `start_timer` | Begin a named countdown, e.g. `label="session", duration="2h"`. |
| `check_timer` | How long it's run, how much is left, whether it expired. |
| `list_timers` | All active timers + status. |
| `cancel_timer` | Stop a timer. |

Durations accept `2h`, `30m`, `90s`, `1h30m`, or a bare number of seconds.

## How to use it

Just talk to Claude:

> "Refactor the parser and keep testing edge cases for 2 hours — check the clock
> as you go and stop when time's up."

Claude will call `start_timer` once, then poll `check_timer` between chunks of
work. When `expired: true` comes back, it stops.

**Note on "check every few seconds":** Claude only acts when it's doing
something — it can't fire on a real-time interval by itself. It checks the timer
naturally between steps of work. For a true wall-clock heartbeat (wake up every
N seconds even while idle), pair this with Claude Code's `/loop` command:
`/loop 30s check the timer and keep going`.

## Install (already done on this machine)

Registered at user scope with:

```bash
claude mcp add timekeeper --scope user -- node "D:/Users/gamma/Documents/Claude/Projects/timekeeper/server.js"
```

To remove: `claude mcp remove timekeeper --scope user`
To verify: `claude mcp list`

Timers persist to `timers.json` next to the server, so they survive across
Claude Code sessions until they expire or you cancel them.

## Why zero-dependency?

The MCP stdio protocol (newline-delimited JSON-RPC 2.0) is implemented by hand
in `server.js`. Nothing to `npm install`, nothing to break — just Node.
