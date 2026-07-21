// ============================================================
// graph/calcResidential.gs
// ============================================================

/**
 * 年収×年齢の相関を集計し、グラフシートへ書き込む
 * @param {Object} config
 */
function calcIncomeAge(config) {
  try {
    _calcIncomeAgeBlock(config, INCOME_AGE_BLOCK_ALL);

    if (config.listData[1]?.length > 0) {
      _calcIncomeAgeBlock(config, INCOME_AGE_BLOCK_CLOSED);
    }
  } catch (e) {
    handleError(e.stack, e.message, 'calcIncomeAge',
      config.record.customer_name.value, config.record.customer_type.value);
  }
}

// ============================================================
// 定数
// ============================================================

/** ブロック定義 */
const INCOME_AGE_BLOCK_ALL    = { startRow: 121, startCol: 2,  dataIndex: 0 };
const INCOME_AGE_BLOCK_CLOSED = { startRow: 121, startCol: 13, dataIndex: 1 };

/**
 * 年齢区分定義（min 超 max 以下）
 * unknown はフォールバック用に末尾に置き、条件判定をスキップする
 * @type {Array<{ min: number, max: number, key: string }>}
 */
const AGE_SECTIONS = [
  { min: 0,  max: 24, key: 'under24' },
  { min: 24, max: 30, key: 'under30' },
  { min: 30, max: 36, key: 'under36' },
  { min: 36, max: 43, key: 'under43' },
  { min: 43, max: 48, key: 'under48' },
  { min: 48, max: 59, key: 'under59' },
  { min: 59, max: 68, key: 'under68' },
];

/**
 * 年収区分定義（0超 max 以下）
 * unknown はフォールバック用に末尾に置き、条件判定をスキップする
 * @type {Array<{ max: number, key: string }>}
 */
const INCOME_SECTIONS = [
  { max: 4000000,  key: 'under400'  },
  { max: 5000000,  key: 'under500'  },
  { max: 6000000,  key: 'under600'  },
  { max: 7000000,  key: 'under700'  },
  { max: 8000000,  key: 'under800'  },
  { max: 9000000,  key: 'under900'  },
  { max: 10000000, key: 'under1000' },
  { max: Infinity, key: 'over1000'  },
];

/** 年齢キー一覧（unknown含む） */
const AGE_KEYS    = [...AGE_SECTIONS.map(s => s.key), 'unknown'];

/** 年収キー一覧（unknown含む） */
const INCOME_KEYS = [...INCOME_SECTIONS.map(s => s.key), 'unknown'];

/** 年齢・年収の列インデックス（0始まり） */
const COL_AGE    = CUSTOMER_LIST_COLS.AGE    - 1;
const COL_INCOME = SALES_LIST_COLS.INCOME    - 1;

// ============================================================
// ブロック単位の集計・書き込み
// ============================================================

/**
 * 指定ブロックの年収×年齢を集計してグラフシートへ書き込む
 * @param {Object} config
 * @param {{ startRow: number, startCol: number, dataIndex: number }} block
 */
function _calcIncomeAgeBlock(config, block) {
  const { startRow, startCol, dataIndex } = block;

  // ── 1. カウンタ初期化 ─────────────────────────────────────
  const counts = _initIncomeAgeCounts();

  // ── 2. 一覧データから集計 ─────────────────────────────────
  _countIncomeAgeFromSheet(config.listData[dataIndex], counts);

  // ── 3. Webhookレコードの差分を適用 ────────────────────────
  _applyIncomeAgeDelta(config, counts);

  // ── 4. 行・列の合計を計算 ─────────────────────────────────
  _calcIncomeAgeTotals(counts);

  // ── 5. グラフシートへ書き込み ─────────────────────────────
  _writeIncomeAgeCounts(config.graphSheet, startRow, startCol, counts);
}

// ============================================================
// カウンタ初期化
// ============================================================

/**
 * 年収×年齢のカウンタを全キー0で初期化する
 * @returns {Object<string, number>}
 */
function _initIncomeAgeCounts() {
  const counts = {};
  for (const ageKey of AGE_KEYS) {
    for (const incomeKey of INCOME_KEYS) {
      counts[`${ageKey}_${incomeKey}`] = 0;
    }
    counts[`${ageKey}_total`] = 0;  // 年齢行合計
  }
  for (const incomeKey of INCOME_KEYS) {
    counts[`total_${incomeKey}`] = 0;  // 年収列合計
  }
  counts['grand_total'] = 0;
  return counts;
}

// ============================================================
// 区分解決ヘルパー
// ============================================================

/**
 * 年齢値を年齢キーに変換する
 * @param {number} age
 * @returns {string}
 */
function _resolveAgeKey(age) {
  if (!age || age <= 0) return 'unknown';
  const section = AGE_SECTIONS.find(s => age > s.min && age <= s.max);
  return section?.key ?? 'unknown';  // Bug 3修正: フォールバックを ?? で明示
}

/**
 * 年収値を年収キーに変換する
 * @param {number} income
 * @returns {string}
 */
function _resolveIncomeKey(income) {
  if (!income || income <= 0) return 'unknown';
  const section = INCOME_SECTIONS.find(s => income <= s.max);
  return section?.key ?? 'unknown';
}

/**
 * 行データから年齢キーと年収キーを取得する
 * @param {Array<*>} row
 * @returns {{ ageKey: string, incomeKey: string }}
 */
function _resolveRowKeys(row) {
  return {
    ageKey:    _resolveAgeKey(Number(row[COL_AGE])    || 0),
    incomeKey: _resolveIncomeKey(Number(row[COL_INCOME]) || 0),
  };
}

// ============================================================
// シートからの集計
// ============================================================

/**
 * 一覧データから年収×年齢のカウントを集計する
 * @param {Array<Array<*>>} dataSet
 * @param {Object<string, number>} counts
 */
function _countIncomeAgeFromSheet(dataSet, counts) {
  for (const row of dataSet) {
    const { ageKey, incomeKey } = _resolveRowKeys(row);
    counts[`${ageKey}_${incomeKey}`]++;
  }
}

// ============================================================
// Webhook差分適用
// ============================================================

/**
 * Webhookレコードの年収×年齢差分をカウントに適用する
 * appIdによる分岐を廃止し、「旧値と新値の差分」のみで統一
 *
 * @param {Object} config
 * @param {Object<string, number>} counts
 */
function _applyIncomeAgeDelta(config, counts) {
  // Bug 1修正: income は既に万円単位で格納されているためそのまま数値化
  const newAge    = Number(config.record?.age?.value)    || 0;
  const newIncome = Number(config.record?.income?.value) || 0;
  const newAgeKey    = _resolveAgeKey(newAge);
  const newIncomeKey = _resolveIncomeKey(newIncome);

  const hasExisting = config.existingCustomerData?.length > 0;

  if (hasExisting) {
    const oldAgeKey    = _resolveAgeKey(Number(config.existingCustomerData[COL_AGE])    || 0);
    const oldIncomeKey = _resolveIncomeKey(Number(config.existingCustomerData[COL_INCOME]) || 0);

    // 値が変化した場合のみ差分適用（同一なら二重計上なし）
    if (oldAgeKey !== newAgeKey || oldIncomeKey !== newIncomeKey) {
      counts[`${oldAgeKey}_${oldIncomeKey}`]--;
      counts[`${newAgeKey}_${newIncomeKey}`]++;
    }
  } else {
    counts[`${newAgeKey}_${newIncomeKey}`]++;
  }
}

// ============================================================
// 合計計算
// ============================================================

/**
 * 年齢行合計・年収列合計・総合計を計算してcountsに格納する
 * @param {Object<string, number>} counts
 */
function _calcIncomeAgeTotals(counts) {
  // 年齢ごとの行合計
  for (const ageKey of AGE_KEYS) {
    counts[`${ageKey}_total`] = INCOME_KEYS
      .reduce((sum, incomeKey) => sum + (counts[`${ageKey}_${incomeKey}`] ?? 0), 0);
  }
  // 年収ごとの列合計
  for (const incomeKey of INCOME_KEYS) {
    counts[`total_${incomeKey}`] = AGE_KEYS
      .reduce((sum, ageKey) => sum + (counts[`${ageKey}_${incomeKey}`] ?? 0), 0);
  }
  // 総合計
  counts['grand_total'] = AGE_KEYS
    .reduce((sum, ageKey) => sum + (counts[`${ageKey}_total`] ?? 0), 0);
}

// ============================================================
// 書き込み
// ============================================================

/**
 * 年収×年齢カウントをグラフシートへ書き込む
 * 年齢ごとに1列ずつ、startCol から右方向に書き込む
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} graphSheet
 * @param {number} startRow - 書き込み開始行（1始まり）
 * @param {number} startCol - 書き込み開始列（1始まり）
 * @param {Object<string, number>} counts
 */
function _writeIncomeAgeCounts(graphSheet, startRow, startCol, counts) {
  AGE_KEYS.forEach((ageKey, colOffset) => {
    // 各年齢列: 年収キー順に並べ、末尾に行合計を追加
    const writeData = [
      ...INCOME_KEYS.map(incomeKey => [counts[`${ageKey}_${incomeKey}`] ?? 0]),
      [counts[`${ageKey}_total`] ?? 0],
    ];
    graphSheet.getRange(startRow, startCol + colOffset, writeData.length, 1)
      .setValues(writeData);
  });

  AppLogger.debug('calcIncomeAge: 書き込み完了', { startRow, startCol });
}