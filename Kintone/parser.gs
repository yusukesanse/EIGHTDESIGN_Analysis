/**
 * parser.gs — Kintone固有構造の抽出・パース（旧 kintoneParser.gs）
 */

// ============================================================
// レコード抽出
// ============================================================

/**
 * WebhookペイロードからアプリID・レコード・イベント種別を取得する
 * @param {string} rawBody - リクエストボディ（JSON文字列）
 * @returns {{ appId: string, record: Object, type: string }}
 * @throws {Error} パース・バリデーションエラー
 */
function parseWebhookBody(rawBody) {
  const { appId, record, type } = validateWebhookPayload(rawBody);
  AppLogger.info('Webhookパース完了', { appId, type });
  return { appId, record, type };
}

// ============================================================
// フィールド値取得ヘルパー
// ============================================================

/**
 * kintoneレコードから単一フィールドの値を取得する
 * @param {Object} record - kintoneレコードオブジェクト
 * @param {string} fieldCode - フィールドコード
 * @param {*} [defaultValue=''] - 値がない場合のデフォルト
 * @returns {*} フィールドの値
 */
function getFieldValue(record, fieldCode, defaultValue = '') {
  return record?.[fieldCode]?.value ?? defaultValue;
}

/**
 * kintoneレコードからユーザーフィールド（担当者など）の名前を取得する
 * 複数ユーザーが設定されている場合は最初のユーザー名を返す
 * @param {Object} record - kintoneレコードオブジェクト
 * @param {string} fieldCode - フィールドコード
 * @returns {string} ユーザー名（値がない場合は空文字）
 */
function getUserFieldName(record, fieldCode) {
  const users = getFieldValue(record, fieldCode, []);
  return Array.isArray(users) && users.length > 0 ? (users[0].name ?? '') : '';
}

/**
 * kintoneレコードからサブテーブルの行データ配列を取得する
 * @param {Object} record - kintoneレコードオブジェクト
 * @param {string} fieldCode - サブテーブルのフィールドコード
 * @returns {Array} サブテーブルの行データ配列（なければ空配列）
 */
function getSubtableRows(record, fieldCode) {
  const rows = getFieldValue(record, fieldCode, []);
  return Array.isArray(rows) ? rows : [];
}

// ============================================================
// kintone固有データ抽出
// ============================================================

/**
 * 顧客情報レコードから画面に必要な全フィールドを抽出する
 * @param {Object} record - kintoneレコードオブジェクト
 * @returns {Object} 画面用フィールドデータ
 */
function extractCustomerFields(record) {
  return {
    customerType:      getFieldValue(record, CUSTOMER_FIELDS.CUSTOMER_TYPE),
    customerName:      getFieldValue(record, CUSTOMER_FIELDS.CUSTOMER_NAME),
    promotionArea:     getFieldValue(record, CUSTOMER_FIELDS.PROMOTION_AREA),
    inquiryDate:       getFieldValue(record, CUSTOMER_FIELDS.INQUIRY_DATE),
    likehoodNow:       getFieldValue(record, CUSTOMER_FIELDS.LIKEHOOD_NOW),
    firstAppoint:      getFieldValue(record, CUSTOMER_FIELDS.FIRST_APPOINT),
    informationRoute:  getFieldValue(record, CUSTOMER_FIELDS.INFORMATION_ROUTE),
    manager:           getUserFieldName(record, CUSTOMER_FIELDS.MANAGER),
    age:               getFieldValue(record, CUSTOMER_FIELDS.AGE),
    currentResidence:  getFieldValue(record, CUSTOMER_FIELDS.CURRENT_RESIDENCE),
    familyMember:      getFieldValue(record, CUSTOMER_FIELDS.FAMILY_MEMBER),
  };
}

/**
 * 営業・商談管理レコードから画面に必要な全フィールドを抽出する
 * @param {Object} record - kintoneレコードオブジェクト
 * @returns {Object} 画面用フィールドデータ
 */
function extractSalesFields(record) {
  return {
    customerType:         getFieldValue(record, SALES_FIELDS.CUSTOMER_TYPE),
    customerName:         getFieldValue(record, SALES_FIELDS.CUSTOMER_NAME),
    promotionArea:        getFieldValue(record, SALES_FIELDS.PROMOTION_AREA),
    inquiryDate:          getFieldValue(record, SALES_FIELDS.INQUIRY_DATE),
    likehoodNow:          getFieldValue(record, SALES_FIELDS.LIKEHOOD_NOW),
    negoStatus:           getFieldValue(record, SALES_FIELDS.NEGO_STATUS),
    dealHistory:          getSubtableRows(record, SALES_FIELDS.DEAL_HISTORY),
    consultationContent:  getFieldValue(record, SALES_FIELDS.CONSULTATION_CONTENT),
    manager:              getUserFieldName(record, SALES_FIELDS.MANAGER),
    landAttributes:       getFieldValue(record, SALES_FIELDS.LAND_ATTRIBUTES),
    prefectures:          getFieldValue(record, SALES_FIELDS.PREFECTURES),
    city:                 getFieldValue(record, SALES_FIELDS.CITY),
    town:                 getFieldValue(record, SALES_FIELDS.TOWN),
    area:                 getFieldValue(record, SALES_FIELDS.AREA),
    workPlace:            getFieldValue(record, SALES_FIELDS.WORK_PLACE),
    workPlaceSub:         getFieldValue(record, SALES_FIELDS.WORK_PLACE_SUB),
    industry:             getFieldValue(record, SALES_FIELDS.INDUSTRY),
    occupation:           getFieldValue(record, SALES_FIELDS.OCCUPATION),
    income:               getFieldValue(record, SALES_FIELDS.INCOME),
    incomeSub:            getFieldValue(record, SALES_FIELDS.INCOME_SUB),
    selfFunded:           getFieldValue(record, SALES_FIELDS.SELF_FUNDED),
    hopeRenovation:       getFieldValue(record, SALES_FIELDS.HOPE_RENOVATION),
    constructionStatus:   getFieldValue(record, SALES_FIELDS.CONSTRUCTION_STATUS),
    rentalType:           getFieldValue(record, SALES_FIELDS.RENTAL_TYPE),
    currentResidence:     getFieldValue(record, SALES_FIELDS.CURRENT_RESIDENCE),
    reason:               getFieldValue(record, SALES_FIELDS.REASON),
    jobTitle:             getFieldValue(record, SALES_FIELDS.JOB_TITLE),
    hopeBusinessType:     getFieldValue(record, SALES_FIELDS.HOPE_BUSINESS_TYPE),
    capitalStock:         getFieldValue(record, SALES_FIELDS.CAPITAL_STOCK),
    inquiryStatusRows:    getSubtableRows(record, SALES_FIELDS.INQUIRY_STATUS),
  };
}

// ============================================================
// 商談履歴パーサー
// ============================================================

/**
 * deal_historyサブテーブルから最新の商談レコードを取得する
 * rowのidが最大のものを「最新」とみなす
 * @param {Array} dealHistoryRows - サブテーブルの行データ配列
 * @returns {{ resDate: string, nextAppt: string }|null} 最新商談データ、存在しない場合null
 */
function parseLatestNegotiation(dealHistoryRows) {
  if (!dealHistoryRows || dealHistoryRows.length === 0) return null;

  let latestId    = -Infinity;
  let latestValue = null;

  for (const item of dealHistoryRows) {
    const id = parseInt(item.id, 10);
    if (!isNaN(id) && id > latestId) {
      latestId    = id;
      latestValue = item.value;
    }
  }

  if (!latestValue) return null;

  const responseDate  = latestValue?.[DEAL_HISTORY_FIELDS.RESPONSE_DATE]?.value ?? '';
  const nextAppt      = latestValue?.[DEAL_HISTORY_FIELDS.NEXT_APPOINTMENT]?.value ?? '';

  // 日付フォーマット（"MM月DD日"形式）
  const resDate = _formatDateToMonthDay(responseDate);

  return { resDate, nextAppt };
}

/**
 * deal_historyサブテーブルから来場回数・各回の商談日を取得する
 * @param {Array} dealHistoryRows - サブテーブルの行データ配列
 * @returns {{ mtgDays: string[], mtgCount: string|null }}
 */
function parseMeetingData(dealHistoryRows) {
  const mtgDays   = ['', '', ''];
  let   mtgCount  = null;

  for (const item of dealHistoryRows) {
    const count = item?.value?.[DEAL_HISTORY_FIELDS.DEAL_COUNT]?.value   ?? null;
    const date  = item?.value?.[DEAL_HISTORY_FIELDS.RESPONSE_DATE]?.value ?? null;

    if (count === '1回目') { mtgDays[0] = date; mtgCount = '1'; }
    else if (count === '2回目') { mtgDays[1] = date; mtgCount = '2'; }
    else if (count === '3回目') { mtgDays[2] = date; mtgCount = '3'; }
  }

  return { mtgDays, mtgCount };
}

/**
 * 問い合わせステータスサブテーブルから最初の行の問い合わせ内容テキストを取得する
 * @param {Array} inquiryStatusRows - サブテーブルの行データ配列
 * @returns {string} 問い合わせ内容テキスト（取得できない場合は空文字）
 */
function parseInquiryContent(inquiryStatusRows) {
  return inquiryStatusRows?.[0]?.value?.inquiry_content?.value ?? '';
}

// ============================================================
// 内部ヘルパー
// ============================================================

/**
 * "YYYY-MM-DD" 形式の日付文字列を "M月D日" 形式に変換する
 * @param {string} dateStr - "YYYY-MM-DD" 形式の日付
 * @returns {string} "M月D日" 形式の文字列（変換不可の場合は空文字）
 */
function _formatDateToMonthDay(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '';
  const parts = dateStr.split('-');
  const month = parseInt(parts[1], 10);
  const day   = parseInt(parts[2], 10);
  return `${month}月${day}日`;
}
