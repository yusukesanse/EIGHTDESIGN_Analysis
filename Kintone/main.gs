/**
 * main.gs — エントリ・Webhook制御・書き込み振り分け（旧 main.gs + webhookHandler.gs）
 */

// ============================================================
// エントリポイント doPost
// ============================================================

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

// ============================================================
// Webhookハンドラ
// ============================================================

/**
 * kintoneからのWebhookを受信し、サービス層・シート層に処理を委譲する
 *
 * @param {Object} e - Google Apps Script POSTイベントオブジェクト
 * @returns {ContentService.TextOutput} JSON形式のレスポンス
 */
function handleWebhook(e) {
  const timer = AppLogger.startTimer('handleWebhook');

  try {
    // ── 1. リクエストパース & バリデーション ──────────────────
    const { appId, record, type } = parseWebhookBody(e.postData.contents);

    _validateRecordByApp(appId, record);

    // ── 2. 正規化済みモデルの構築（抽出・正規化はここに集約）──
    const model = buildNormalizedRecord(appId, record, type);

    AppLogger.info('Webhook受信', {
      appId,
      customerName:  model.customerName,
      customerType:  model.customerType,
      promotionArea: model.promotionArea,
    });

    // ── 3. 対象シートの取得 ──────────────────────────────────
    const listSheet = getListSheet(model.customerType, model.promotionArea);

    if (!listSheet) {
      throw new Error(`一覧シートが見つかりません: customerType=${model.customerType}, area=${model.promotionArea}`);
    }

    // ── 4. シートデータ取得（1回のみ）───────────────────────
    const listData = getFormattedSheetData(listSheet);

    // ── 5. アプリ種別ごとの書き込み処理 ─────────────────────
    _dispatchWrite(model, listData, listSheet);

    timer.stop();
    return _jsonResponse({ result: 'success' });

  } catch (err) {
    AppLogger.error('Webhook処理エラー', err, { functionName: 'handleWebhook' });
    timer.stop();
    return _jsonResponse({ error: err.message }, true);
  }
}

// ============================================================
// アプリ種別ごとの処理レジストリ
// ============================================================

/**
 * アプリID → その種別の処理（検証・抽出・書き込み）を返す。
 * 対応アプリを増やすときは、この表に1エントリ追加するだけでよい。
 * 「未対応のアプリID」判定もここ1箇所に集約する。
 * （GAS のロード順に依存しないよう、定数・関数の参照は呼び出し時に解決する）
 *
 * @param {string} appId
 * @returns {{ validate: Function, extract: Function, write: Function }}
 * @throws {Error} 未対応アプリIDの場合
 */
function _appHandler(appId) {
  const handlers = {
    [CUSTOMER_APP_ID]: {
      validate: validateCustomerRecord,
      extract:  extractCustomerFields,
      write:    _writeCustomerRow,
    },
    [SALES_APP_ID]: {
      validate: validateSalesRecord,
      extract:  extractSalesFields,
      write:    _writeSalesRow,
    },
  };

  const handler = handlers[appId];
  if (!handler) throw new Error(`未対応のアプリID: ${appId}`);
  return handler;
}

/**
 * アプリIDに応じたレコードバリデーションを実行する
 * @param {string} appId
 * @param {Object} record
 */
function _validateRecordByApp(appId, record) {
  _appHandler(appId).validate(record);
}

/**
 * アプリIDに応じたフィールド抽出を実行する
 * @param {string} appId
 * @param {Object} record
 * @returns {Object} 抽出済みフィールドデータ
 */
function _extractFieldsByApp(appId, record) {
  return _appHandler(appId).extract(record);
}

/**
 * 正規化済みモデルに応じたシート書き込みを実行する
 * @param {Object} model - buildNormalizedRecord() の戻り値
 * @param {Array} sheetData
 * @param {GoogleAppsScript.Spreadsheet.Sheet} listSheet
 */
function _dispatchWrite(model, sheetData, listSheet) {
  _appHandler(model.appId).write(model, sheetData, listSheet);
}

/**
 * 顧客情報アプリの行データを生成して一覧シートへ書き込む
 * @param {Object} model
 * @param {Array} sheetData
 * @param {GoogleAppsScript.Spreadsheet.Sheet} listSheet
 */
function _writeCustomerRow(model, sheetData, listSheet) {
  const rowData = buildCustomerRowData(model.customerFields);
  writeCustomerRecord(
    listSheet, sheetData, rowData,
    model.customerName, model.aggregationYear, model.aggregationMonth,
  );
}

/**
 * 営業・商談管理アプリの行データを生成して一覧シートへ書き込む
 * @param {Object} model
 * @param {Array} sheetData
 * @param {GoogleAppsScript.Spreadsheet.Sheet} listSheet
 */
function _writeSalesRow(model, sheetData, listSheet) {
  const fields      = model.salesFields;
  const negotiation = parseLatestNegotiation(fields.dealHistory);
  const meetingData = parseMeetingData(fields.dealHistory);
  const rowData     = buildSalesRowData(fields, negotiation, meetingData);
  writeSalesRecord(
    listSheet, sheetData, rowData,
    model.customerName, model.aggregationYear, model.aggregationMonth,
  );
}

/**
 * JSON形式のContentService出力を生成する
 * @param {Object} body - レスポンスボディ
 * @param {boolean} [isError=false] - エラーレスポンスかどうか
 * @returns {ContentService.TextOutput}
 */
function _jsonResponse(body, isError = false) {
  if (isError) {
    AppLogger.warn('エラーレスポンスを返します', body);
  }
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
