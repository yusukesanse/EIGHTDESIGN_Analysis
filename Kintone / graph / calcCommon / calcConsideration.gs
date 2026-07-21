// ============================================================
// graph/calcResidential.gs
// ============================================================

/**
 * 検討レベル別件数を集計し、グラフシートへ書き込む
 * @param {Object} config
 */
function calcConsideration(config) {
  try {
    const counts  = _initConsiderationCounts();
    _countConsiderationFromSheet(config.listData[0], counts);
    _applyConsiderationDelta(config, counts);
    _calcConsiderationTotal(counts);
    _writeConsiderationCounts(config.graphSheet, counts);
  } catch (e) {
    handleError(e.stack, e.message, 'calcConsideration',
      config.record.customer_name.value, config.record.customer_type.value);
  }
}

// ============================================================
// 定数
// ============================================================

/** 書き込み行番号（1始まり） */
const CONSIDERATION_GRAPH_ROW = 178;

/** 書き込み開始列（1始まり） */
const CONSIDERATION_GRAPH_COL = 13;

/**
 * 検討レベルのキー順（書き込み列順と一致）
 * @type {string[]}
 */
const CONSIDERATION_KEYS = [
  'closed', 'large', 'medium', 'small', 'notYet', 'longTerm', 'nothing',
];

/**
 * kintone の likehood_now 値 → 検討レベルキーのマッピング
 * @type {Object<string, string>}
 */
const LIKEHOOD_TO_LEVEL = {
  '成約':   'closed',
  'A':      'closed',
  '大':     'large',  '見込み大': 'large',  'B-A': 'large',
  '中':     'medium', '見込み中': 'medium', 'B-B': 'medium',
  '小':     'small',  '見込み小': 'small',  'B-C': 'small',
  '無':     'nothing','見込み無': 'nothing','D':   'nothing',
  '未':     'notYet', 'B-D':      'notYet',
  '長期追客': 'longTerm', 'C': 'longTerm',
};

/**
 * kintone の nego_status 値 → 検討レベルキーのマッピング
 * nego_status が存在する場合はこちらを優先する
 * @type {Object<string, string>}
 */
const NEGO_TO_LEVEL = {
  '長期追客': 'longTerm',
  '追客中':   'notYet',
  '追客終了': 'nothing',
};

/** 検討レベルの列インデックス（0始まり） */
const COL_CONSIDERATION = SALES_LIST_COLS.LIKEHOOD - 1;

// ============================================================
// カウンタ初期化
// ============================================================

/**
 * 検討レベルカウンタを全キー0で初期化する
 * @returns {Object<string, number>}
 */
function _initConsiderationCounts() {
  const counts = {};
  for (const key of CONSIDERATION_KEYS) {
    counts[key] = 0;
  }
  counts['total'] = 0;
  return counts;
}

// ============================================================
// 区分解決ヘルパー
// ============================================================

/**
 * レコードから検討レベルキーを解決する
 * nego_status が存在する場合は nego_status を優先し、なければ likehood_now を使う
 *
 * @param {Object} record
 * @returns {string|null} 検討レベルキー（マッピングなければ null）
 */
function _resolveConsiderationKey(record) {
  const negoStatus = record?.nego_status?.value;
  if (negoStatus) {
    return NEGO_TO_LEVEL[negoStatus] ?? LIKEHOOD_TO_LEVEL[record?.likehood_now?.value] ?? null;
  }
  return LIKEHOOD_TO_LEVEL[record?.likehood_now?.value] ?? null;
}

// ============================================================
// シートからの集計
// ============================================================

/**
 * 一覧データから検討レベル別カウントを集計する
 * @param {Array<Array<*>>} dataSet
 * @param {Object<string, number>} counts
 */
function _countConsiderationFromSheet(dataSet, counts) {
  for (const row of dataSet) {
    const key = LIKEHOOD_TO_LEVEL[row[COL_CONSIDERATION]];
    if (key !== undefined) counts[key]++;
  }
}

// ============================================================
// Webhook差分適用
// ============================================================

/**
 * Webhookレコードの検討レベル差分をカウントに適用する
 *
 * @param {Object} config
 * @param {Object<string, number>} counts
 */
function _applyConsiderationDelta(config, counts) {
  const newKey     = _resolveConsiderationKey(config.record);
  const hasExisting = config.existingCustomerData?.length > 0;

  if (hasExisting) {
    const oldKey = LIKEHOOD_TO_LEVEL[config.existingCustomerData[COL_CONSIDERATION]] ?? null;

    // Bug 3修正: oldKey が null のとき counts[null]-- を防ぐ
    if (oldKey !== null && oldKey !== newKey) {
      counts[oldKey]--;
      if (newKey !== null) counts[newKey]++;
    }
  } else {
    if (newKey !== null) counts[newKey]++;
  }
}

// ============================================================
// 合計計算
// ============================================================

/**
 * CONSIDERATION_KEYS の合計を counts.total に格納する
 * Bug 2修正: Object.values() は total 自身を含むため、明示的キー配列で合計する
 *
 * @param {Object<string, number>} counts
 */
function _calcConsiderationTotal(counts) {
  counts['total'] = CONSIDERATION_KEYS
    .reduce((sum, key) => sum + (counts[key] ?? 0), 0);
}

// ============================================================
// 書き込み
// ============================================================

/**
 * 検討レベルカウントをグラフシートへ横1行で書き込む
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} graphSheet
 * @param {Object<string, number>} counts
 */
function _writeConsiderationCounts(graphSheet, counts) {
  // CONSIDERATION_KEYS + total の順で1行分の値を生成
  const writeData = [[
    ...CONSIDERATION_KEYS.map(key => counts[key] ?? 0),
    counts['total'] ?? 0,
  ]];

  graphSheet
    .getRange(CONSIDERATION_GRAPH_ROW, CONSIDERATION_GRAPH_COL, 1, writeData[0].length)
    .setValues(writeData);

  AppLogger.debug('calcConsideration: 書き込み完了', {
    row: CONSIDERATION_GRAPH_ROW,
    col: CONSIDERATION_GRAPH_COL,
  });
}