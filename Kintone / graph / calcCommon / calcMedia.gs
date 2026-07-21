// ============================================================
// graph/calcCommon.gs
// ============================================================

/**
 * 反響媒体別の件数を集計し、グラフシートへ書き込む
 * 全顧客データ（listData[0]）と成約者データ（listData[1]）の2ブロックを処理する
 * @param {Object} config
 */
function calcMedia(config) {
  try {
    _calcMediaBlock(config, MEDIA_BLOCK_ALL);

    // 成約者データが存在する場合のみ第2ブロックを処理
    if (config.listData[1]?.length > 0) {
      _calcMediaBlock(config, MEDIA_BLOCK_CLOSED);
    }
  } catch (e) {
    handleError(e.stack, e.message, 'calcMedia',
      config.record.customer_name.value, config.record.customer_type.value);
  }
}

// ============================================================
// 定数
// ============================================================

/**
 * 反響媒体ブロックの定義
 * headerRow: グラフシート上の年度ヘッダー行番号（1始まり）
 * dataIndex: config.listData の参照インデックス
 * rowCount:  媒体ラベルの行数（合計行を含む）
 */
const MEDIA_BLOCK_ALL    = { headerRow: 229, dataIndex: 0, rowCount: 25 };
const MEDIA_BLOCK_CLOSED = { headerRow: 285, dataIndex: 1, rowCount: 25 };

/** 反響媒体の列インデックス（0始まり） */
const COL_INFO_ROUTE = CUSTOMER_LIST_COLS.INFO_ROUTE - 1;

// ============================================================
// ブロック単位の集計・書き込み
// ============================================================

/**
 * 指定ブロックの反響媒体を集計してグラフシートへ書き込む
 * @param {Object} config
 * @param {{ headerRow: number, dataIndex: number, rowCount: number }} block
 */
function _calcMediaBlock(config, block) {
  const { headerRow, dataIndex, rowCount } = block;

  // ── 1. 媒体ラベルと列インデックスを取得 ──────────────────
  const { mediaLabels, colIndex } = _readMediaMeta(
    config.graphData, config.inquiryYear, headerRow, rowCount
  );

  if (colIndex === -1) {
    AppLogger.warn('calcMedia: 対象年度の列が見つかりません', { inquiryYear: config.inquiryYear, headerRow });
    return;
  }

  // ── 2. 一覧データから媒体別カウントを集計 ─────────────────
  const counts = _countMediaFromSheet(config.listData[dataIndex], mediaLabels);

  // ── 3. Webhookレコードの差分を適用 ────────────────────────
  _applyMediaDelta(config, mediaLabels, counts);

  // ── 4. 合計を末尾の専用インデックスに格納 ─────────────────
  counts[mediaLabels.length] = counts.slice(0, mediaLabels.length)
    .reduce((sum, v) => sum + v, 0);

  // ── 5. グラフシートへ書き込み ─────────────────────────────
  _writeMediaCounts(config.graphSheet, headerRow, colIndex, counts);
}

// ============================================================
// メタデータ取得
// ============================================================

/**
 * グラフシートから媒体ラベルと年度列インデックスを取得する
 * @param {Array<Array<*>>} graphData
 * @param {string} inquiryYear
 * @param {number} headerRow - ヘッダー行番号（1始まり）
 * @param {number} rowCount  - 媒体ラベルの行数（合計行を含む）
 * @returns {{ mediaLabels: string[], colIndex: number }}
 */
function _readMediaMeta(graphData, inquiryYear, headerRow, rowCount) {
  const colIndex = graphData[headerRow].indexOf(inquiryYear);

  // ヘッダー行の直下から rowCount-1 行分（合計行の1行前まで）を媒体ラベルとして取得
  const mediaLabels = graphData
    .slice(headerRow + 1, headerRow + 1 + rowCount)
    .map(row => String(row[0]));

  return { mediaLabels, colIndex };
}

// ============================================================
// シートからの集計
// ============================================================

/**
 * 一覧データから媒体別カウント配列を生成する
 * counts[i] が mediaLabels[i] に対応する件数
 * counts[mediaLabels.length] は合計用スロット（初期値0）
 *
 * @param {Array<Array<*>>} dataSet
 * @param {string[]} mediaLabels
 * @returns {number[]}
 */
function _countMediaFromSheet(dataSet, mediaLabels) {
  const counts = new Array(mediaLabels.length + 1).fill(0);  // +1 は合計用スロット

  for (const row of dataSet) {
    const idx = mediaLabels.indexOf(String(row[COL_INFO_ROUTE]));
    if (idx !== -1) counts[idx]++;
  }
  return counts;
}

// ============================================================
// Webhook差分適用
// ============================================================

/**
 * Webhookレコードの反響媒体差分をカウントに適用する
 * 既存顧客の場合: 旧媒体を-1して新媒体を+1（媒体変更の上書きに対応）
 * 新規顧客の場合: 新媒体を+1
 *
 * @param {Object} config
 * @param {string[]} mediaLabels
 * @param {number[]} counts
 */
function _applyMediaDelta(config, mediaLabels, counts) {
  const newRoute   = String(config.record?.information_route?.value ?? '');
  const newIdx     = mediaLabels.indexOf(newRoute);
  const hasExisting = config.existingCustomerData?.length > 0;

  if (newIdx === -1) {
    AppLogger.warn('calcMedia: 反響媒体がラベル一覧に見つかりません', { newRoute });
    return;
  }

  if (hasExisting) {
    const oldRoute = String(config.existingCustomerData[COL_INFO_ROUTE] ?? '');
    const oldIdx   = mediaLabels.indexOf(oldRoute);

    // Bug 3 修正: oldIdx === -1 のとき counts[-1] への書き込みを防ぐ
    if (oldRoute !== newRoute) {
      if (oldIdx !== -1) counts[oldIdx]--;
      counts[newIdx]++;
    }
    // 媒体が変わっていなければ差分なし（シート集計に既に含まれている）
  } else {
    counts[newIdx]++;
  }
}

// ============================================================
// 書き込み
// ============================================================

/**
 * 媒体別カウントをグラフシートへ書き込む
 * @param {GoogleAppsScript.Spreadsheet.Sheet} graphSheet
 * @param {number} headerRow - ヘッダー行番号（1始まり）
 * @param {number} colIndex  - 書き込み列インデックス（0始まり）
 * @param {number[]} counts  - 媒体別カウント + 合計スロット
 */
function _writeMediaCounts(graphSheet, headerRow, colIndex, counts) {
  const startRow  = headerRow + 1;
  const writeData = counts.map(v => [v]);
  graphSheet.getRange(startRow, colIndex + 1, writeData.length, 1).setValues(writeData);
  AppLogger.debug('calcMedia: 書き込み完了', { headerRow, colIndex, rowCount: writeData.length });
}