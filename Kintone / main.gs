/**
 * main.gs
 * エントリポイントのみを保持する
 * ビジネスロジックを持たない安定レイヤー
 */

/**
 * kintoneからのWebhookを受信するエントリポイント
 * すべての処理は handleWebhook() に委譲する
 *
 * @param {Object} e - Google Apps Script POSTイベントオブジェクト
 * @returns {ContentService.TextOutput}
 */
function doPost(e) {
  return handleWebhook(e);
}