# NOTES — Go Queue Experiment

## 仮説

処理数の上限（goroutine semaphore）を設定しても待ち行列が無制限なら崩壊は防げない。
効くのは「待ち行列の上限＋即時拒絶」の組み合わせ。

崩壊する場所は Node とは違う。Node はイベントループキューで詰まり /light など無関係なエンドポイントまで劣化する。Go はgoroutine が独立して動くため、負荷下でも /light は遅れない。代わりに、goroutine が積み上がるとメモリが伸びる。

## 三腕

- 腕 A（無制限）: `net/http` デフォルト。goroutine は接続ごとに 1 本。制限なし。
- 腕 B（処理上限のみ）: buffered channel を semaphore として使い WORKER_CAP 本までに制限。上限を超えた goroutine は semaphore が空くまでブロック（待ち行列は goroutine の中に積まれる）。
- 腕 C（即時拒絶）: semaphore が満杯なら即時 503。待たせない。

## ノブ

- sync_ms: 0 / 50 / 100 / 150 / 200ms
- CONCURRENCY: 50（Node の 10 より多くして腕の差を出す）
- WORKER_CAP: 10（腕 B/C のみ）

## 予想

### 腕 A（無制限）

time.Sleep は goroutine をサスペンドするだけで CPU を消費しない。50 並行接続で sync_ms=200ms の場合、50 goroutine が同時に sleep → p99 ≈ 200ms。goroutine 数はほぼ接続数分で頭打ち。Node と違い /light の p99 は上昇しない（goroutine は独立）。

OOM は起きないと予想する。50 goroutine × 数 KB = 数百 KB。

### 腕 B（semaphore=10）

50 接続に対して 10 ワーカーしか動けない。残り 40 は goroutine ごと semaphore 待ちでブロック。キュー待ち時間 ≈ (50/10 - 1) × sync_ms = 4 × sync_ms → sync_ms=200ms なら p99 ≈ 800ms 以上。

「処理上限を付けたら腕 A より p99 が悪化する」が確認されれば仮説を支持する。

### 腕 C（即時拒絶）

50 接続のうち 10 本だけ処理、40 本は即時 503。
- p99 ≈ sync_ms（通過したリクエストだけ見れば）
- 503 率 ≈ 80%（= (50 - 10) / 50）

### /light 行動

腕 A/B/C いずれでも、Go の /light p99 は Node のような枯渇は起きないと予想。ただし腕 B では goroutine がブロック中の場合、/light がそこに相乗りする可能性はある（接続を共有していないので影響は小さいはず）。

### 否定される条件

- 腕 A で p99 が sync_ms を大幅に超えた場合 → goroutine スケジューラの遅延が想定以上
- 腕 B が腕 A と同等の p99 を示した場合 → semaphore 待ちが計測に現れていない

---

*（実行後に結果を追記する）*
