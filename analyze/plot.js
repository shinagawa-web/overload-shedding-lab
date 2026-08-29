const fs = require('fs')

const csvFile = process.argv[2] ?? 'results.csv'
const lines = fs.readFileSync(csvFile, 'utf8').trim().split('\n')
const [headerLine, ...dataLines] = lines
const keys = headerLine.split(',')

const rows = dataLines.map(l => {
  const vals = l.split(',')
  return Object.fromEntries(keys.map((k, i) => [k, vals[i]]))
})

const knobs = [...new Set(rows.map(r => r.knob))].sort((a, b) => +a - +b)

const lightRows = rows.filter(r => r.condition === 'light')
const syncRows = rows.filter(r => r.condition === 'sync-cpu')

function p99ByKnob(data) {
  return knobs.map(k => data.find(r => r.knob === k)?.p99 ?? 0)
}

const lightP99 = p99ByKnob(lightRows)
const syncP99 = p99ByKnob(syncRows)

const xLabels = knobs.map(k => `"${k}ms"`).join(', ')

const chart = `\`\`\`mermaid
xychart-beta
  title "p99 latency by sync weight (ms)"
  x-axis [${xLabels}]
  y-axis "p99 (ms)" 0 --> ${Math.max(...lightP99, ...syncP99) + 50}
  bar [${lightP99.join(', ')}]
  bar [${syncP99.join(', ')}]
\`\`\``

function valueByKnob(data, key) {
  return knobs.map(k => data.find(r => r.knob === k)?.[key] ?? 'n/a')
}

const lightLag = valueByKnob(lightRows, 'lag_p99')
const syncCpu = valueByKnob(syncRows, 'cpu_pct')

const table = [
  '| sync weight | system cpu (%) | eventloop lag p99 (ms) | /light p99 (ms) | /sync-cpu p99 (ms) |',
  '|---|---|---|---|---|',
  ...knobs.map((k, i) => {
    return `| ${k}ms | ${syncCpu[i]} | ${lightLag[i]} | ${lightP99[i]} | ${syncP99[i]} |`
  }),
].join('\n')

const summary = `## Experiment 01 — Event Loop Starvation

Claim: p99 spikes even when CPU has headroom. The unrelated lightweight endpoint (/light) degrades too.

### Knob: sync blocking weight (${knobs.join(' / ')} ms)

${chart}

Left bar = /light p99, Right bar = /sync-cpu p99. x-axis is categorical (not to scale: 0, 50, 100, 200 ms).

${table}

> /light has no sync work. Measured concurrently with load on /sync-cpu.
`

process.stdout.write(summary)
