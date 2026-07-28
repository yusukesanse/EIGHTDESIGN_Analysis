# EIGHTDESIGN_Analysis

エイトデザインのドメインごと分析一覧表のGoogle Apps Script

## Kintone同期

Webhook処理は、Kintoneレコードを検証・正規化して対象一覧へ追加／更新した後、
更新後の一覧を読み直し、対応するドメイン集計シート1枚を全面再計算します。
既存集計への差分加算・減算は行いません。

処理順:

1. Webhookの形式、event type、record ID、revision、業務フィールドを検証
2. 対象の「地域 × ドメイン」一覧を決定
3. 18一覧の顧客名出現数を検査し、同名複数・別target残存を安全停止
4. ScriptLock内で一覧を追加／更新
5. `SpreadsheetApp.flush()` 後に一覧を再取得
6. 対応する集計シートを全面再計算
7. 集計シートを再取得して書き込み値を検証
8. `_SYNC_EVENTS`へ成功／失敗、段階、対象、処理時間を記録

主な実行関数:

- `doPost(e)` / `handleWebhook(e)`: Webhook受信と対象1組の即時再集計
- `runDomainAggregationForSheet(domainType, area)`: 指定1組の手動全面再集計
- `runDomainAggregation()`: 9ドメイン × 2地域、全18組の定期／手動全面再集計
- `runKintoneReconciliationDryRun()`: Kintone原本と18一覧の差分確認

定期実行する環境では、Apps Scriptの時間主導トリガーに
`runDomainAggregation()`を登録してください。このリポジトリのコードは
既存トリガーを自動作成・変更しません。

`runKintoneReconciliationDryRun()` は修復・移動・削除を行わず、
`_SYNC_DIFFS`へ欠落、一覧または同一Kintoneアプリ内の同名複数、誤配置、
所有列不一致、一覧だけの行を記録します。旧11列の`_SYNC_DIFFS`は既存行を
変更せず、`actualLocations`列だけを末尾へ追加します。
Kintone取得には次のScript Propertiesが必要です。

- `KINTONE_BASE_URL`
- `KINTONE_CUSTOMER_API_TOKEN`
- `KINTONE_SALES_API_TOKEN`

### 安定ID移行前の安全制約

現行一覧にはKintoneの安定ID列がなく、顧客アプリと営業アプリを結ぶ共通顧客IDも
未定義です。そのため、既に成功履歴があるレコードで地域・ドメイン・顧客名の変更を
検出した場合、18一覧に同名行が複数ある場合、別targetに同名行が残る場合は、
新旧一覧へ二重登録せず `IDENTITY_CHECK` で失敗させます。旧`_SYNC_EVENTS`の
成功行に`customerName`が無い場合も、照合・移行前は保守停止します。
削除Webhookも同じ理由で自動削除しません。`_SYNC_DIFFS`の確認後、共通顧客IDと
一覧側ID列の移行を完了してから、安全な改名・移動・削除処理を有効化してください。

## ローカルテスト

実API・実スプレッドシートへ接続しないNode.jsテストです。

```bash
node --test 'tests/**/*.test.mjs'
```
