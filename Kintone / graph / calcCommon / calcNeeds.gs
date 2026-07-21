// ============================================================
// graph/calcResidential.gs
// ============================================================

/**
 * 問い合わせニーズ（相談会・個別相談・見学会・外部相談会・資料請求）を集計し、
 * グラフシートへ書き込む
 * @param {Object} config
 */
function calcNeeds(config) {
  try {
    for (const block of NEEDS_BLOCKS) {
      _calcNeedsBlock(config, block);
    }
  } catch (e) {
    // Bug 1修正: errorHandling → handleError
    handleError(e.stack, e.message, 'calcNeeds',
      config.record.customer_name.value, config.record.customer_type.value);
  }
}

// ============================================================
// 定数
// ============================================================

/**
 * ブロック定義
 * filterCol: 対象顧客を絞り込むシート列インデックス（0始まり）
 * writeRow:  グラフシートへの書き込み開始行（1始まり）
 * writeCol:  グラフシートへの書き込み開始列（1始まり）
 */
const NEEDS_BLOCKS = [
  { filterCol: RESIDENTIAL_EXTRA_COLS.FIRST_ACQUIRER - 1, writeRow: 178, writeCol: 2 },
  { filterCol: RESIDENTIAL_EXTRA_COLS.OWN_HOUSE      - 1, writeRow: 186, writeCol: 2 },
  { filterCol: RESIDENTIAL_EXTRA_COLS.PARENTAL_HOME  - 1, writeRow: 194, writeCol: 2 },
];

/**
 * 問い合わせ種別キー一覧（total は合計用）
 * @type {string[]}
 */
const NEEDS_INQ_KEYS = ['consul', 'indiv', 'exter', 'tour', 'docReq'];

/**
 * 集計ステータスキー一覧
 * res/visit/closing はカウント対象、att/yield は計算値
 * @type {string[]}
 */
const NEEDS_STATUS_KEYS = ['res', 'visit', 'closing', 'att', 'yield'];

/** 合計計算対象ステータス */
const NEEDS_COUNT_STATUSES = ['res', 'visit', 'closing'];

/**
 * 初回アポイント値 → 問い合わせ種別キーのマッピング
 * @type {Object<string, string>}
 */
const APPOINT_TO_NEEDS_KEY = {
  '相談会':   'consul',
  '個別相談': 'indiv',
  '外部相談会': 'exter',
  '見学会':   'tour',
  '資料請求': 'docReq',
};

/** 列インデックス（0始まり） */
const COL_FIRST_APPOINT = CUSTOMER_LIST_COLS.FIRST_APPOINT - 1;
const COL_NEEDS_RANK    = SALES_LIST_COLS.RANK             - 1;

// ============================================================
// ブロック単位の集計・書き込み
// ============================================================

/**
 * 指定ブロックの問い合わせニーズを集計してグラフシートへ書き込む
 * @param {Object} config
 * @param {{ filterCol: number, writeRow: number, writeCol: number }} block
 */
function _calcNeedsBlock(config, block) {
  const counts = _initNeedsCounts();
  _countNeedsFromSheet(config.listData[0], block.filterCol, counts);
  _applyNeedsDelta(config, block.filterCol, counts);
  _calcNeedsRatios(counts);
  _writeNeedsCounts(config.graphSheet, block, counts);
}

// ============================================================
// カウンタ初期化
// ============================================================

/**
 * 問い合わせニーズカウンタを全キー0で初期化する
 * @returns {Object<string, number>}
 */
function _initNeedsCounts() {
  const counts = {};
  for (const inq of [...NEEDS_INQ_KEYS, 'total']) {
    for (const status of NEEDS_STATUS_KEYS) {
      counts[`${inq}_${status}`] = 0;
    }
  }
  return counts;
}

// ============================================================
// 区分解決ヘルパー
// ============================================================

/**
 * 初回アポイント値を問い合わせ種別キーに変換する
 * @param {string} appoint
 * @returns {string|null} キー（マッピングなければ null）
 */
function _resolveNeedsKey(appoint) {
  return APPOINT_TO_NEEDS_KEY[appoint] ?? null;
}

// ============================================================
// シートからの集計
// ============================================================

/**
 * 一覧データから問い合わせニーズのカウントを集計する
 * @param {Array<Array<*>>} dataSet
 * @param {number} filterCol - 対象顧客フィルタ列（空でなければ対象）
 * @param {Object<string, number>} counts
 */
function _countNeedsFromSheet(dataSet, filterCol, counts) {
  for (const row of dataSet) {
    if (row[filterCol] === '') continue;  // 対象外の顧客種別をスキップ

    const inqKey = _resolveNeedsKey(String(row[COL_FIRST_APPOINT] ?? ''));
    if (!inqKey) continue;

    counts[`${inqKey}_res`]++;
    if (row[SALES_LIST_COLS.MTG_DAY_1 - 1] !== '') counts[`${inqKey}_visit`]++;
    if (row[COL_NEEDS_RANK] === 'A')               counts[`${inqKey}_closing`]++;
  }
}

// ============================================================
// Webhook差分適用
// ============================================================

/**
 * Webhookレコードの問い合わせニーズ差分をカウントに適用する
 *
 * @param {Object} config
 * @param {number} filterCol
 * @param {Object<string, number>} counts
 */
function _applyNeedsDelta(config, filterCol, counts) {
  const recData    = _extractNeedsRecordData(config);
  const hasExisting = config.existingCustomerData?.length > 0;

  if (hasExisting) {
    const exc       = config.existingCustomerData;
    const excInqKey = _resolveNeedsKey(String(exc[COL_FIRST_APPOINT] ?? ''));
    const excVis    = exc[SALES_LIST_COLS.MTG_DAY_1 - 1] !== '';
    const excRank   = exc[COL_NEEDS_RANK];

    // Bug 3修正: excInqKey が null のとき counts[null]-- を防ぐ
    if (!excInqKey) return;

    // 初回アポイントの差分
    if (excInqKey !== recData.inqKey) {
      counts[`${excInqKey}_res`]--;
      if (recData.inqKey) counts[`${recData.inqKey}_res`]++;
    }

    // 来場の差分
    if (recData.vis !== null && excVis !== recData.vis) {
      counts[`${excInqKey}_visit`]--;
      if (recData.inqKey) counts[`${recData.inqKey}_visit`]++;
    }

    // Bug 4修正: 成約差分は excInqKey → recData.inqKey の移動で表現する
    if (recData.rank === 'A' && excRank !== 'A') {
      if (excInqKey)      counts[`${excInqKey}_closing`]--;
      if (recData.inqKey) counts[`${recData.inqKey}_closing`]++;
    }
  } else {
    if (!recData.inqKey) return;
    counts[`${recData.inqKey}_res`]++;
    if (recData.vis)         counts[`${recData.inqKey}_visit`]++;
    if (recData.rank === 'A') counts[`${recData.inqKey}_closing`]++;
  }
}

/**
 * レコードから問い合わせニーズ集計に必要なデータを抽出する
 * Bug 2修正: formatRank → transformRank、formatMeetingData → parseMeetingData
 *
 * @param {Object} config
 * @returns {{ inqKey: string|null, vis: boolean|null, rank: string }}
 */
function _extractNeedsRecordData(config) {
  const inqKey = _resolveNeedsKey(
    String(config.record?.first_appoint?.value ?? '')
  );
  const rank = transformRank(config.record?.likehood_now?.value) ?? '';

  let vis = null;
  const dealHistory = config.record?.deal_history?.value;
  if (dealHistory) {
    const mtgDays = parseMeetingData(dealHistory).mtgDays;
    vis = mtgDays[0] !== '';
  }

  return { inqKey, vis, rank };
}

// ============================================================
// 合計・率の計算
// ============================================================

/**
 * 問い合わせ種別ごとの合計・来場率・歩留率を計算する
 * @param {Object<string, number>} counts
 */
function _calcNeedsRatios(counts) {
  // 合計（res / visit / closing）
  for (const status of NEEDS_COUNT_STATUSES) {
    counts[`total_${status}`] = NEEDS_INQ_KEYS
      .reduce((sum, inq) => sum + (counts[`${inq}_${status}`] ?? 0), 0);
  }

  // 各問い合わせ種別 + total の来場率・歩留率
  for (const inq of [...NEEDS_INQ_KEYS, 'total']) {
    counts[`${inq}_att`]   = _safeRatio(counts[`${inq}_visit`],   counts[`${inq}_res`]);
    counts[`${inq}_yield`] = _safeRatio(counts[`${inq}_closing`], counts[`${inq}_visit`]);
  }
}

// ============================================================
// 書き込み
// ============================================================

/**
 * 問い合わせニーズカウントをグラフシートへ書き込む
 * 問い合わせ種別（total含む）ごとに1列ずつ書き込む
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} graphSheet
 * @param {{ writeRow: number, writeCol: number }} block
 * @param {Object<string, number>} counts
 */
function _writeNeedsCounts(graphSheet, block, counts) {
  [...NEEDS_INQ_KEYS, 'total'].forEach((inq, colOffset) => {
    const writeData = NEEDS_STATUS_KEYS.map(status => [counts[`${inq}_${status}`] ?? 0]);
    graphSheet
      .getRange(block.writeRow, block.writeCol + colOffset, writeData.length, 1)
      .setValues(writeData);
  });

  AppLogger.debug('calcNeeds: 書き込み完了', { writeRow: block.writeRow, writeCol: block.writeCol });
}