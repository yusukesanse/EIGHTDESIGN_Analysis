// ============================================================
// graph/calcCommon.gs
// ============================================================

/**
 * スタッフ別スコア（反響・来場・再来・3回目以上・成約・各率）を集計し、グラフシートへ書き込む
 * グラフシート107行目のスタッフ名一覧を参照するため、スタッフ追加時もコード変更不要
 * @param {Object} config
 */
function calcStaff(config) {
  try {
    // ── 1. グラフシートからスタッフ名・指標ラベルを動的取得 ──
    const { staffNames, sideLabels, startRow } = _readStaffMeta(config.graphData);

    // ── 2. カウンタ初期化 ─────────────────────────────────
    const counts = _initStaffCounts(staffNames, sideLabels);

    // ── 3. 一覧シートから集計 ─────────────────────────────
    _countStaffFromSheet(config.listData[0], staffNames, counts);

    // ── 4. Webhookレコードの差分適用 ──────────────────────
    _applyStaffDelta(config, staffNames, counts);

    // ── 5. 率の計算 ───────────────────────────────────────
    _calcStaffRatios(staffNames, counts);

    // ── 6. グラフシートへ書き込み ─────────────────────────
    _writeStaffCounts(config.graphSheet, staffNames, sideLabels, startRow, counts);

  } catch (e) {
    handleError(e.stack, e.message, 'calcStaff',
      config.record.customer_name.value, config.record.customer_type.value);
  }
}

// ============================================================
// 定数
// ============================================================

/** グラフシート上のスタッフ名ヘッダー行番号（1始まり） */
const STAFF_HEADER_ROW = 107;

/** 指標ラベルの行数（108〜115行目 = 8行） */
const STAFF_LABEL_ROW_COUNT = 8;

/**
 * 指標キー定義（カウント対象）
 * @type {string[]}
 */
const STAFF_COUNT_KEYS = ['反響数', '来場数', '再来数', '3回目以上', '成約'];

/**
 * 指標キー定義（率・計算対象）
 * @type {string[]}
 */
const STAFF_RATIO_KEYS = ['反響来場率', '再アポ率', '歩留'];

// ============================================================
// メタデータ取得
// ============================================================

/**
 * グラフシートからスタッフ名・指標ラベル・書き込み開始行を動的に取得する
 * スタッフ名は107行目の2列目以降、空セルが来るまで取得
 * 指標ラベルは108行目以降A列から STAFF_LABEL_ROW_COUNT 行分取得
 *
 * @param {Array<Array<*>>} graphData
 * @returns {{ staffNames: string[], sideLabels: string[], startRow: number }}
 */
function _readStaffMeta(graphData) {
  const headerRow  = graphData[STAFF_HEADER_ROW];
  const staffNames = [];

  for (let i = 1; i < headerRow.length; i++) {
    if (headerRow[i] === '') break;
    staffNames.push(String(headerRow[i]));
  }

  const startRow  = STAFF_HEADER_ROW + 1;  // 108行目
  const sideLabels = graphData
    .slice(startRow - 1, startRow - 1 + STAFF_LABEL_ROW_COUNT)
    .map(row => String(row[0]));

  return { staffNames, sideLabels, startRow };
}

// ============================================================
// カウンタ初期化
// ============================================================

/**
 * スタッフ別・指標別のカウンタを初期化する
 * 「計」列も含めて全キーを0で初期化することで、||0 による隠れバグを防ぐ
 *
 * @param {string[]} staffNames
 * @param {string[]} sideLabels
 * @returns {Object<string, number>}
 */
function _initStaffCounts(staffNames, sideLabels) {
  const counts  = {};
  const targets = [...staffNames, '計'];

  for (const label of sideLabels) {
    for (const staff of targets) {
      counts[`${label}_${staff}`] = 0;
    }
  }
  return counts;
}

// ============================================================
// シートからの集計
// ============================================================

/**
 * 一覧シートの行データからスタッフ別カウントを集計する
 * @param {Array<Array<*>>} yearData
 * @param {string[]} staffNames
 * @param {Object<string, number>} counts
 */
function _countStaffFromSheet(yearData, staffNames, counts) {
  for (const row of yearData) {
    const staff = row[SALES_LIST_COLS.MANAGER - 1];
    if (!staffNames.includes(staff)) continue;
    _incStaffRow(counts, staff, row);
  }
}

/**
 * 1行分のデータでスタッフのカウントを加算する
 * @param {Object<string, number>} counts
 * @param {string} staff
 * @param {Array<*>} row
 */
function _incStaffRow(counts, staff, row) {
  _incStaffKey(counts, staff, '反響数');
  if (row[SALES_LIST_COLS.MTG_DAY_1 - 1] !== '') _incStaffKey(counts, staff, '来場数');
  if (row[SALES_LIST_COLS.MTG_DAY_2 - 1] !== '') _incStaffKey(counts, staff, '再来数');
  if (row[SALES_LIST_COLS.MTG_DAY_3 - 1] !== '') _incStaffKey(counts, staff, '3回目以上');
  if (row[SALES_LIST_COLS.RANK      - 1] === 'A') _incStaffKey(counts, staff, '成約');
}

/**
 * 指定スタッフの指標キーと「計」を同時に加算する
 * @param {Object<string, number>} counts
 * @param {string} staff
 * @param {string} key
 */
function _incStaffKey(counts, staff, key) {
  counts[`${key}_${staff}`]++;
  counts[`${key}_計`]++;
}

// ============================================================
// Webhook差分適用
// ============================================================

/**
 * Webhookレコードの差分をスタッフカウントに適用する
 * @param {Object} config
 * @param {string[]} staffNames
 * @param {Object<string, number>} counts
 */
function _applyStaffDelta(config, staffNames, counts) {
  const { appId, customerAppId, salesAppId, record, existingCustomerData } = config;
  const staff     = record?.manager?.value?.[0]?.name ?? null;
  const hasExist  = existingCustomerData && existingCustomerData.length > 0;

  // スタッフが管理対象外なら差分適用をスキップ
  if (!staff || !staffNames.includes(staff)) {
    AppLogger.warn('calcStaff: スタッフが管理対象外です', { staff });
    return;
  }

  if (appId === customerAppId) {
    // 顧客情報アプリ: 新規顧客のみ反響数を加算
    if (!hasExist) _incStaffKey(counts, staff, '反響数');
    return;
  }

  if (appId === salesAppId) {
    const mtgDays   = parseMeetingData(record?.deal_history?.value).mtgDays;
    const newRank   = transformRank(record?.likehood_now?.value);

    if (hasExist) {
      _applyExistingStaffDelta(counts, staff, mtgDays, newRank, existingCustomerData);
    } else {
      _applyNewStaffDelta(counts, staff, mtgDays, newRank);
    }
  }
}

/**
 * 既存顧客のスタッフ差分を適用する（新たに追加された項目のみ加算）
 * @param {Object<string, number>} counts
 * @param {string} staff
 * @param {string[]} mtgDays
 * @param {string} newRank
 * @param {Array<*>} existingRow
 */
function _applyExistingStaffDelta(counts, staff, mtgDays, newRank, existingRow) {
  const prev = _extractExistingProgress(existingRow);
  if (!prev.vis   && mtgDays[0] !== '') _incStaffKey(counts, staff, '来場数');
  if (!prev.reVis && mtgDays[1] !== '') _incStaffKey(counts, staff, '再来数');
  if (!prev.over  && mtgDays[2] !== '') _incStaffKey(counts, staff, '3回目以上');
  if (prev.rank !== 'A' && newRank === 'A') _incStaffKey(counts, staff, '成約');
}

/**
 * 新規顧客のスタッフ差分を適用する（全項目を加算）
 * @param {Object<string, number>} counts
 * @param {string} staff
 * @param {string[]} mtgDays
 * @param {string} newRank
 */
function _applyNewStaffDelta(counts, staff, mtgDays, newRank) {
  _incStaffKey(counts, staff, '反響数');
  if (mtgDays[0] !== '') _incStaffKey(counts, staff, '来場数');
  if (mtgDays[1] !== '') _incStaffKey(counts, staff, '再来数');
  if (mtgDays[2] !== '') _incStaffKey(counts, staff, '3回目以上');
  if (newRank === 'A')   _incStaffKey(counts, staff, '成約');
}

// ============================================================
// 率の計算
// ============================================================

/**
 * スタッフ別の各率（反響来場率・再アポ率・歩留）を計算してcountsに格納する
 * @param {string[]} staffNames
 * @param {Object<string, number>} counts
 */
function _calcStaffRatios(staffNames, counts) {
  for (const staff of [...staffNames, '計']) {
    const res   = counts[`反響数_${staff}`];
    const vis   = counts[`来場数_${staff}`];
    const reVis = counts[`再来数_${staff}`];
    const close = counts[`成約_${staff}`];

    counts[`反響来場率_${staff}`] = _safeRatio(vis,   res);
    counts[`再アポ率_${staff}`]   = _safeRatio(reVis, vis);
    counts[`歩留_${staff}`]       = _safeRatio(close, vis);
  }
}

// ============================================================
// 書き込み
// ============================================================

/**
 * スタッフ別集計データをグラフシートへ書き込む
 * スタッフごとに1列ずつ書き込む（2列目からスタッフ順に配置）
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} graphSheet
 * @param {string[]} staffNames
 * @param {string[]} sideLabels
 * @param {number} startRow - 書き込み開始行（1始まり）
 * @param {Object<string, number>} counts
 */
function _writeStaffCounts(graphSheet, staffNames, sideLabels, startRow, counts) {
  staffNames.forEach((staff, idx) => {
    const col       = idx + 2;  // 2列目からスタッフ順に配置
    const writeData = sideLabels.map(label => [counts[`${label}_${staff}`] ?? 0]);
    graphSheet.getRange(startRow, col, writeData.length, 1).setValues(writeData);
  });

  AppLogger.debug('calcStaff: 書き込み完了', { staffCount: staffNames.length, startRow });
}