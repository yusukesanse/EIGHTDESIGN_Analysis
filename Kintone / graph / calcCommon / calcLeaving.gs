// ============================================================
// graph/calcResidential.gs
// ============================================================

/**
 * 離脱理由×担当者の件数を集計し、グラフシートへ書き込む
 * @param {Object} config
 */
function calcLeaving(config) {
  try {
    _calcLeavingBlock(config, LEAVING_BLOCK_ALL);

    if (config.listData[1]?.length > 0) {
      _calcLeavingBlock(config, LEAVING_BLOCK_CLOSED);
    }
  } catch (e) {
    handleError(e.stack, e.message, 'calcLeaving',
      config.record.customer_name.value, config.record.customer_type.value);
  }
}

// ============================================================
// 定数
// ============================================================

/**
 * ブロック定義
 * headerRow:  担当者ヘッダー行番号（1始まり）
 * startRow:   データ書き込み開始行（1始まり）
 * startCol:   データ書き込み開始列（1始まり）
 * reasonCol:  グラフシートの離脱理由ラベル列インデックス（0始まり）
 * reasonRows: 離脱理由ラベルの行範囲 [from, to)（0始まり）
 * dataIndex:  config.listData の参照インデックス
 */
const LEAVING_BLOCK_ALL = {
  headerRow: 182, startRow: 183, startCol: 13,
  reasonCol: 0, reasonRows: [182, 198],
  dataIndex: 0,
};
const LEAVING_BLOCK_CLOSED = {
  headerRow: 182, startRow: 183, startCol: 13,
  reasonCol: 0, reasonRows: [182, 198],
  dataIndex: 1,
};

/** 離脱理由・担当者の列インデックス（0始まり） */
const COL_LEAVING_REASON = RESIDENTIAL_EXTRA_COLS.REASON - 1;
const COL_LEAVING_STAFF  = SALES_LIST_COLS.MANAGER        - 1;

/** 合計キー */
const LEAVING_TOTAL_KEY = '合計';

/** 理由総数キー */
const LEAVING_REASON_TOTAL_KEY = '理由総数';

// ============================================================
// ブロック単位の集計・書き込み
// ============================================================

/**
 * 指定ブロックの離脱理由×担当者を集計してグラフシートへ書き込む
 * @param {Object} config
 * @param {Object} block
 */
function _calcLeavingBlock(config, block) {
  // ── 1. グラフシートからメタデータ取得 ──────────────────────
  const { reasons, staffList } = _readLeavingMeta(config.graphData, block);

  // ── 2. カウンタ初期化 ─────────────────────────────────────
  const counts = _initLeavingCounts(reasons, staffList);

  // ── 3. 一覧データから集計 ─────────────────────────────────
  _countLeavingFromSheet(config.listData[block.dataIndex], reasons, staffList, counts);

  // ── 4. Webhookレコードの差分を適用（営業アプリのみ） ───────
  if (config.appId === config.salesAppId) {
    _applyLeavingDelta(config, reasons, staffList, counts);
  }

  // ── 5. グラフシートへ書き込み ─────────────────────────────
  _writeLeavingCounts(config.graphSheet, block, staffList, reasons, counts);
}

// ============================================================
// メタデータ取得
// ============================================================

/**
 * グラフシートから離脱理由リストと担当者リストを動的に取得する
 * @param {Array<Array<*>>} graphData
 * @param {Object} block
 * @returns {{ reasons: string[], staffList: string[] }}
 */
function _readLeavingMeta(graphData, block) {
  // 離脱理由: reasonRows 範囲の reasonCol 列から取得（空セルを除外）
  const reasons = graphData
    .slice(block.reasonRows[0], block.reasonRows[1])
    .map(row => String(row[block.reasonCol] ?? ''))
    .filter(v => v !== '');

  // 担当者: headerRow の startCol 列以降、空セルまで取得
  const headerRow = graphData[block.headerRow];
  const staffList = [];
  for (let i = block.startCol - 1; i < headerRow.length; i++) {
    if (headerRow[i] === '') break;
    staffList.push(String(headerRow[i]));
  }

  AppLogger.debug('_readLeavingMeta', { reasons, staffList });
  return { reasons, staffList };
}

// ============================================================
// カウンタ初期化
// ============================================================

/**
 * 離脱理由×担当者のカウンタを全キー0で初期化する
 * Bug 3修正: 合計行の「理由総数」も含めて全キーを明示的に0で初期化
 *
 * @param {string[]} reasons
 * @param {string[]} staffList
 * @returns {Object<string, Object<string, number>>}
 */
function _initLeavingCounts(reasons, staffList) {
  const counts = {};
  const allStaffKeys = [LEAVING_REASON_TOTAL_KEY, ...staffList];

  for (const reason of [...reasons, LEAVING_TOTAL_KEY]) {
    counts[reason] = {};
    for (const key of allStaffKeys) {
      counts[reason][key] = 0;
    }
  }
  return counts;
}

// ============================================================
// シートからの集計
// ============================================================

/**
 * 一覧データから離脱理由×担当者のカウントを集計する
 * @param {Array<Array<*>>} dataSet
 * @param {string[]} reasons
 * @param {string[]} staffList
 * @param {Object} counts
 */
function _countLeavingFromSheet(dataSet, reasons, staffList, counts) {
  for (const row of dataSet) {
    const reason = String(row[COL_LEAVING_REASON] ?? '');
    const staff  = String(row[COL_LEAVING_STAFF]  ?? '');

    if (!reasons.includes(reason)) continue;

    counts[reason][LEAVING_REASON_TOTAL_KEY]++;
    counts[LEAVING_TOTAL_KEY][LEAVING_REASON_TOTAL_KEY]++;

    if (staffList.includes(staff)) {
      counts[reason][staff]++;
      counts[LEAVING_TOTAL_KEY][staff]++;
    }
  }
}

// ============================================================
// Webhook差分適用
// ============================================================

/**
 * Webhookレコードの離脱理由差分をカウントに適用する
 * Bug 2修正: oldReason が reasons に存在しない場合は差分処理をスキップ
 *
 * @param {Object} config
 * @param {string[]} reasons
 * @param {string[]} staffList
 * @param {Object} counts
 */
function _applyLeavingDelta(config, reasons, staffList, counts) {
  const newReason = String(config.record?.reason?.value ?? '');
  const newStaff  = config.record?.manager?.value?.[0]?.name ?? '';
  const hasExisting = config.existingCustomerData?.length > 0;

  if (hasExisting) {
    const oldReason = String(config.existingCustomerData[COL_LEAVING_REASON] ?? '');
    const oldStaff  = String(config.existingCustomerData[COL_LEAVING_STAFF]  ?? '');

    // Bug 2修正: 旧理由が管理対象外なら差分スキップ
    if (!reasons.includes(oldReason)) {
      if (reasons.includes(newReason) && staffList.includes(newStaff)) {
        _incLeavingCount(counts, newReason, newStaff, 1);
      }
      return;
    }

    if (oldReason !== newReason || oldStaff !== newStaff) {
      if (staffList.includes(oldStaff)) _incLeavingCount(counts, oldReason, oldStaff, -1);
      if (reasons.includes(newReason) && staffList.includes(newStaff)) {
        _incLeavingCount(counts, newReason, newStaff, 1);
      }
    }
  } else {
    if (reasons.includes(newReason) && staffList.includes(newStaff)) {
      _incLeavingCount(counts, newReason, newStaff, 1);
    }
  }
}

/**
 * 離脱理由・担当者・合計行のカウントを同時に増減する
 * @param {Object} counts
 * @param {string} reason
 * @param {string} staff
 * @param {number} delta - +1 または -1
 */
function _incLeavingCount(counts, reason, staff, delta) {
  counts[reason][staff]                           += delta;
  counts[reason][LEAVING_REASON_TOTAL_KEY]        += delta;
  counts[LEAVING_TOTAL_KEY][staff]                += delta;
  counts[LEAVING_TOTAL_KEY][LEAVING_REASON_TOTAL_KEY] += delta;
}

// ============================================================
// 書き込み
// ============================================================

/**
 * 離脱理由×担当者カウントをグラフシートへ書き込む
 * 離脱理由ごとに1行、担当者ごとに1列の2次元配列で書き込む
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} graphSheet
 * @param {Object} block
 * @param {string[]} staffList
 * @param {string[]} reasons
 * @param {Object} counts
 */
function _writeLeavingCounts(graphSheet, block, staffList, reasons, counts) {
  // 追加: staffList が空なら書き込みをスキップ
  if (staffList.length === 0) {
    AppLogger.warn('_writeLeavingCounts: staffList が空のため書き込みをスキップします', { block });
    return;
  }
  
  const writeData = reasons.map(reason =>
    staffList.map(staff => counts[reason]?.[staff] ?? 0)
  );

  graphSheet
    .getRange(block.startRow, block.startCol, writeData.length, staffList.length)
    .setValues(writeData);

  AppLogger.debug('calcLeaving: 書き込み完了', {
    startRow: block.startRow, startCol: block.startCol,
    rows: writeData.length, cols: staffList.length,
  });
}