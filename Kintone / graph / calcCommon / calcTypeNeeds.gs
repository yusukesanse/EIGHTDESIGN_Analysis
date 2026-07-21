// ============================================================
// graph/calcBusiness.gs
// ============================================================

/**
 * 業態×業種の件数を集計し、グラフシートへ書き込む
 * @param {Object} config
 */
function calcTypeNeeds(config) {
  try {
    _calcTypeNeedsBlock(config, TYPE_NEEDS_BLOCK_ALL);

    if (config.listData[1]?.length > 0) {
      _calcTypeNeedsBlock(config, TYPE_NEEDS_BLOCK_CLOSED);
    }
  } catch (e) {
    handleError(e.stack, e.message, 'calcTypeNeeds',
      config.record.customer_name.value, config.record.customer_type.value);
  }
}

// ============================================================
// 定数
// ============================================================

/** ブロック定義 */
const TYPE_NEEDS_BLOCK_ALL    = { startRow: 155, startCol: 2, dataIndex: 0 };
const TYPE_NEEDS_BLOCK_CLOSED = { startRow: 177, startCol: 2, dataIndex: 1 };

/**
 * グラフシート上の業態ヘッダー行番号（1始まり）
 * 2列目以降、空セルまでを業態リストとして取得する
 */
const TYPE_NEEDS_HEADER_ROW = 176;

/**
 * グラフシート上の業種ラベル行範囲（0始まり）
 */
const TYPE_NEEDS_TYPE_ROWS = [155, 172];

/**
 * 業態フラグ列 → 業態インデックスのマッピング（0始まり）
 * 列インデックスが非空なら対応する業態インデックスを使う
 * @type {Array<{ col: number, needsIdx: number }>}
 */
const TYPE_NEEDS_FLAG_COLS = [
  { col: BUSINESS_EXTRA_COLS.HOPE_TYPE_A - 1, needsIdx: 0 },  // 独立・入居希望
  { col: BUSINESS_EXTRA_COLS.HOPE_TYPE_B - 1, needsIdx: 1 },  // 既存店回収・大家
  { col: BUSINESS_EXTRA_COLS.HOPE_TYPE_C - 1, needsIdx: 2 },  // 新店舗・移転
];

/** 業種の列インデックス（0始まり） */
const COL_TYPE_NEEDS_INDUSTRY = SALES_LIST_COLS.INDUSTRY - 1;

// ============================================================
// ブロック単位の集計・書き込み
// ============================================================

/**
 * 指定ブロックの業態×業種を集計してグラフシートへ書き込む
 * @param {Object} config
 * @param {{ startRow: number, startCol: number, dataIndex: number }} block
 */
function _calcTypeNeedsBlock(config, block) {
  const { needsList, typeList } = _readTypeNeedsMeta(config.graphData);
  const counts = _initTypeNeedsCounts(needsList, typeList);
  _countTypeNeedsFromSheet(config.listData[block.dataIndex], needsList, typeList, counts);

  if (config.appId === config.salesAppId) {
    _applyTypeNeedsDelta(config, needsList, typeList, counts);
  }

  _writeTypeNeedsCounts(config.graphSheet, block, needsList, typeList, counts);
}

// ============================================================
// メタデータ取得
// ============================================================

/**
 * グラフシートから業態リストと業種リストを動的取得する
 * @param {Array<Array<*>>} graphData
 * @returns {{ needsList: string[], typeList: string[] }}
 */
function _readTypeNeedsMeta(graphData) {
  // 業態: ヘッダー行の2列目以降、空セルまで取得
  const headerRow = graphData[TYPE_NEEDS_HEADER_ROW];
  const needsList = [];
  for (let i = 1; i < headerRow.length; i++) {
    if (headerRow[i] === '') break;
    needsList.push(String(headerRow[i]));
  }

  // 業種: A列の指定行範囲から空セルを除いて取得
  const typeList = graphData
    .slice(TYPE_NEEDS_TYPE_ROWS[0], TYPE_NEEDS_TYPE_ROWS[1])
    .map(row => String(row[0] ?? ''))
    .filter(v => v !== '');

  return { needsList, typeList };
}

// ============================================================
// カウンタ初期化
// ============================================================

/**
 * 業態×業種のカウンタを全キー0で初期化する
 * Bug 1修正: 計_${type} / ${needs}_計 / 計_計 を含む全キーを初期化
 *
 * @param {string[]} needsList
 * @param {string[]} typeList
 * @returns {Object<string, number>}
 */
function _initTypeNeedsCounts(needsList, typeList) {
  const counts     = {};
  const allNeeds   = [...needsList, TOTAL_SUFFIX];
  const allTypes   = [...typeList,  TOTAL_SUFFIX];

  for (const needs of allNeeds) {
    for (const type of allTypes) {
      counts[`${needs}_${type}`] = 0;
    }
  }
  return counts;
}

// ============================================================
// 区分解決ヘルパー
// ============================================================

/**
 * 行データから業態インデックスを解決する
 * TYPE_NEEDS_FLAG_COLS を順に確認し、最初に非空のフラグ列に対応する業態インデックスを返す
 *
 * @param {Array<*>} row
 * @returns {number} 業態インデックス（見つからない場合は -1）
 */
function _resolveNeedsIdx(row) {
  for (const { col, needsIdx } of TYPE_NEEDS_FLAG_COLS) {
    if (row[col] !== '') return needsIdx;
  }
  return -1;
}

// ============================================================
// シートからの集計
// ============================================================

/**
 * 一覧データから業態×業種のカウントを集計する
 * @param {Array<Array<*>>} dataSet
 * @param {string[]} needsList
 * @param {string[]} typeList
 * @param {Object<string, number>} counts
 */
function _countTypeNeedsFromSheet(dataSet, needsList, typeList, counts) {
  for (const row of dataSet) {
    const needsIdx = _resolveNeedsIdx(row);
    if (needsIdx === -1 || needsIdx >= needsList.length) continue;

    const needsKey = needsList[needsIdx];
    const typeKey  = _resolveOrUnknown(row[COL_TYPE_NEEDS_INDUSTRY], typeList);
    _incTypeNeeds(counts, needsKey, typeKey);
  }
}

// ============================================================
// Webhook差分適用
// ============================================================

/**
 * Webhookレコードの業態×業種差分をカウントに適用する
 * Bug 3修正: 業態・業種どちらが変わっても1対1差分を適用
 * Bug 4修正: 合計キー（${needs}_計 / 計_${type}）を _incTypeNeeds / _decTypeNeeds に集約
 *
 * @param {Object} config
 * @param {string[]} needsList
 * @param {string[]} typeList
 * @param {Object<string, number>} counts
 */
function _applyTypeNeedsDelta(config, needsList, typeList, counts) {
  const newNeedsKey = _resolveOrUnknown(config.record?.construction_status?.value, needsList);
  const newTypeKey  = _resolveOrUnknown(config.record?.hope_business_type?.value,  typeList);
  const hasExisting  = config.existingCustomerData?.length > 0;

  if (hasExisting) {
    const exc        = config.existingCustomerData;
    const excNeedsIdx = _resolveNeedsIdx(exc);
    const oldNeedsKey = excNeedsIdx !== -1 ? (needsList[excNeedsIdx] ?? null) : null;
    const oldTypeKey  = _resolveOrUnknown(exc[COL_TYPE_NEEDS_INDUSTRY], typeList);

    if (!oldNeedsKey) return;  // 旧業態が管理対象外なら差分スキップ

    if (oldNeedsKey !== newNeedsKey || oldTypeKey !== newTypeKey) {
      _decTypeNeeds(counts, oldNeedsKey, oldTypeKey);
      _incTypeNeeds(counts, newNeedsKey, newTypeKey);
    }
  } else {
    _incTypeNeeds(counts, newNeedsKey, newTypeKey);
  }
}

/**
 * 業態×業種カウントを加算する（合計キーを同時更新）
 * @param {Object<string, number>} counts
 * @param {string} needs
 * @param {string} type
 */
function _incTypeNeeds(counts, needs, type) {
  counts[`${needs}_${type}`]++;
  counts[`${needs}_${TOTAL_SUFFIX}`]++;
  counts[`${TOTAL_SUFFIX}_${type}`]++;
  counts[`${TOTAL_SUFFIX}_${TOTAL_SUFFIX}`]++;
}

/**
 * 業態×業種カウントを減算する（合計キーを同時更新）
 * @param {Object<string, number>} counts
 * @param {string} needs
 * @param {string} type
 */
function _decTypeNeeds(counts, needs, type) {
  counts[`${needs}_${type}`]--;
  counts[`${needs}_${TOTAL_SUFFIX}`]--;
  counts[`${TOTAL_SUFFIX}_${type}`]--;
  counts[`${TOTAL_SUFFIX}_${TOTAL_SUFFIX}`]--;
}

// ============================================================
// 書き込み
// ============================================================

/**
 * 業態×業種カウントをグラフシートへ書き込む
 * 業態ごとに1列ずつ、startCol から右方向に書き込む
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} graphSheet
 * @param {{ startRow: number, startCol: number }} block
 * @param {string[]} needsList
 * @param {string[]} typeList
 * @param {Object<string, number>} counts
 */
function _writeTypeNeedsCounts(graphSheet, block, needsList, typeList, counts) {
  const allNeeds = [...needsList, TOTAL_SUFFIX];
  const allTypes = [...typeList,  TOTAL_SUFFIX];

  allNeeds.forEach((needs, colOffset) => {
    const writeData = allTypes.map(type => [counts[`${needs}_${type}`] ?? 0]);
    graphSheet
      .getRange(block.startRow, block.startCol + colOffset, writeData.length, 1)
      .setValues(writeData);
  });

  AppLogger.debug('calcTypeNeeds: 書き込み完了', {
    startRow: block.startRow, startCol: block.startCol,
  });
}