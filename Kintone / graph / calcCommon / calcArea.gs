// ============================================================
// graph/calcCommon.gs
// ============================================================

/**
 * エリア別の件数を集計し、グラフシートへ書き込む
 * 全顧客データ（listData[0]）と成約者データ（listData[1]）の2ブロックを処理する
 * @param {Object} config
 */
function calcArea(config) {
  try {
    _calcAreaBlock(config, AREA_BLOCK_ALL);

    if (config.listData[1]?.length > 0) {
      _calcAreaBlock(config, AREA_BLOCK_CLOSED);
    }
  } catch (e) {
    handleError(e.stack, e.message, 'calcArea',
      config.record.customer_name.value, config.record.customer_type.value);
  }
}

// ============================================================
// 定数
// ============================================================

/**
 * エリアブロックの定義
 * headerRow: グラフシート上の年度ヘッダー行番号（1始まり）
 * dataIndex: config.listData の参照インデックス
 * rowCount:  エリアラベルの行数（合計行を除く）
 */
const AREA_BLOCK_ALL    = { headerRow: 341, dataIndex: 0, rowCount: 99 };
const AREA_BLOCK_CLOSED = { headerRow: 471, dataIndex: 1, rowCount: 99 };

/** 希望エリア列インデックス（0始まり） */
const COL_PREFECTURE = SALES_LIST_COLS.PREFECTURE - 1;  // 都道府県
const COL_CITY       = SALES_LIST_COLS.CITY       - 1;  // 市・区

// ============================================================
// ブロック単位の集計・書き込み
// ============================================================

/**
 * 指定ブロックのエリアを集計してグラフシートへ書き込む
 * @param {Object} config
 * @param {{ headerRow: number, dataIndex: number, rowCount: number }} block
 */
function _calcAreaBlock(config, block) {
  const { headerRow, dataIndex, rowCount } = block;

  // ── 1. エリアラベルと列インデックスを取得 ─────────────────
  const { areaLabels, colIndex } = _readAreaMeta(
    config.graphData, config.inquiryYear, headerRow, rowCount
  );
  if (colIndex === -1) {
    AppLogger.warn('calcArea: 対象年度の列が見つかりません', { inquiryYear: config.inquiryYear, headerRow });
    return;
  }

  // ── 2. 一覧データからエリア別カウントを集計 ───────────────
  const counts = _countAreaFromSheet(config.listData[dataIndex], areaLabels);

  // ── 3. Webhookレコードの差分を適用 ────────────────────────
  _applyAreaDelta(config, areaLabels, counts);

  // ── 4. 合計を末尾の専用スロットに格納 ─────────────────────
  counts[areaLabels.length] = counts
    .slice(0, areaLabels.length)
    .reduce((sum, v) => sum + v, 0);

  // ── 5. グラフシートへ書き込み ─────────────────────────────
  _writeAreaCounts(config.graphSheet, headerRow, colIndex, counts);
}

// ============================================================
// メタデータ取得
// ============================================================

/**
 * グラフシートからエリアラベルと年度列インデックスを取得する
 * @param {Array<Array<*>>} graphData
 * @param {string} inquiryYear
 * @param {number} headerRow - ヘッダー行番号（1始まり）
 * @param {number} rowCount  - エリアラベルの行数（合計行を除く）
 * @returns {{ areaLabels: string[], colIndex: number }}
 */
function _readAreaMeta(graphData, inquiryYear, headerRow, rowCount) {
  const colIndex   = graphData[headerRow].indexOf(inquiryYear);
  const areaLabels = graphData
    .slice(headerRow + 1, headerRow + 1 + rowCount)
    .map(row => String(row[0]));

  return { areaLabels, colIndex };
}

// ============================================================
// エリア解決ヘルパー
// ============================================================

/**
 * 行データから希望エリアのラベルインデックスを解決する
 * 市・区を優先し、見つからなければ都道府県にフォールバックする
 *
 * @param {Array<*>} row - 行データ（0始まり）
 * @param {string[]} areaLabels
 * @returns {number} ラベルインデックス（見つからない場合は -1）
 */
function _resolveAreaIndex(row, areaLabels) {
  const city = String(row[COL_CITY]       ?? '');
  const pref = String(row[COL_PREFECTURE] ?? '');

  if (city !== '') {
    const idx = areaLabels.indexOf(city);
    if (idx !== -1) return idx;
  }
  if (pref !== '') {
    return areaLabels.indexOf(pref);
  }
  return -1;
}

// ============================================================
// シートからの集計
// ============================================================

/**
 * 一覧データからエリア別カウント配列を生成する
 * counts[i] が areaLabels[i] に対応する件数
 * counts[areaLabels.length] は合計用スロット（初期値0）
 *
 * @param {Array<Array<*>>} dataSet
 * @param {string[]} areaLabels
 * @returns {number[]}
 */
function _countAreaFromSheet(dataSet, areaLabels) {
  const counts = new Array(areaLabels.length + 1).fill(0);  // +1 は合計用スロット

  for (const row of dataSet) {
    const idx = _resolveAreaIndex(row, areaLabels);
    if (idx !== -1) counts[idx]++;
  }
  return counts;
}

// ============================================================
// Webhook差分適用
// ============================================================

/**
 * Webhookレコードのエリア差分をカウントに適用する
 * 既存顧客の場合: 旧エリアを-1して新エリアを+1（エリア変更の上書きに対応）
 * 新規顧客の場合: 新エリアを+1
 *
 * @param {Object} config
 * @param {string[]} areaLabels
 * @param {number[]} counts
 */
function _applyAreaDelta(config, areaLabels, counts) {
  const recordRow = [];
  recordRow[COL_CITY]       = config.record?.address_1?.value ?? '';  // 修正
  recordRow[COL_PREFECTURE] = config.record?.address_0?.value ?? '';  // 修正

  const newIdx      = _resolveAreaIndex(recordRow, areaLabels);
  const hasExisting = config.existingCustomerData?.length > 0;

  if (newIdx === -1) {
    AppLogger.warn('calcArea: レコードのエリアがラベル一覧に見つかりません', {
      city: config.record?.address_1?.value,
      pref: config.record?.address_0?.value,
    });
    return;
  }

  if (hasExisting) {
    const oldIdx = _resolveAreaIndex(config.existingCustomerData, areaLabels);
    if (oldIdx !== newIdx) {
      if (oldIdx !== -1) counts[oldIdx]--;
      counts[newIdx]++;
    }
  } else {
    counts[newIdx]++;
  }
}

// ============================================================
// 書き込み
// ============================================================

/**
 * エリア別カウントをグラフシートへ書き込む
 * @param {GoogleAppsScript.Spreadsheet.Sheet} graphSheet
 * @param {number} headerRow - ヘッダー行番号（1始まり）
 * @param {number} colIndex  - 書き込み列インデックス（0始まり）
 * @param {number[]} counts  - エリア別カウント + 合計スロット
 */
function _writeAreaCounts(graphSheet, headerRow, colIndex, counts) {
  const startRow  = headerRow + 1;
  const writeData = counts.map(v => [v]);
  graphSheet.getRange(startRow, colIndex + 1, writeData.length, 1).setValues(writeData);
  AppLogger.debug('calcArea: 書き込み完了', { headerRow, colIndex, rowCount: writeData.length });
}