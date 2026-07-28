# tests/ — 特性テスト（characterization tests）

Kintone 連携コード（`.gs`＝Webhook 受信〜一覧シート書き込み、およびドメインシート集計）の**挙動を固定**するための開発専用テストです。
リファクタリング時に挙動が意図せず変わっていないことを検知する安全網として使います。

## 位置づけ・制約

- **開発専用。GAS へはデプロイしない**（`.clasp.json` は無く、GAS へは手動コピー運用のため、この `tests/` フォルダをコピーしなければ本番に影響しない）。
- **外部 npm パッケージ不使用**。Node.js 標準の `node:test` / `node:assert` / `node:fs` / `node:path` / `node:url` のみ。
- **実 API・実データ・秘密情報へ一切アクセスしない**。GAS プラットフォーム API（`SpreadsheetApp`・`PropertiesService`・`UrlFetchApp` など）は `harness/loadGas.mjs` のスタブで代替する。
- `.gs` ファイルは**読み取るだけ**。テスト実行で本番コードは書き換えない。

## 実行方法

Node.js 18 以降（確認環境は v24）で、リポジトリ直下から:

```bash
node --test 'tests/**/*.test.mjs'
```

## 構成

| ファイル | 対象 |
|---|---|
| `harness/loadGas.mjs` | `.gs` 群をホストレルム上で評価し関数・定数を公開するローダ＋フェイクシート |
| `characterization/transforms.test.mjs` | 日付変換・正規化・ランク/年収/イベント変換・担当者・商談履歴パーサ |
| `characterization/validation.test.mjs` | Webhook 検証（正常/JSON不正/app.id欠如/record欠如/未対応appId/必須不足） |
| `characterization/normalizedRecord.test.mjs` | 正規化済みモデル `buildNormalizedRecord` |
| `characterization/rowData.test.mjs` | 一覧行データ生成（顧客/営業/住宅・新築/法人）。バグA（家族数）・D（分類フラグ）修正を固定 |
| `characterization/rowSearch.test.mjs` | 行探索・挿入・書き込み。バグB（末尾追加）・C（指定列のみ書込）修正を固定 |
| `characterization/aggregation.test.mjs` | 全管理年度の全面再計算、ファネル/月別/担当者別/媒体/エリア/各詳細ブロック、分類不能値の事前停止を固定 |
| `characterization/ledger.test.mjs` | `_SYNC_EVENTS` / `_SYNC_JOBS` の行形式、revision・最新target参照、ログ値の無害化 |
| `characterization/reconciliation.test.mjs` | 18一覧横断の欠落・一覧／同一アプリ原本の同名複数・誤配置・所有列不一致・余剰行判定とIDページング |
| `integration/webhookAggregation.test.mjs` | 一覧更新→flush→対象1組全面再計算→再読込検証→成功／失敗ログの統合経路 |
| `integration/aggregationLogging.test.mjs` | 定期18組の開始／終了ログ障害を成功扱いにせず、集計元エラーを保持する経路 |
| `integration/reconciliation.test.mjs` | 実APIへ接続せず、18一覧を変更しないdry-run照合と`_SYNC_DIFFS`一括記録を確認 |

## 補足

書き込み経路の明確なバグ4件（`docs/PROJECT_CONTEXT.md` §11-A の A〜D）は
新挙動を固定済みです。Webhookのrevision冪等性・ScriptLock・更新後一覧からの
全面再計算も統合テストで固定しています。

一覧行の安定IDと2アプリ間の共通顧客IDは未導入です。地域・ドメイン・顧客名変更と
削除は誤更新を避けるため成功扱いにせず、dry-run照合後のID移行が必要です。
