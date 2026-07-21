// ============================================================
// graph/calcResidential.gs
// ============================================================

/**
 * 年齢×家族数の相関を集計し、グラフシートへ書き込む
 * @param {Object} config
 */
function calcAgeFamily(config) {
  try {
    _calcAgeFamilyBlock(config, AGE_FAMILY_BLOCK_ALL);

    if (config.listData[1]?.length > 0) {
      _calcAgeFamilyBlock(config, AGE_FAMILY_BLOCK_CLOSED);
    }
  } catch (e) {
    handleError(e.stack, e.message, 'calcAgeFamily',
      config.record.customer_name.value, config.record.customer_type.value);
  }
}

// ============================================================
// 定数
// ============================================================

/** ブロック定義 */
const AGE_FAMILY_BLOCK_ALL    = { startRow: 139, startCol: 2,  dataIndex: 0 };
const AGE_FAMILY_BLOCK_CLOSED = { startRow: 139, startCol: 13, dataIndex: 1 };

/**
 * 家族数キー一覧
 * AGE_KEYS は calcIncomeAge で定義済みの定数を共用
 * @type {string[]}
 */
const FAMILY_KEYS = ['fam1', 'fam2', 'fam3', 'fam4', 'fam5', 'fam6', 'unknown'];

/** 家族数の列インデックス（0始まり） */
const COL_FAMILY = CUSTOMER_LIST_COLS.FAMILY_MEMBER - 1;

// ============================================================
// ブロック単位の集計・書き込み
// ============================================================

/**
 * 指定ブロックの年齢×家族数を集計してグラフシートへ書き込む
 * @param {Object} config
 * @param {{ startRow: number, startCol: number, dataIndex: number }} block
 */
function _calcAgeFamilyBlock(config, block) {
  const { startRow, startCol, dataIndex } = block;

  const counts = _initAgeFamilyCounts();
  _countAgeFamilyFromSheet(config.listData[dataIndex], counts);
  _applyAgeFamilyDelta(config, counts);
  _calcAgeFamilyTotals(counts);
  _writeAgeFamilyCounts(config.graphSheet, startRow, startCol, counts);
}

// ============================================================
// カウンタ初期化
// ============================================================

/**
 * 年齢×家族数のカウンタを全キー0で初期化する
 * @returns {Object<string, number>}
 */
function _initAgeFamilyCounts() {
  const counts = {};
  for (const ageKey of AGE_KEYS) {
    for (const famKey of FAMILY_KEYS) {
      counts[`${ageKey}_${famKey}`] = 0;
    }
    counts[`${ageKey}_total`] = 0;
  }
  for (const famKey of FAMILY_KEYS) {
    counts[`total_${famKey}`] = 0;
  }
  counts['grand_total'] = 0;
  return counts;
}

// ============================================================
// 区分解決ヘルパー
// ============================================================

/**
 * 家族数値を家族数キーに変換する
 * @param {number} famVal
 * @returns {string}
 */
function _resolveFamilyKey(famVal) {
  if (famVal >= 1 && famVal <= 6) return `fam${famVal}`;
  return 'unknown';
}

/**
 * 行データから年齢キーと家族数キーを取得する
 * @param {Array<*>} row
 * @returns {{ ageKey: string, famKey: string }}
 */
function _resolveAgeFamilyRowKeys(row) {
  return {
    ageKey: _resolveAgeKey(Number(row[COL_AGE])    || 0),
    famKey: _resolveFamilyKey(Number(row[COL_FAMILY]) || 0),
  };
}

// ============================================================
// シートからの集計
// ============================================================

/**
 * 一覧データから年齢×家族数のカウントを集計する
 * @param {Array<Array<*>>} dataSet
 * @param {Object<string, number>} counts
 */
function _countAgeFamilyFromSheet(dataSet, counts) {
  for (const row of dataSet) {
    const { ageKey, famKey } = _resolveAgeFamilyRowKeys(row);
    counts[`${ageKey}_${famKey}`]++;
  }
}

// ============================================================
// Webhook差分適用
// ============================================================

/**
 * Webhookレコードの年齢×家族数差分をカウントに適用する
 *
 * Bug 1修正:
 * 元のコードは年齢・家族数が両方変わった場合に
 * 旧セル -1、新年齢セル +1、新家族数セル +1 と分割加算していたため合計が +1 になっていた
 * 正しくは「旧セル -1、新セル +1」の1対1の差分のみ
 *
 * @param {Object} config
 * @param {Object<string, number>} counts
 */
function _applyAgeFamilyDelta(config, counts) {
  const newAgeKey = _resolveAgeKey(Number(config.record?.age?.value)           || 0);
  const newFamKey = _resolveFamilyKey(Number(config.record?.family_member?.value) || 0);
  const hasExisting = config.existingCustomerData?.length > 0;

  if (hasExisting) {
    const oldAgeKey = _resolveAgeKey(Number(config.existingCustomerData[COL_AGE])    || 0);
    const oldFamKey = _resolveFamilyKey(Number(config.existingCustomerData[COL_FAMILY]) || 0);

    // 年齢・家族数いずれか一方でも変化があった場合のみ1対1で差分適用
    if (oldAgeKey !== newAgeKey || oldFamKey !== newFamKey) {
      counts[`${oldAgeKey}_${oldFamKey}`]--;
      counts[`${newAgeKey}_${newFamKey}`]++;
    }
  } else {
    counts[`${newAgeKey}_${newFamKey}`]++;
  }
}

// ============================================================
// 合計計算
// ============================================================

/**
 * 年齢行合計・家族数列合計・総合計を計算する
 * @param {Object<string, number>} counts
 */
function _calcAgeFamilyTotals(counts) {
  for (const ageKey of AGE_KEYS) {
    counts[`${ageKey}_total`] = FAMILY_KEYS
      .reduce((sum, famKey) => sum + (counts[`${ageKey}_${famKey}`] ?? 0), 0);
  }
  for (const famKey of FAMILY_KEYS) {
    counts[`total_${famKey}`] = AGE_KEYS
      .reduce((sum, ageKey) => sum + (counts[`${ageKey}_${famKey}`] ?? 0), 0);
  }
  counts['grand_total'] = AGE_KEYS
    .reduce((sum, ageKey) => sum + (counts[`${ageKey}_total`] ?? 0), 0);
}

// ============================================================
// 書き込み
// ============================================================

/**
 * 年齢×家族数カウントをグラフシートへ書き込む
 * 年齢ごとに1列ずつ、startCol から右方向に書き込む
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} graphSheet
 * @param {number} startRow - 書き込み開始行（1始まり）
 * @param {number} startCol - 書き込み開始列（1始まり）
 * @param {Object<string, number>} counts
 */
function _writeAgeFamilyCounts(graphSheet, startRow, startCol, counts) {
  AGE_KEYS.forEach((ageKey, colOffset) => {
    const writeData = [
      ...FAMILY_KEYS.map(famKey => [counts[`${ageKey}_${famKey}`] ?? 0]),
      [counts[`${ageKey}_total`] ?? 0],
    ];
    graphSheet.getRange(startRow, startCol + colOffset, writeData.length, 1)
      .setValues(writeData);
  });

  AppLogger.debug('calcAgeFamily: 書き込み完了', { startRow, startCol });
}