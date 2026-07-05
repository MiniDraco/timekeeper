# timekeeper

A tiny, zero-dependency MCP extension that gives Claude Code a clock and a
stopwatch, so you can say things like *"work on this for 2 hours"* and Claude
can actually track the deadline instead of guessing.

It ships in two parts:

- **the clock** — an MCP server (`server.js`) exposing time + countdown-timer tools.
- **the watch** — an optional Claude Code skill (`skills/vigil`) that turns a
  time-box into an *autonomous vigil*: give Claude a seed task and an end time,
  and it uses its judgment plus your goals list to recursively expand scope and
  keep pushing meaningful work for the whole duration, instead of stopping the
  second the literal ask is met. See [The vigil skill](#the-vigil-skill) below.

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

## The vigil skill

`skills/vigil/SKILL.md` is a Claude Code skill that builds on the clock. Where
the MCP tools let Claude *know* the time, the vigil skill changes what it *does*
with a time-box.

Say **"work on X for 2 hours"** and, with the skill installed, Claude will:

1. Start a `vigil` timer (via the clock) and state the explicit end time.
2. Survey your goals list (the memory index) so expansion is grounded in real
   priorities, not invention.
3. Work in cycles, and after each completed sub-goal **recurse** instead of
   stopping — *deepen* (harden/verify what it just did), *widen* (take the next
   piece of the same project), or *ascend* (pick the next-highest-leverage goal
   for the realm) — narrating the growing scope tree out loud so you can steer.
4. Poll the timer every cycle and keep going until it expires; only breaking
   early for something genuinely blocking (a credential, an irreversible or
   public action, a real fork in intent).
5. On expiry, deliver a **campaign report** — the scope tree, what was verified,
   what's blocked, and where the next vigil should start.

It carries guardrails: it won't push public, break live installs, or take
irreversible/outward-facing actions without a check, and it leans on judgment
rules like *act don't over-ask* and *don't bail to easy wins when the hard path
fights back*.

**Install the skill** (per user):

```bash
mkdir -p ~/.claude/skills
cp -r skills/vigil ~/.claude/skills/vigil
```

Then it auto-triggers on "do X for N hours / until <time>" phrasing, or invoke
it deliberately: `/vigil <task> until <time>`.

**Spanning the full duration.** A single response turn can't run for two real
hours, so pair the skill with Claude Code's `/loop` for the wall-clock
heartbeat:

```
/loop 5m /vigil harden the parser until 4pm
```

Each firing, Claude checks the timer, does a cycle of real work, and stops the
loop once the timer reads expired.

> Note: the vigil skill is a **standing grant of autonomy**. Install it only if
> you actually want Claude to keep working and expanding scope without asking
> between steps. The clock (MCP server) is useful on its own without it.

## Why zero-dependency?

The MCP stdio protocol (newline-delimited JSON-RPC 2.0) is implemented by hand
in `server.js`. Nothing to `npm install`, nothing to break — just Node.
