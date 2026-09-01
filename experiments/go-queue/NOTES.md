# NOTES — Go Queue Experiment

## 仮説

処理数の上限（goroutine semaphore）を設定しても待ち行列が無制限なら崩壊は防げない。
効くのは「待ち行列の上限＋即時拒絶」の組み合わせ。

崩壊する場所は Node とは違う。Node はイベントループキューで詰まり /light など無関係なエンドポイントまで劣化する。Go はgoroutine が独立して動くため、負荷下でも /light は遅れない。代わりに、goroutine が積み上がるとメモリが伸びる。

## 条件

- 条件 A（無制限）: `net/http` デフォルト。goroutine は接続ごとに 1 本。制限なし。
- 条件 B（処理上限のみ）: buffered channel を semaphore として使い WORKER_CAP 本までに制限。上限を超えた goroutine は semaphore が空くまでブロック（待ち行列は goroutine の中に積まれる）。
- 条件 C（即時拒絶）: semaphore が満杯なら即時 503。待たせない。

## ノブ

- sync_ms: 0 / 50 / 100 / 150 / 200ms
- CONCURRENCY: 50（Node の 10 より多くして条件の差を出す）
- WORKER_CAP: 10（条件 B/C のみ）

## 予想

### 条件 A（無制限）

time.Sleep は goroutine をサスペンドするだけで CPU を消費しない。50 並行接続で sync_ms=200ms の場合、50 goroutine が同時に sleep → p99 ≈ 200ms。goroutine 数はほぼ接続数分で頭打ち。Node と違い /light の p99 は上昇しない（goroutine は独立）。

OOM は起きないと予想する。50 goroutine × 数 KB = 数百 KB。

### 条件 B（semaphore=10）

50 接続に対して 10 ワーカーしか動けない。残り 40 は goroutine ごと semaphore 待ちでブロック。キュー待ち時間 ≈ (50/10 - 1) × sync_ms = 4 × sync_ms → sync_ms=200ms なら p99 ≈ 800ms 以上。

「処理上限を付けたら条件 A より p99 が悪化する」が確認されれば仮説を支持する。

### 条件 C（即時拒絶）

50 接続のうち 10 本だけ処理、40 本は即時 503。
- p99 ≈ sync_ms（通過したリクエストだけ見れば）
- 503 率 ≈ 80%（= (50 - 10) / 50）

### /light 行動

条件 A/B/C いずれでも、Go の /light p99 は Node のような枯渇は起きないと予想。ただし条件 B では goroutine がブロック中の場合、/light がそこに相乗りする可能性はある（接続を共有していないので影響は小さいはず）。

### 否定される条件

- 条件 A で p99 が sync_ms を大幅に超えた場合 → goroutine スケジューラの遅延が想定以上
- 条件 B が条件 A と同等の p99 を示した場合 → semaphore 待ちが計測に現れていない

---

## 結果（ローカル実測、CONCURRENCY=50, DURATION=4s, WARMUP=1s）

| 条件 | sync_ms | /sync-cpu p99 (ms) | /light p99 (ms) | 503率 | goroutines_peak |
|------|---------|-------------------|----------------|-------|----------------|
| A（無制限） | 0 | 2 | 2 | 0% | 54 |
| A（無制限） | 200 | 205 | 4 | 0% | 103 |
| B（処理上限=10） | 0 | 2 | 2 | 0% | 54 |
| B（処理上限=10） | 200 | 1801 | 5 | 0% | 143 |
| C（即時拒絶=10） | 0 | 2 | 2 | 0% | 55 |
| C（即時拒絶=10） | 200 | 2 | 2 | 99.8% | 65 |

### 確認できたこと

条件 A: /sync-cpu p99 ≈ 200ms。goroutine が独立して動くため /light は 4ms のまま。Node と根本的に違う点（Node は /light が 2823ms まで劣化した）。

条件 B: /sync-cpu p99 が 205ms → 1801ms に跳ね上がった。処理数上限（semaphore=10）をつけることで 50 接続のうち 40 本が goroutine ごとブロック待ちになり、p99 が悪化した。「処理数上限を付けると条件 A より p99 が悪化する」は確認された。/light は 5ms で安定。goroutine はブロック中でも他の goroutine に干渉しない。

条件 C: 503 率 99.8%。WORKER_CAP=10 に対して CONCURRENCY=50 が大きすぎる。p99 は即時 503 が支配するため 2ms。通過した 0.2% のリクエストは ≈200ms で処理されているはず（計測値には現れない）。

### Node との比較

Node (sync_ms=200ms, CONCURRENCY=10): /light p99 = 2823ms
Go A (sync_ms=200ms, CONCURRENCY=50): /light p99 = 4ms

負荷が 5 倍多いにもかかわらず /light は劣化しない。崩壊の仕組みが根本的に異なることが実測で確認できた。

## Round 2 — burnCPU の実装を JSON → math ループで比較

### 背景

Round 1 で time.Sleep を使っていたことが発覚。CPU を焼かない sleep は Node の blockEventLoop（JSON.parse ビジーループ）と比較対象にならない。burnCPU を JSON marshal/unmarshal ループに変えて再計測した。

### 結果（JSON ループ、CONCURRENCY=50, sync_ms=200ms）

- /sync-cpu p99: 628ms（sleep の 205ms から大幅増。CPU 競合が出た）
- /light p99: 251ms（sleep の 4ms から大幅増）
- mem_mb: 276MB、GC サイクル 1554回/26秒（約 60回/秒）

### GC が原因かを確かめる

GODEBUG=gctrace=1 で GC が実際に動いていることを確認。次にアロケートしない math ループ（`x = x*1.0000001 + 0.0000001`）に変えて再計測。

| 版 | GC 回数/26秒 | mem_mb | /sync-cpu p99 | /light p99 |
|----|------------|--------|--------------|-----------|
| JSON ループ | 1554 | 276MB | 628ms | 251ms |
| math ループ | 230（負荷中は数回） | 18MB | 534ms | 335ms |

GC はほぼ消えたが /light p99 は改善しなかった（335ms）。

### 結論

/light の劣化は GC が原因ではない。CPU 競合が原因。sync-cpu goroutine が CPU コアを占有するため、/light goroutine がスケジューラの順番待ちになっている。

math ループは JSON より高速なので goroutine が CPU をより密に占有し、/light がむしろ遅れた（335ms > 251ms）。

### 次の課題

条件 C の WORKER_CAP をもっと大きく設定（例: 40）すれば、503 率を下げながら p99 も改善できるはず。CI では syncMs を 5 段階に戻して WORKER_CAP を適切な値で実行する。

