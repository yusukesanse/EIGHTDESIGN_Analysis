# tests/ — 特性テスト（characterization tests）

Kintone 連携コード（`.gs`＝Webhook 受信〜一覧シート書き込み）の**挙動を固定**するための開発専用テストです。
リファクタリング時に挙動が意図せず変わっていないことを検知する安全網として使います。
（グラフ集計は削除済み。集計はスプレッドシートの数式で行う方針のため、テスト対象外。）

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

## 補足

「現状」を記録する特性テストです。書き込み経路の明確なバグ4件（`docs/PROJECT_CONTEXT.md` §11-A の A〜D）は
**新挙動（正しい挙動）に更新済み**で、対応テストが新挙動を固定しています。未対応の設計課題（顧客名による行識別・
冪等性・排他制御・匿名アクセス）は §11-B を参照。挙動を変更する場合は該当テストの期待値を「旧→新」として更新し、
変更理由とともに報告します。
