// ============================================================
// graph/calcCommon.gs
// 全ドメイン集計で共通利用される汎用ヘルパー関数
// ============================================================

/**
 * 指定行の中から対象年度の列インデックスを返す（0始まり）
 * @param {Array<Array<*>>} data
 * @param {number} rowIdx
 * @param {string} year
 * @returns {number} 見つからない場合は -1
 */
function _findYearColIdx(data, rowIdx, year) {
  return data[rowIdx]?.indexOf(year) ?? -1;
}

/**
 * 列インデックスが -1 のとき handleError を呼んで例外を throw する
 * @param {number} colIdx
 * @param {string} funcName
 * @param {Object} config
 */
function _assertColIdx(colIdx, funcName, config) {
  if (colIdx !== -1) return;
  const msg = '対象年度がヘッダー行に存在しません。';
  handleError(msg, msg, funcName,
    config.record.customer_name.value, config.record.customer_type.value);
  throw new Error(msg);
}

/**
 * 全ドメインシートの A 列からヘッダー行のインデックスを返す
 * @param {Array<string>} colData
 * @param {string} keyword     - 含むべきキーワード
 * @param {string} antiKeyword - 除外するキーワード
 * @returns {number[]}
 */
function _findProgressHeaderRows(colData, keyword, antiKeyword) {
  return colData.reduce((acc, cell, i) => {
    const s = String(cell);
    if (s.includes(keyword) && s !== antiKeyword) {
      acc.push(i);
    }
    return acc;
  }, []);
}

/**
 * 安全な比率計算（分母が0の場合は0を返す）
 * @param {number} numerator
 * @param {number} denominator
 * @returns {number}
 */
function _safeRatio(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}