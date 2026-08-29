# experiments/01-eventloop NOTES

協議ラウンドごとの記録。予想は実行前に書き、結果を後に追記する。

## Round 3 — JSON.parse + system CPU 正規化

### 経緯

Round 1・2 は `Atomics.wait()` で event loop をブロックしていた。これはスリープと同等で CPU を消費しない（cpu_pct が 0.4〜2.7% に留まる）。

記事 A の主張「CPU に余裕があるのに p99 が跳ねる」を示すためには、CPU を実際に使うブロッキングが必要という判断をした。

候補として以下を検討した:

- JSON.parse ループ（CPU バウンド、外部依存なし）
- fs.readFileSync（I/O バウンド、CPU 低い → Atomics.wait と実質同じ）
- ORM の結果マッピング（DB 依存、2026 年の ORM はすべて async のため現実的でない）
- 同期 crypto（CPU バウンド、外部依存なし）

JSON.parse を選んだ理由: CPU を実際に消費しながら event loop をブロックする。現実の本番コードで大きな JSON レスポンスを parse する場面に対応する。外部依存なし。

Atomics.wait を採用しなかった理由: CPU を使わないため、マルチコアマシンでシステム CPU が低く見えるという「記事の核」を示せない。また、現実の本番コードにこのパターンは存在しない。

### 変更点

- ブロッキング実装: `Atomics.wait()` → `JSON.parse` デッドラインループ
  ```js
  const PAYLOAD = JSON.stringify(
    Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `item-${i}`, value: 'x'.repeat(200) }))
  )
  function blockEventLoop(ms) {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { JSON.parse(PAYLOAD) }
  }
  ```
- CPU 計測: `process_cpu_percent`（プロセス単体）→ `process_cpu_percent / os.cpus().length`（システム CPU）
- sync_ms: [0, 10, 50, 200] → [50, 100, 200]（0ms と 10ms は starvation が起きないため除外）
- 負荷比率: sync-cpu:light = 1:1 → 1:2
- `lag_p99` 列を追加（`monitorEventLoopDelay` の p99、テスト中 3 秒ごとにサンプルして max を記録）

### 実行前予想

CPU: JSON.parse は CPU バウンドなので、プロセス CPU は 1 コア分（~100%）を消費するはず。`os.cpus().length` で正規化するとシステム CPU は 100/N%（N = コア数）になる。GitHub Actions ubuntu-latest は 2 コアと思われるので ~50% を予想。

lag_p99: sync_ms に比例して上昇するはず。`Atomics.wait` 時代より高い値が出る（CPU を実際に使うため、event loop の詰まりが顕在化する）。

/light の劣化: イベントループ共有なので、sync_ms を上げると /light p99 も上昇するはず。

### 結果（CI run #33128308712、add-exp01 ブランチ）

`os.cpus().length` の実測値: 4（正規化前 103.4%、正規化後 25.6% → 103.4/25.6 ≈ 4.04）。GitHub Actions ubuntu-latest は 4 vCPU だった。予想の 2 コアは外れた。

system CPU は 25.4〜25.7% で sync_ms によらず一定。「CPU に余裕がある」がシステム CPU の数字として出た。

lag_p99 は 358→612→817ms と sync_ms に比例して上昇。CPU と lag の解離が数字で確認できた。

/light の p99 は 357ms→811ms→1,843ms と sync_ms に比例して劣化。sync50ms では lag_p99=358ms、/light p99=357ms とほぼ一致し、イベントループの詰まり時間がそのまま無関係エンドポイントのレイテンシに乗ることが確認できた。

#### Baseline 実測値（shedding なし）

| sync_ms | system cpu | lag_p99 | /sync-cpu p99 | /light p99 |
|---------|-----------|---------|---------------|-----------|
| 50ms | 25.6% | 358ms | 406ms | 357ms |
| 100ms | 25.7% | 612ms | 714ms | 811ms |
| 200ms | 25.4% | 817ms | 1,618ms | 1,843ms |

#### shedding あり（threshold=100ms）

| sync_ms | system cpu | lag_p99 | /sync-cpu p99 | /light p99 | shed率 |
|---------|-----------|---------|---------------|-----------|--------|
| 50ms | 25.9% | 310ms | 252ms | 205ms | 95% |
| 100ms | 25.9% | 630ms | 401ms | 304ms | 97% |
| 200ms | 25.7% | 1,247ms | 616ms | 603ms | 97% |

### 観察

- shedding を入れると通過したリクエストの p99 は回復するが、lag_p99 は sync200ms で 817ms→1,247ms に増加する。shed された分の CPU がまとまって通過リクエストに使われるため。
- shedding は /sync-cpu と /light を区別しない。/light も同じ threshold で 503 になる。
- shed 率が 93〜98% と高い。threshold=100ms でも sync50ms（SLO 内）の大半が shed される。threshold の導出（SLO/concurrency）は現実の concurrency に対して過剰に厳しい可能性がある。
