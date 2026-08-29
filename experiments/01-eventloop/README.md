# Experiment 01 — Event Loop Starvation

## 対象とSLO

外部向け Web API（モバイルアプリ・SPA のバックエンド）。SLO: p99 < 1s。3s はユーザーが体感できる失敗。

## シナリオ

### シナリオ 1: SLO はどこで割れるか

shedding なしで sync_ms を変えて p99 がどこで 1s を超えるかを測る。

- sync_ms=50: p99 ≈ 600ms → SLO 内
- sync_ms=100: p99 ≈ 1,000ms → SLO 境界
- sync_ms=200: p99 ≈ 3,000ms → SLO 違反（3s の死）

sync_ms を増やすと `/light`（sync 処理を持たない別エンドポイント）の p99 も同様に劣化することを確認する。イベントループが共有されているため、無関係なエンドポイントも巻き込まれることを示す。

### シナリオ 2: shedding で SLO を回復できるか

sync_ms=200（SLO 違反）で shedding なしと threshold=100ms を比較する。通過したリクエストの p99 が 1s 以内に戻ることと、そのコスト（503 の割合）を数字で示す。

### シナリオ 3: threshold の決め方

threshold の導出: SLO=1s、concurrency=10 のとき、1 リクエストがキューで待つ時間は最大で sync_ms × キュー深さ。キュー深さは concurrency 程度に収まるので、threshold ≈ SLO / concurrency = 1000ms / 10 = 100ms が起点になる。

threshold=50ms（厳しすぎる: sync_ms=10 のように SLO を割らないケースでも shed する）と threshold=100ms（導出値）を比較して、厳しすぎる threshold のコストを示す。

## テストパラメータ

sync_ms: [50, 100, 200]

shedding thresholds: [50, 100] ms

sync_ms=0 と sync_ms=10 は除外する。0ms は starvation が起きないベースラインで記事の主張に貢献しない。10ms は SLO 内に収まり続けるため、「どこで割れるか」の境界を示す意味がない。

## ノブ

- sync ブロッキング: `/sync-cpu` ハンドラで `Atomics.wait(sync_ms)`
- shedding: setTimeout ベースのイベントループラグ計測。ラグが threshold を超えたリクエストを即座に 503 で返す

## 計測項目

| メトリクス | 取得元 |
|---|---|
| p50/p99（ルートごと） | autocannon（単一インスタンス、50/50 ランダムパス混在） |
| rps（ルートごと） | リクエスト数 / duration |
| non2xx 数 | status >= 300 のレスポンス数 |
| CPU 使用率 | `process.cpuUsage()` → 各ステージ終了後に 1 回サンプリング |

## 実行

```
make exp01
make exp01-shed
```
