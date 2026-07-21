// ============================================================
// graph/calcCommon.gs
// ============================================================

/**
 * 月ごとの反響数を集計し、グラフシートへ書き込む
 * @param {Object} config
 */
function calcMonthly(config) {
  try {
    const counts = _buildMonthlyCounts(config);
    _writeMonthlyCounts(config.graphSheet, config.graphData, config.inquiryYear, counts);
  } catch (e) {
    handleError(e.stack, e.message, 'calcMonthly',
      config.record.customer_name.value, config.record.customer_type.value);
  }
}

// ============================================================
// 定数
// ============================================================

/** グラフシートの年度ヘッダー行番号（1始まり） */
const MONTHLY_HEADER_ROW = 69;
const MONTHLY_GRAPH_ROW = 70;

/**
 * 月表記 → 配列インデックス（0始まり）のマッピング
 * @type {Object<string, number>}
 */
const MONTH_INDEX = {
  '1月': 0, '2月': 1, '3月': 2,  '4月': 3,
  '5月': 4, '6月': 5, '7月': 6,  '8月': 7,
  '9月': 8, '10月': 9, '11月': 10, '12月': 11,
};

// ============================================================
// 集計ロジック
// ============================================================

/**
 * 月別カウント配列を初期化する（12ヶ月分 + 合計）
 * @returns {number[]} 長さ13の配列（index 0-11 = 1-12月, index 12 = 合計）
 */
function _initMonthlyCounts() {
  return new Array(13).fill(0);
}

/**
 * 一覧シートデータから月別反響数を集計する
 * @param {Array<Array<*>>} yearData - 対象年度の行データ配列
 * @returns {number[]}
 */
function _countMonthlyFromSheet(yearData) {
  const counts = _initMonthlyCounts();
  for (const row of yearData) {
    const idx = MONTH_INDEX[row[LIST_COL_INDEX.MONTH]];
    if (idx !== undefined) counts[idx]++;
  }
  return counts;
}

/**
 * Webhookレコードの差分を月別カウントに適用する
 * 既存顧客の場合は旧月を-1して新月を+1（月変更の上書き更新に対応）
 *
 * @param {number[]} counts
 * @param {Object} config
 */
function _applyMonthlyDelta(counts, config) {
  const { record, existingCustomerData } = config;
  const newMonth = transformInquiryDate(record.inquiry_date.value).month;
  const newIdx   = MONTH_INDEX[newMonth];
  if (newIdx === undefined) return;

  const hasExisting = existingCustomerData && existingCustomerData.length > 0;

  if (hasExisting) {
    // 既存顧客: 旧月を減算してから新月を加算（月が変わった場合の二重計上を防ぐ）
    const oldIdx = MONTH_INDEX[existingCustomerData[LIST_COL_INDEX.MONTH]];
    if (oldIdx !== undefined) counts[oldIdx]--;
  }

  counts[newIdx]++;
}

/**
 * 月別カウントの合計をindex 12に格納する
 * @param {number[]} counts
 */
function _calcMonthlyTotal(counts) {
  counts[12] = counts.slice(0, 12).reduce((sum, v) => sum + v, 0);
}

/**
 * 月別カウントを構築する（シート集計 + Webhook差分 + 合計）
 * @param {Object} config
 * @returns {number[]}
 */
function _buildMonthlyCounts(config) {
  const counts = _countMonthlyFromSheet(config.listData[0]);
  _applyMonthlyDelta(counts, config);
  _calcMonthlyTotal(counts);
  return counts;
}

// ============================================================
// 書き込み
// ============================================================

/**
 * 月別カウントをグラフシートへ書き込む
 * @param {GoogleAppsScript.Spreadsheet.Sheet} graphSheet
 * @param {Array<Array<*>>} graphData
 * @param {string} inquiryYear
 * @param {number[]} counts
 */
function _writeMonthlyCounts(graphSheet, graphData, inquiryYear, counts) {
  const headerRow = graphData[MONTHLY_HEADER_ROW];
  const colIndex  = headerRow.indexOf(inquiryYear);

  if (colIndex === -1) {
    AppLogger.warn('calcMonthly: 対象年度の列が見つかりません', { inquiryYear });
    return;
  }

  const writeData = counts.map(v => [v]);
  graphSheet.getRange(MONTHLY_GRAPH_ROW, colIndex + 1, writeData.length, 1).setValues(writeData);
  AppLogger.debug('calcMonthly: 書き込み完了', { inquiryYear, colIndex });
}