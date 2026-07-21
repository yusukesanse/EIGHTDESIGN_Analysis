/**
 * doPost.gs
 * Webhookリクエストの制御層
 * 外部との境界レイヤー。業務ロジックを持たない
 */

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
    const { appId, record } = parseWebhookBody(e.postData.contents);

    _validateRecordByApp(appId, record);

    // ── 2. kintoneフィールド抽出 ─────────────────────────────
    const fields = _extractFieldsByApp(appId, record);

    // ── 3. エリア・顧客種別の正規化 ──────────────────────────
    const customerType = normalizeCustomerType(fields.customerType);
    const promotionArea = normalizePromotionArea(fields.promotionArea);

    AppLogger.info('Webhook受信', { appId, customerName: fields.customerName, customerType, promotionArea });

    // ── 4. 対象シートの取得 ──────────────────────────────────
    const { listSheet, graphSheet } = getTargetSheets(customerType, promotionArea);

    if (!listSheet) {
      throw new Error(`一覧シートが見つかりません: customerType=${customerType}, area=${promotionArea}`);
    }

    // ── 5. シートデータ取得（1回のみ）───────────────────────
    const listData  = getFormattedSheetData(listSheet);
    const graphData = graphSheet ? getFormattedSheetData(graphSheet) : null;

    // ── 6. 日付情報の変換 ────────────────────────────────────
    const inquiryDate = transformInquiryDate(fields.inquiryDate);

    // ── 7. アプリ種別ごとの書き込み処理 ─────────────────────
    _dispatchWrite(appId, fields, listData, listSheet, inquiryDate);

    // ── 8. グラフ集計処理 ────────────────────────────────────
    if (graphSheet) {
      _runAggregation(appId, record, graphSheet, { listData, graphData });
    } else {
      AppLogger.warn('グラフシートが見つかりません。集計をスキップします', { customerType, promotionArea });
    }

    timer.stop();
    return _jsonResponse({ result: 'success' });

  } catch (err) {
    AppLogger.error('Webhook処理エラー', err, { functionName: 'handleWebhook' });
    timer.stop();
    return _jsonResponse({ error: err.message }, true);
  }
}

// ============================================================
// 内部ヘルパー
// ============================================================

/**
 * アプリIDに応じたレコードバリデーションを実行する
 * @param {string} appId
 * @param {Object} record
 */
function _validateRecordByApp(appId, record) {
  switch (appId) {
    case CUSTOMER_APP_ID:
      validateCustomerRecord(record);
      break;
    case SALES_APP_ID:
      validateSalesRecord(record);
      break;
    default:
      throw new Error(`未対応のアプリID: ${appId}`);
  }
}

/**
 * アプリIDに応じたフィールド抽出を実行する
 * @param {string} appId
 * @param {Object} record
 * @returns {Object} 抽出済みフィールドデータ
 */
function _extractFieldsByApp(appId, record) {
  switch (appId) {
    case CUSTOMER_APP_ID:
      return extractCustomerFields(record);
    case SALES_APP_ID:
      return extractSalesFields(record);
    default:
      throw new Error(`未対応のアプリID: ${appId}`);
  }
}

/**
 * アプリIDに応じたシート書き込みを実行する
 * @param {string} appId
 * @param {Object} fields - 抽出済みフィールドデータ
 * @param {Array} sheetData
 * @param {GoogleAppsScript.Spreadsheet.Sheet} listSheet
 * @param {{ year: string, month: string, monthAndDay: string }} inquiryDate
 */
function _dispatchWrite(appId, fields, sheetData, listSheet, inquiryDate) {
  switch (appId) {
    case CUSTOMER_APP_ID: {
      const rowData = buildCustomerRowData(fields);
      writeCustomerRecord(listSheet, sheetData, rowData, fields.customerName, inquiryDate.year, inquiryDate.month);
      break;
    }
    case SALES_APP_ID: {
      const negotiation = parseLatestNegotiation(fields.dealHistory);
      const meetingData = parseMeetingData(fields.dealHistory);
      const rowData     = buildSalesRowData(fields, negotiation, meetingData);
      writeSalesRecord(listSheet, sheetData, rowData, fields.customerName, inquiryDate.year, inquiryDate.month);
      break;
    }
    default:
      throw new Error(`未対応のアプリID: ${appId}`);
  }
}

/**
 * グラフ集計処理を実行する
 * @param {string} appId
 * @param {Object} record
 * @param {GoogleAppsScript.Spreadsheet.Sheet} graphSheet
 * @param {Array} listData
 */
function _runAggregation(appId, record, graphSheet, sheetData) {
  try {
    syncGraphSheets(appId, record, graphSheet, sheetData, CUSTOMER_APP_ID, SALES_APP_ID);
  } catch (err) {
    AppLogger.error('グラフ集計エラー', err, { functionName: '_runAggregation' });
  }
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