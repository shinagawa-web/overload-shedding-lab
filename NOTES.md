# NOTES

Predictions written before each run. Results appended after.

---

## Round 1 — Experiment 01: Event Loop Starvation 
### Claim

p99 latency degrades significantly even when CPU usage stays low.
A lightweight endpoint (`/light`) with no sync work also slows down while `/sync-cpu` is under load.
`monitorEventLoopDelay` lag tracks p99 latency; CPU usage does not.

### Knob

- Sync blocking weight: 0ms / 10ms / 50ms / 200ms
- Concurrency: 10 for `/sync-cpu`, 2 for `/light` (concurrent)
- Duration: 15s measure, 5s warmup (local run)

### Predictions

#### p99 latency

As sync weight increases, `/sync-cpu` p99 should degrade linearly — each request waits for the ones ahead of it in the queue.

#### Spillover to `/light`

`/light` has no sync work, so it should be fast under no load. Under `/sync-cpu` load, `/light` p99 should spike because the event loop is shared. The heavier the sync weight, the worse `/light` gets.

#### CPU usage

`Atomics.wait()` sleeps at the kernel level and does not consume CPU. CPU usage should stay low regardless of sync weight.

#### Shedding (lag threshold 70ms)

With shedding, requests exceeding the lag threshold get an immediate 503.
Expected: p99 of passing requests drops, but 503 rate rises.
The shift from "everyone slow" to "some 503, rest normal" is the trade-off to show.

---

### Results 
#### Implementation change: blocking method

Initial implementation used `while(Date.now() < end){}` (busy-wait). This saturated CPU at 100%, collapsing the "CPU has headroom" premise.
Switched to `Atomics.wait()`, which blocks the event loop without consuming CPU. This produced the low-CPU / high-p99 combination the article needs.

#### Baseline — no shedding (concurrency=10, duration=15s)

| sync weight | /light p50 | /light p99 | cpu_pct |
|---|---|---|---|
| 0ms | 0ms | 2ms | 108% |
| 10ms | 117ms | 238ms | 5.9% |
| 50ms | 529ms | 3834ms | 2.0% |
| 200ms | 1833ms | 14468ms | 1.4% |

- Prediction of "40–50% CPU" was wrong. `Atomics.wait()` does not burn CPU, so heavier blocking produces lower CPU (minimum 1.4%). The direction was correct; the magnitude was not.
- "/light degrades under `/sync-cpu` load" confirmed. sync=10ms pushed `/light` p99 to 238ms; sync=50ms to 3834ms.

#### With shedding — threshold 70ms (same conditions)

| sync weight | /light p99 | /light shed rate | cpu_pct |
|---|---|---|---|
| 0ms | 1ms | 0% | 113% |
| 10ms | 230ms | 92% (2,370 / 2,566) | 7.3% |
| 50ms | 107ms | 99% (7,448 / 7,496) | 24.4% |
| 200ms | 408ms | 99% (2,583 / 2,598) | 7.7% |

- sync=50ms: p99 3834ms → 107ms. 7,448 requests (≈97%) shed as 503.
- sync=200ms: p99 14468ms → 408ms. 2,583 shed.
- Shedding does not distinguish `/light` from `/sync-cpu` — both are subject to the same lag threshold. `/light` requests are also shed heavily. This motivates article C (priority-aware shedding).

#### Issues found and fixed

1. `setInterval` + `monitorEventLoopDelay` mean was diluted by startup samples → switched to `setTimeout`-based lag measurement.
2. `/metrics` endpoint was being shed, making CPU readings unavailable → excluded `/metrics` from the shed middleware.
3. CPU sampling happens after each stage completes, so readings may carry over from the previous stage. CI should sample continuously or use Prometheus scrape during the run.
