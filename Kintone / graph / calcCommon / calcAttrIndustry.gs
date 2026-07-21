// ============================================================
// graph/calcResidential.gs
// ============================================================

/**
 * 属性×業界の相関を集計し、グラフシートへ書き込む
 * @param {Object} config
 */
function calcAttrIndustry(config) {
  try {
    _calcAttrIndustryBlock(config, ATTR_INDUSTRY_BLOCK_ALL);

    if (config.listData[1]?.length > 0) {
      _calcAttrIndustryBlock(config, ATTR_INDUSTRY_BLOCK_CLOSED);
    }
  } catch (e) {
    handleError(e.stack, e.message, 'calcAttrIndustry',
      config.record.customer_name.value, config.record.customer_type.value);
  }
}

// ============================================================
// 定数
// ============================================================

/** ブロック定義 */
const ATTR_INDUSTRY_BLOCK_ALL    = { startRow: 152, startCol: 2,  dataIndex: 0 };
const ATTR_INDUSTRY_BLOCK_CLOSED = { startRow: 152, startCol: 13, dataIndex: 1 };

/**
 * 職業 → 属性キーのマッピング
 * マッチしない職業は 'unknown' 扱い
 * @type {Object<string, string>}
 */
const OCCUPATION_TO_ATTR = {
  '会社員':                       'employee',
  '会社員（上場企業）':           'listedEmployee',
  '会社経営者':                   'executive',
  '会社役員':                     'executive',
  '公務員':                       'civilServant',
  '士業（弁護士・行政書士・税理士など）': 'civilServant',
  '自営業':                       'selfEmployee',
  '自由業':                       'selfEmployee',
  '教員':                         'faculty',
  '医師（開業医）':               'medical',
  '医師（勤務医）':               'medical',
};

/**
 * 業界名 → インデックスのマッピング（0始まり）
 * マッチしない業界は INDUSTRY_UNKNOWN_IDX 扱い
 * @type {Object<string, number>}
 */
const INDUSTRY_TO_IDX = {
  '製造': 0,  'クリエイター': 1, 'IT': 2,      'サービス': 3,  'アパレル': 4,
  '医療福祉': 5, '飲食': 6,       '運輸': 7,    '教育': 8,     '金融': 9,
  '建設': 10, '公官庁': 11,     '小売': 12,   '士業': 13,    '出版・広告': 14,
  '造船': 15, '通信': 16,       '美容': 17,   '不動産': 18,
};

/** 業界不明時のインデックス */
const INDUSTRY_UNKNOWN_IDX = 19;

/** 業界の総数（不明含む、合計列は含まない） */
const INDUSTRY_COUNT = 20;

/**
 * 属性キー一覧（'total' は合計行として最後に配置）
 * @type {string[]}
 */
const ATTR_KEYS = [
  'employee', 'listedEmployee', 'executive', 'civilServant',
  'selfEmployee', 'faculty', 'medical', 'unknown', 'total',
];

/** 属性・業界の列インデックス（0始まり） */
const COL_OCCUPATION = SALES_LIST_COLS.OCCUPATION - 1;
const COL_INDUSTRY   = SALES_LIST_COLS.INDUSTRY   - 1;

// ============================================================
// ブロック単位の集計・書き込み
// ============================================================

/**
 * 指定ブロックの属性×業界を集計してグラフシートへ書き込む
 * @param {Object} config
 * @param {{ startRow: number, startCol: number, dataIndex: number }} block
 */
function _calcAttrIndustryBlock(config, block) {
  const { startRow, startCol, dataIndex } = block;

  const counts = _initAttrIndustryCounts();
  _countAttrIndustryFromSheet(config.listData[dataIndex], counts);
  _applyAttrIndustryDelta(config, counts);
  _calcAttrIndustryTotals(counts);
  _writeAttrIndustryCounts(config.graphSheet, startRow, startCol, counts);
}

// ============================================================
// カウンタ初期化
// ============================================================

/**
 * 属性×業界のカウンタを全キー0で初期化する
 * @returns {Object<string, number>}
 */
function _initAttrIndustryCounts() {
  const counts = {};

  // 属性（total含む）× 業界インデックス（合計列含む）
  for (const attrKey of ATTR_KEYS) {
    for (let i = 0; i <= INDUSTRY_COUNT; i++) {
      counts[`${attrKey}_${i}`] = 0;
    }
  }
  // 業界ごとの合計行
  for (let i = 0; i <= INDUSTRY_COUNT; i++) {
    counts[`total_${i}`] = 0;
  }
  return counts;
}

// ============================================================
// 区分解決ヘルパー
// ============================================================

/**
 * 職業値を属性キーに変換する
 * Bug 4修正: マッチしない場合は null ではなく 'unknown' を返す
 * @param {string} occupation
 * @returns {string}
 */
function _resolveAttrKey(occupation) {
  return OCCUPATION_TO_ATTR[occupation] ?? 'unknown';
}

/**
 * 業界値を業界インデックスに変換する
 * @param {string} industry
 * @returns {number}
 */
function _resolveIndustryIdx(industry) {
  return INDUSTRY_TO_IDX[industry] ?? INDUSTRY_UNKNOWN_IDX;
}

/**
 * 行データから属性キーと業界インデックスを取得する
 * @param {Array<*>} row
 * @returns {{ attrKey: string, indIdx: number }}
 */
function _resolveAttrIndustryRowKeys(row) {
  return {
    attrKey: _resolveAttrKey(String(row[COL_OCCUPATION] ?? '')),
    indIdx:  _resolveIndustryIdx(String(row[COL_INDUSTRY]   ?? '')),
  };
}

// ============================================================
// シートからの集計
// ============================================================

/**
 * 一覧データから属性×業界のカウントを集計する
 * @param {Array<Array<*>>} dataSet
 * @param {Object<string, number>} counts
 */
function _countAttrIndustryFromSheet(dataSet, counts) {
  for (const row of dataSet) {
    const { attrKey, indIdx } = _resolveAttrIndustryRowKeys(row);
    counts[`${attrKey}_${indIdx}`]++;
  }
}

// ============================================================
// Webhook差分適用
// ============================================================

/**
 * Webhookレコードの属性×業界差分をカウントに適用する
 * Bug 5修正: 属性・業界どちらか一方でも変化があれば1対1で差分適用
 *
 * @param {Object} config
 * @param {Object<string, number>} counts
 */
function _applyAttrIndustryDelta(config, counts) {
  const newAttrKey = _resolveAttrKey(String(config.record?.occupation?.value ?? ''));
  const newIndIdx  = _resolveIndustryIdx(String(config.record?.industry?.value   ?? ''));
  const hasExisting = config.existingCustomerData?.length > 0;

  if (hasExisting) {
    const oldAttrKey = _resolveAttrKey(String(config.existingCustomerData[COL_OCCUPATION] ?? ''));
    const oldIndIdx  = _resolveIndustryIdx(String(config.existingCustomerData[COL_INDUSTRY]   ?? ''));

    if (oldAttrKey !== newAttrKey || oldIndIdx !== newIndIdx) {
      counts[`${oldAttrKey}_${oldIndIdx}`]--;
      counts[`${newAttrKey}_${newIndIdx}`]++;
    }
  } else {
    counts[`${newAttrKey}_${newIndIdx}`]++;
  }
}

// ============================================================
// 合計計算
// ============================================================

/**
 * 属性行合計・業界列合計・総合計を計算する
 * @param {Object<string, number>} counts
 */
function _calcAttrIndustryTotals(counts) {
  // 属性ごとの行合計（'total' 行は除く）
  for (const attrKey of ATTR_KEYS.filter(k => k !== 'total')) {
    counts[`${attrKey}_${INDUSTRY_COUNT}`] = Array.from(
      { length: INDUSTRY_COUNT },
      (_, i) => counts[`${attrKey}_${i}`] ?? 0
    ).reduce((sum, v) => sum + v, 0);
  }

  // 業界ごとの列合計（'total' 行に格納）
  for (let i = 0; i <= INDUSTRY_COUNT; i++) {
    counts[`total_${i}`] = ATTR_KEYS
      .filter(k => k !== 'total')
      .reduce((sum, attrKey) => sum + (counts[`${attrKey}_${i}`] ?? 0), 0);
  }
}

// ============================================================
// 書き込み
// ============================================================

/**
 * 属性×業界カウントをグラフシートへ書き込む
 * 属性ごとに1列ずつ、startCol から右方向に書き込む
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} graphSheet
 * @param {number} startRow
 * @param {number} startCol
 * @param {Object<string, number>} counts
 */
function _writeAttrIndustryCounts(graphSheet, startRow, startCol, counts) {
  ATTR_KEYS.forEach((attrKey, colOffset) => {
    // 業界インデックス0〜INDUSTRY_COUNT（合計列含む）を縦に並べる
    const writeData = Array.from(
      { length: INDUSTRY_COUNT + 1 },
      (_, i) => [counts[`${attrKey}_${i}`] ?? 0]
    );
    graphSheet.getRange(startRow, startCol + colOffset, writeData.length, 1)
      .setValues(writeData);
  });

  AppLogger.debug('calcAttrIndustry: 書き込み完了', { startRow, startCol });
}