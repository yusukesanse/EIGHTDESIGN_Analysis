// ============================================================
// graph/calcCommon.gs
// ============================================================

/**
 * 顧客進捗（反響・来場・再来・3回目以上・成約）を集計し、グラフシートへ書き込む
 * @param {Object} config
 */
function calcProgress(config) {
  try {
    const counts = _buildProgressCounts(config);
    _writeProgressCounts(config.graphSheet, config.graphData, config.inquiryYear, counts);
  } catch (e) {
    handleError(e.stack, e.message, 'calcProgress',
      config.record.customer_name.value, config.record.customer_type.value);
  }
}

// ============================================================
// 集計ロジック
// ============================================================

/**
 * グラフシート書き込み行番号（1始まり）
 * @type {number}
 */
const PROGRESS_HEADER_ROW = 34
const PROGRESS_GRAPH_ROW = 35;

/**
 * 進捗カウントの初期値を生成する
 * @returns {{ res: number, vis: number, reVis: number, over: number, close: number }}
 */
function _initCounts() {
  return { res: 0, vis: 0, reVis: 0, over: 0, close: 0 };
}

/**
 * 一覧シートデータから対象年度の進捗カウントを集計する
 * @param {Array<Array<*>>} yearData - 対象年度の行データ配列
 * @returns {{ res: number, vis: number, reVis: number, over: number, close: number }}
 */
function _countFromSheet(yearData) {
  const counts = _initCounts();
  for (const row of yearData) {
    counts.res++;
    if (row[SALES_LIST_COLS.MTG_DAY_1 - 1] !== '') counts.vis++;
    if (row[SALES_LIST_COLS.MTG_DAY_2 - 1] !== '') counts.reVis++;
    if (row[SALES_LIST_COLS.MTG_DAY_3 - 1] !== '') counts.over++;
    if (row[SALES_LIST_COLS.RANK       - 1] === 'A') counts.close++;
  }
  return counts;
}

/**
 * Webhookレコードの差分を既存カウントに加算する
 * 既存顧客の場合は「新たに追加された項目のみ」を加算し二重計上を防ぐ
 *
 * @param {{ res: number, vis: number, reVis: number, over: number, close: number }} counts - 加算対象のカウント
 * @param {Object} config
 */
function _applyWebhookDelta(counts, config) {
  const { appId, customerAppId, salesAppId, record, existingCustomerData } = config;
  const hasExisting = existingCustomerData && existingCustomerData.length > 0;

  if (appId === customerAppId) {
    // 顧客情報アプリ: 新規顧客のみ反響数を加算（既存顧客は既にシートに含まれている）
    if (!hasExisting) counts.res++;
    return;
  }

  if (appId === salesAppId) {
    const mtgDays    = parseMeetingData(record?.deal_history?.value).mtgDays;
    const newRank    = transformRank(record?.likehood_now?.value);

    if (hasExisting) {
      // 既存顧客: シートにまだ存在しない項目のみ差分加算
      const prev = _extractExistingProgress(existingCustomerData);
      if (mtgDays[0] !== '' && !prev.vis)   counts.vis++;
      if (mtgDays[1] !== '' && !prev.reVis) counts.reVis++;
      if (mtgDays[2] !== '' && !prev.over)  counts.over++;
      if (newRank === 'A' && prev.rank !== 'A') counts.close++;
    } else {
      // 新規顧客: 全項目を加算
      counts.res++;
      if (mtgDays[0] !== '') counts.vis++;
      if (mtgDays[1] !== '') counts.reVis++;
      if (mtgDays[2] !== '') counts.over++;
      if (newRank === 'A')   counts.close++;
    }
  }
}

/**
 * 既存顧客行データから進捗の現在状態を抽出する
 * @param {Array<*>} row - 既存顧客の行データ（0始まり）
 * @returns {{ vis: boolean, reVis: boolean, over: boolean, rank: string }}
 */
function _extractExistingProgress(row) {
  return {
    vis:   row[SALES_LIST_COLS.MTG_DAY_1 - 1] !== '',
    reVis: row[SALES_LIST_COLS.MTG_DAY_2 - 1] !== '',
    over:  row[SALES_LIST_COLS.MTG_DAY_3 - 1] !== '',
    rank:  row[SALES_LIST_COLS.RANK       - 1] ?? '',
  };
}

/**
 * 進捗カウントを構築する（シート集計 + Webhook差分）
 * @param {Object} config
 * @returns {{ res: number, vis: number, reVis: number, over: number, close: number }}
 */
function _buildProgressCounts(config) {
  const counts = _countFromSheet(config.listData[0]);
  _applyWebhookDelta(counts, config);
  return counts;
}

// ============================================================
// 割合計算
// ============================================================

/**
 * ゼロ除算を避けて割合を計算する
 * @param {number} numerator
 * @param {number} denominator
 * @returns {number} 割合（0〜1）。分母が0の場合は0
 */
function _safeRatio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * カウントから書き込み用の進捗データ配列を生成する
 * @param {{ res: number, vis: number, reVis: number, over: number, close: number }} counts
 * @returns {Array<[number]>} setValues() 用の2次元配列
 */
function _buildWriteData(counts) {
  const { res, vis, reVis, over, close } = counts;
  return [
    [res],
    [vis],
    [reVis],
    [over],
    [close],
    [_safeRatio(vis,   res)],    // 来場率
    [_safeRatio(reVis, vis)],    // 再来率
    [_safeRatio(over,  vis)],    // 3回目以上率
    [_safeRatio(close, vis)],    // 来場→成約率
    [_safeRatio(close, reVis)],  // 再来→成約率
  ];
}

// ============================================================
// 書き込み
// ============================================================

/**
 * 進捗カウントをグラフシートへ書き込む
 * @param {GoogleAppsScript.Spreadsheet.Sheet} graphSheet
 * @param {Array<Array<*>>} graphData - グラフシートのデータ（0始まり）
 * @param {string} inquiryYear - 対象年度（例: "2025年"）
 * @param {{ res: number, vis: number, reVis: number, over: number, close: number }} counts
 */
function _writeProgressCounts(graphSheet, graphData, inquiryYear, counts) {
  const headerRow = graphData[PROGRESS_HEADER_ROW];
  const colIndex  = headerRow.indexOf(inquiryYear);

  if (colIndex === -1) {
    AppLogger.warn('calcProgress: 対象年度の列が見つかりません', { inquiryYear });
    return;
  }

  const writeData = _buildWriteData(counts);
  graphSheet.getRange(PROGRESS_GRAPH_ROW, colIndex + 1, writeData.length, 1).setValues(writeData);
  AppLogger.debug('calcProgress: 書き込み完了', { inquiryYear, colIndex, counts });
}