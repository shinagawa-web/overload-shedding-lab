# Experiment 01 — Event Loop Starvation

Verification for article A: "CPU is fine, but p99 spikes."

## Claim

p99 latency degrades significantly even when CPU usage stays around 40–50%.
A lightweight endpoint (`/light`) with no sync work also slows down while `/sync-cpu` is under load.
`monitorEventLoopDelay` lag p99 tracks p99 latency, not CPU usage.

## Knob

Sync processing weight: 0ms / 10ms / 50ms / 200ms

## Measurements

| Metric | Source |
|---|---|
| `/light` p50/p99 | autocannon (concurrent with `/sync-cpu` load) |
| `/sync-cpu` p50/p99 | autocannon |
| Event loop lag p99 | `monitorEventLoopDelay` → prom-client |
| CPU usage | `process.cpuUsage()` → prom-client |

## Run

```
make exp01          # no shedding
make exp01-shed     # with shedding (SHED_THRESHOLD_MS=70)
```

## Artifacts

- `results-baseline.csv` — no shedding
- `results-shed.csv` — with shedding
- `summary.md` — Mermaid chart + table
