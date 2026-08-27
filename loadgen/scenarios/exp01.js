const autocannon = require('autocannon')
const http = require('http')
const BASE = process.env.APP_URL ?? 'http://localhost:3000'
const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? '10', 10)
const DURATION = parseInt(process.env.DURATION ?? '30', 10)
const WARMUP = parseInt(process.env.WARMUP ?? '10', 10)
const TIMEOUT = parseInt(process.env.REQ_TIMEOUT ?? '120', 10)

const syncMs = [0, 10, 50, 200]

function fetchCpuPercent() {
  return new Promise((resolve) => {
    http.get(`${BASE}/metrics`, (res) => {
      let body = ''
      res.on('data', d => { body += d })
      res.on('end', () => {
        const m = body.match(/^process_cpu_percent\s+([\d.]+)/m)
        resolve(m ? parseFloat(m[1]).toFixed(1) : 'n/a')
      })
    }).on('error', () => resolve('n/a'))
  })
}

async function runPair(ms) {
  if (WARMUP > 0) {
    await Promise.all([
      autocannon({ url: `${BASE}/sync-cpu?ms=${ms}`, connections: CONCURRENCY, duration: WARMUP, timeout: TIMEOUT, silent: true }),
      autocannon({ url: `${BASE}/light`, connections: CONCURRENCY, duration: WARMUP, timeout: TIMEOUT, silent: true }),
    ])
  }

  const [syncResult, lightResult] = await Promise.all([
    autocannon({ url: `${BASE}/sync-cpu?ms=${ms}`, connections: CONCURRENCY, duration: DURATION, timeout: TIMEOUT }),
    autocannon({ url: `${BASE}/light`, connections: CONCURRENCY, duration: DURATION, timeout: TIMEOUT }),
  ])

  const cpuPct = await fetchCpuPercent()

  return [
    {
      label: `sync${ms}ms-synccpu`,
      condition: 'sync-cpu',
      concurrency: CONCURRENCY,
      knob: ms,
      rps: syncResult.requests.average.toFixed(1),
      p50: syncResult.latency.p50,
      p99: syncResult.latency.p99,
      errors: syncResult.errors,
      timeouts: syncResult.timeouts,
      non2xx: syncResult.non2xx,
      cpu_pct: cpuPct,
    },
    {
      label: `sync${ms}ms-light`,
      condition: 'light',
      concurrency: CONCURRENCY,
      knob: ms,
      rps: lightResult.requests.average.toFixed(1),
      p50: lightResult.latency.p50,
      p99: lightResult.latency.p99,
      errors: lightResult.errors,
      timeouts: lightResult.timeouts,
      non2xx: lightResult.non2xx,
      cpu_pct: cpuPct,
    },
  ]
}

module.exports = { syncMs, runPair }
