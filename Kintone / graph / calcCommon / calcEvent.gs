// ============================================================
// graph/calcResidential.gs  （一般住宅向け）
// ============================================================

/**
 * 集客イベント別の反響・来場・契約数を集計し、グラフシートへ書き込む
 * @param {Object} config
 */
function calcEvent(config) {
  try {
    _calcEventBlock(config, EVENT_BLOCK_ALL);

    if (config.listData[1]?.length > 0) {
      _calcEventBlock(config, EVENT_BLOCK_CLOSED);
    }
  } catch (e) {
    handleError(e.stack, e.message, 'calcEvent',
      config.record.customer_name.value, config.record.customer_type.value);
  }
}

// ============================================================
// 定数
// ============================================================

/**
 * ブロック定義
 * metaRow:   グラフシートのイベント項目ヘッダー行番号（1始まり）
 * metaFrom:  イベント項目ヘッダー列（0始まり）スライス開始
 * metaTo:    イベント項目ヘッダー列（0始まり）スライス終了
 * indicatorRows: 反応指標ラベルの行範囲（0始まり）[from, to)
 * indicatorCol:  反応指標ラベルの列インデックス（0始まり）
 * startRow:  グラフシートへの書き込み開始行（1始まり）
 * startCol:  グラフシートへの書き込み開始列（1始まり）
 * dataIndex: config.listData の参照インデックス
 */
const EVENT_BLOCK_ALL = {
  metaRow: 154, metaFrom: 12, metaTo: 18,
  indicatorRows: [155, 160], indicatorCol: 11,
  startRow: 155, startCol: 13,
  dataIndex: 0,
};
const EVENT_BLOCK_CLOSED = {
  metaRow: 154, metaFrom: 12, metaTo: 18,
  indicatorRows: [155, 160], indicatorCol: 11,
  startRow: 155, startCol: 13,
  dataIndex: 1,
};

/** 集計ステータスキー（カウント対象） */
const EVENT_COUNT_KEYS  = ['反響', '来場', '契約'];

/** 率キー（計算値、書き込みには含まれるが初期化対象外） */
const EVENT_RATE_KEYS   = ['来場率', '歩留'];

/** 全書き込みキー（列順） */
const EVENT_STATUS_KEYS = [...EVENT_COUNT_KEYS, ...EVENT_RATE_KEYS];

/** 列インデックス（0始まり） */
const COL_EVENT_FIRST_APPOINT = CUSTOMER_LIST_COLS.FIRST_APPOINT - 1;
const COL_EVENT_MTG_DAY       = SALES_LIST_COLS.MTG_DAY_1        - 1;
const COL_EVENT_RANK          = SALES_LIST_COLS.RANK              - 1;

// ============================================================
// ブロック単位の集計・書き込み
// ============================================================

/**
 * 指定ブロックのイベント集計をしてグラフシートへ書き込む
 * @param {Object} config
 * @param {Object} block
 */
function _calcEventBlock(config, block) {
  const { eventItems } = _readEventMeta(config.graphData, block);
  const counts = _initEventCounts(eventItems);

  // Bug 3修正: block.dataIndex で参照データを切り替える
  _countEventFromSheet(config.listData[block.dataIndex], eventItems, counts);

  if (config.appId === config.salesAppId) {
    _applyEventDelta(config, eventItems, counts);
  }

  _calcEventRates(eventItems, counts);
  _writeEventCounts(config.graphSheet, block, eventItems, counts);
}

// ============================================================
// メタデータ取得
// ============================================================

/**
 * グラフシートからイベント項目リストを動的取得する
 * @param {Array<Array<*>>} graphData
 * @param {Object} block
 * @returns {{ eventItems: string[] }}
 */
function _readEventMeta(graphData, block) {
  const eventItems = graphData[block.metaRow]
    .slice(block.metaFrom, block.metaTo)
    .map(v => String(v ?? ''))
    .filter(v => v !== '');

  AppLogger.debug('_readEventMeta', { eventItems });
  return { eventItems };
}

// ============================================================
// カウンタ初期化
// ============================================================

/**
 * イベント×ステータスのカウンタを全キー0で初期化する
 * Bug 2修正: 計_${key} / 計_来場率 / 計_歩留 を含む全カウントキーを初期化
 * 率キー（来場率・歩留）は _calcEventRates で上書きするため0で予約
 *
 * @param {string[]} eventItems
 * @returns {Object<string, number>}
 */
function _initEventCounts(eventItems) {
  const counts = {};
  const allItems = [...eventItems, '計'];

  for (const item of allItems) {
    for (const key of EVENT_STATUS_KEYS) {
      counts[`${item}_${key}`] = 0;
    }
  }
  return counts;
}

// ============================================================
// シートからの集計
// ============================================================

/**
 * 一覧データからイベント別反響・来場・契約を集計する
 * Bug 3修正: dataSet を引数で受け取り、固定 listData[0] 参照を排除
 *
 * @param {Array<Array<*>>} dataSet
 * @param {string[]} eventItems
 * @param {Object<string, number>} counts
 */
function _countEventFromSheet(dataSet, eventItems, counts) {
  for (const row of dataSet) {
    const eventKey = String(row[COL_EVENT_FIRST_APPOINT] ?? '');
    if (!eventItems.includes(eventKey)) continue;

    _incEvent(counts, eventKey, '反響');
    if (row[COL_EVENT_MTG_DAY] !== '') _incEvent(counts, eventKey, '来場');
    if (row[COL_EVENT_RANK]    === 'A') _incEvent(counts, eventKey, '契約');
  }
}

// ============================================================
// Webhook差分適用
// ============================================================

/**
 * Webhookレコードのイベント差分をカウントに適用する
 * Bug 1修正: formatMeetingData / formatRank → parseMeetingData / transformRank
 * Bug 5修正: 反響の移動（旧イベント→新イベント）も差分対象に追加
 *
 * @param {Object} config
 * @param {string[]} eventItems
 * @param {Object<string, number>} counts
 */
function _applyEventDelta(config, eventItems, counts) {
  // Bug 1修正: parseMeetingData / transformRank に統一
  const mtgDays    = parseMeetingData(config.record?.deal_history?.value)?.mtgDays ?? [];
  const rank       = transformRank(config.record?.likehood_now?.value) ?? '';
  const newEvent   = String(config.record?.first_appoint?.value ?? '');
  const hasExisting = config.existingCustomerData?.length > 0;

  if (hasExisting) {
    const exc      = config.existingCustomerData;
    const oldEvent = String(exc[COL_EVENT_FIRST_APPOINT] ?? '');
    const oldVisit = exc[COL_EVENT_MTG_DAY] !== '';
    const oldRank  = exc[COL_EVENT_RANK];
    const newVisit = mtgDays[0] !== '';
    const newRank  = rank === 'A';

    if (oldEvent !== newEvent) {
      // Bug 5修正: 反響の移動を差分適用
      if (eventItems.includes(oldEvent)) _decEvent(counts, oldEvent, '反響');
      if (eventItems.includes(newEvent)) _incEvent(counts, newEvent, '反響');

      // 来場の移動
      if (oldVisit) _decEvent(counts, oldEvent, '来場');
      if (newVisit) _incEvent(counts, newEvent, '来場');

      // 契約の移動
      if (oldRank === 'A') _decEvent(counts, oldEvent, '契約');
      if (newRank)         _incEvent(counts, newEvent, '契約');
    } else {
      // 同イベント内での来場・契約の変化のみ反映
      if (!oldVisit && newVisit) _incEvent(counts, newEvent, '来場');
      if (oldVisit  && !newVisit) _decEvent(counts, newEvent, '来場');
      if (oldRank !== 'A' && newRank) _incEvent(counts, newEvent, '契約');
      if (oldRank === 'A' && !newRank) _decEvent(counts, newEvent, '契約');
    }
  } else {
    if (eventItems.includes(newEvent)) {
      _incEvent(counts, newEvent, '反響');
      if (mtgDays[0] !== '') _incEvent(counts, newEvent, '来場');
      if (rank === 'A')      _incEvent(counts, newEvent, '契約');
    }
  }
}

/**
 * イベント×ステータスカウントを加算する（計行を同時更新）
 * @param {Object<string, number>} counts
 * @param {string} eventKey
 * @param {string} statusKey
 */
function _incEvent(counts, eventKey, statusKey) {
  counts[`${eventKey}_${statusKey}`]++;
  counts[`計_${statusKey}`]++;
}

/**
 * イベント×ステータスカウントを減算する（計行を同時更新）
 * @param {Object<string, number>} counts
 * @param {string} eventKey
 * @param {string} statusKey
 */
function _decEvent(counts, eventKey, statusKey) {
  counts[`${eventKey}_${statusKey}`]--;
  counts[`計_${statusKey}`]--;
}

// ============================================================
// 率の計算
// ============================================================

/**
 * イベントごとの来場率・歩留率を計算する
 * Bug 4修正: 率キーを EVENT_RATE_KEYS で統一し、_initEventCounts との整合性を確保
 *
 * @param {string[]} eventItems
 * @param {Object<string, number>} counts
 */
function _calcEventRates(eventItems, counts) {
  for (const item of [...eventItems, '計']) {
    counts[`${item}_来場率`] = _safeRatio(counts[`${item}_来場`], counts[`${item}_反響`]);
    counts[`${item}_歩留`]  = _safeRatio(counts[`${item}_契約`], counts[`${item}_来場`]);
  }
}

// ============================================================
// 書き込み
// ============================================================

/**
 * イベントカウントをグラフシートへ書き込む
 * イベント項目（計含む）ごとに1列ずつ、startCol から右方向に書き込む
 * Bug 6修正: startCol を block.startCol から取得し、引数固定値を排除
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} graphSheet
 * @param {{ startRow: number, startCol: number }} block
 * @param {string[]} eventItems
 * @param {Object<string, number>} counts
 */
function _writeEventCounts(graphSheet, block, eventItems, counts) {
  [...eventItems, '計'].forEach((item, colOffset) => {
    const writeData = EVENT_STATUS_KEYS.map(key => [counts[`${item}_${key}`] ?? 0]);
    graphSheet
      .getRange(block.startRow, block.startCol + colOffset, writeData.length, 1)
      .setValues(writeData);
  });

  AppLogger.debug('calcEvent: 書き込み完了', {
    startRow: block.startRow, startCol: block.startCol,
  });
}