const { Router } = require('express')
const { httpLatency } = require('../metrics')

const router = Router()

const sharedBuf = new SharedArrayBuffer(4)
const sharedArr = new Int32Array(sharedBuf)

function blockEventLoop(ms) {
  Atomics.wait(sharedArr, 0, 0, ms)
}

router.get('/sync-cpu', (req, res) => {
  const start = Date.now()
  const ms = parseInt(req.query.ms ?? process.env.SYNC_MS ?? '0', 10)
  blockEventLoop(ms)
  res.json({ ok: true, blocked: ms })
  httpLatency.observe({ method: 'GET', route: '/sync-cpu', status: 200 }, Date.now() - start)
})

module.exports = router
