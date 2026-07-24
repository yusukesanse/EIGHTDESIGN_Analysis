// ============================================================
// aggregation.gs — ドメインシート集計（全面再計算方式）
// ------------------------------------------------------------
// 一覧シート（例: 名古屋-一般住宅）を読み直し、対象年度のデータのみを
// 集計してドメインシート（例: 【一般住宅】名古屋）へ値で書き込む。
//
// 方針（2026-07-24 決定）:
//   - スプレッドシート数式による集計は廃止し、GAS で全面再計算する
//   - 差分加算はしない（Webhook とは独立に、毎回一覧シートから数え直す）
//   - 書き込むのは「対象年度」に関わるセルのみ。過去年の静的値には触れない
//   - 対象年度はドメインシートの B1（「2026年」形式）を優先し、
//     無ければ現在日付から集計年度ルール（21日繰り上げ）で算出する
//
// エントリポイント:
//   - runDomainAggregation()            … 18シート全部を再計算（手動実行/トリガー共用）
//   - runDomainAggregationForSheet(type, area) … 1シートのみ再計算（デバッグ用）
//   - createAggregationDailyTrigger()   … 毎日7時の定期実行トリガーを作成
//   - createAggregationHourlyTrigger()  … 毎時の定期実行トリガーを作成
//   - deleteAggregationTriggers()       … 本集計のトリガーを全削除
// ============================================================

// ============================================================
// 対象ドメイン定義
// ============================================================

/** 集計対象エリア */
const AGG_AREAS = [AREAS.NAGOYA, AREAS.TOKYO];

/**
 * 集計対象ドメインとレイアウト種別
 * style: 'residential'（一般住宅・新築） / 'business'（法人系）
 */
const AGG_DOMAINS = [
  { type: CUSTOMER_TYPES.RESIDENTIAL, style: 'residential' },
  { type: CUSTOMER_TYPES.NEW_BUILD,   style: 'residential' },
  { type: CUSTOMER_TYPES.SMALL_STORE, style: 'business' },
  { type: CUSTOMER_TYPES.OFFICE,      style: 'business' },
  { type: CUSTOMER_TYPES.TRAILER,     style: 'business' },
  { type: CUSTOMER_TYPES.MEDICAL,     style: 'business' },
  { type: CUSTOMER_TYPES.FACTORY,     style: 'business' },
  { type: CUSTOMER_TYPES.RENTAL,      style: 'business' },
  { type: CUSTOMER_TYPES.MISEIE,      style: 'business' },
];

/**
 * ドメインシート名を組み立てる
 * @param {string} domainType 顧客種別（例: '一般住宅'）
 * @param {string} area エリア（例: '名古屋'）
 * @returns {string} 例: '【一般住宅】名古屋'
 */
function buildDomainSheetName(domainType, area) {
  return `【${domainType}】${area}`;
}

// ============================================================
// ドメインシートの行アンカー定義
// （全18シートで共通の骨格。xlsx実物とold graphコードで検証済み）
// ============================================================

/** 両レイアウト共通ブロック */
const AGG_ROWS = {
  FUNNEL_HEADER:  34,   // 年ヘッダー行（B34〜に「2019年」…）
  FUNNEL_START:   35,   // 反響者/来場者/再来者/3回目以上/成約/各率 = 10行
  MONTHLY_HEADER: 69,   // 年ヘッダー行
  MONTHLY_START:  70,   // 1月〜12月＋計 = 13行
  STAFF_HEADER:  107,   // 担当者名ヘッダー行（B107〜。'その他'=受け皿、'計'/'合計'=合計列）
  STAFF_START:   108,   // 反響数/来場数/再来数/3回目以上/成約/反響来場率/再アポ率/歩留 = 8行
  MEDIA_ALL_HEADER:    229,  // 反響者×反響媒体 年ヘッダー行（ラベルはA230〜'合計'）
  MEDIA_CLOSED_HEADER: 285,  // 成約者×反響媒体
  AREA_ALL_HEADER:     341,  // 反響者×エリア（ラベルはA342〜'合計'）
  AREA_CLOSED_HEADER:  471,  // 成約者×エリア
};

/** 住宅系（一般住宅・新築）専用ブロック */
const AGG_RESIDENTIAL_ROWS = {
  INCOME_AGE_START:    121,  // 年収×年齢: 年収9区分＋計 = 10行、反響者=B〜J / 契約者=M〜U
  AGE_FAMILY_START:    139,  // 家族数×年齢: 家族数7区分＋計 = 8行
  ATTR_INDUSTRY_START: 152,  // 属性×業界: 業界20区分＋計 = 21行
  NEEDS_BLOCKS: [            // 問い合わせニーズ（反響/来場/契約/来場率/歩留 = 5行、B〜G列）
    { filterCol: 32, startRow: 178 },  // 一次取得
    { filterCol: 33, startRow: 186 },  // 持家
    { filterCol: 34, startRow: 194 },  // 実家など
  ],
  CONSIDERATION_ROW:   178,  // 検討レベル総数（M〜T列: 成約/大/中/小/未/長期追客/無/合計）
  LEAVING_HEADER:      182,  // 離脱理由ヘッダー行（L=ラベル、M=理由総数、N〜=担当者）
  LEAVING_START:       183,  // 理由行（L列ラベル）〜'合計'行
  YEAR_LABEL_CELLS: [        // 「20XX年」表記なら対象年度に更新する候補セル
    'A107', 'A119', 'L119', 'A120', 'L120', 'A137', 'L137', 'A138',
    'A151', 'L151', 'A175', 'A176', 'A177', 'A193', 'L177', 'L181', 'L182',
  ],
};

/** 法人系専用ブロック */
const AGG_BUSINESS_ROWS = {
  INDUSTRY_SCALE_HEADER: 120,  // 業種×企業規模: 企業規模ヘッダー（B〜）、業種はA121〜'計'手前
  JOB_TITLE_HEADER:      144,  // 肩書×企業規模: 同構造（肩書はA145〜）
  TYPE_NEEDS_HEADER:     154,  // 業態×業種(反響者): B=独立/C=既存店舗/D=新店舗/E=合計
  TYPE_NEEDS_CLOSED_HEADER: 176,  // 業態×業種(契約者)
  EVENT_HEADER:          154,  // 集客イベント: L154〜ヘッダー、L155〜=反響/来場/契約/来場率/歩留
  YEAR_LABEL_CELLS: [
    'A107', 'A120', 'L120', 'A144', 'L144', 'A154', 'A176',
  ],
};

// ============================================================
// 区分定義（クロス集計）
// ============================================================

/** 年齢区分（min 超 max 以下）。列順はシートのヘッダー順（〜24歳/25〜30/…/60歳〜/不明） */
const AGG_AGE_SECTIONS = [
  { min: 0,  max: 24 },
  { min: 24, max: 30 },
  { min: 30, max: 36 },
  { min: 36, max: 43 },
  { min: 43, max: 48 },
  { min: 48, max: 59 },
  { min: 59, max: Infinity },
];

/** 年収区分（円、0 超 max 以下）。行順はシートのラベル順（〜400万円/…/1000万〜/不明） */
const AGG_INCOME_SECTIONS = [
  { max: 4000000 },
  { max: 5000000 },
  { max: 6000000 },
  { max: 7000000 },
  { max: 8000000 },
  { max: 9000000 },
  { max: 10000000 },
  { max: Infinity },
];

/** 家族数区分数（1人〜6人。範囲外は不明） */
const AGG_FAMILY_MAX = 6;

/**
 * 職業 → 属性列インデックス（0始まり）
 * シート列順: 会社員 / 会社員(上場) / 経営者・役員 / 公務員・士業 / 自営業・自由業 / 教員 / 医師 / 不明
 */
const AGG_OCCUPATION_TO_ATTR = {
  '会社員':                             0,
  '会社員（上場企業）':                 1,
  '会社経営者':                         2,
  '会社役員':                           2,
  '公務員':                             3,
  '士業（弁護士・行政書士・税理士など）': 3,
  '自営業':                             4,
  '自由業':                             4,
  '教員':                               5,
  '医師（開業医）':                     6,
  '医師（勤務医）':                     6,
};

/** 属性の列数（不明を含む。計は含まない） */
const AGG_ATTR_COUNT = 8;

/**
 * 業界名 → 行インデックス（0始まり）。シートの行ラベル順
 */
const AGG_INDUSTRY_TO_IDX = {
  '製造': 0,  'クリエイター': 1, 'IT': 2,      'サービス': 3,  'アパレル': 4,
  '医療福祉': 5, '飲食': 6,       '運輸': 7,    '教育': 8,     '金融': 9,
  '建設': 10, '公官庁': 11,     '小売': 12,   '士業': 13,    '出版・広告': 14,
  '造船': 15, '通信': 16,       '美容': 17,   '不動産': 18,
};

/** 業界の行数（不明を含む。計は含まない） */
const AGG_INDUSTRY_COUNT = 20;

/**
 * 見込度/商談状況 → 検討レベル列インデックス（0始まり）
 * シート列順（M〜S）: 成約 / 大 / 中 / 小 / 未 / 長期追客 / 無
 */
const AGG_CONSIDERATION_MAP = {
  '成約': 0, 'A': 0,
  '大': 1, '見込み大': 1, 'B-A': 1,
  '中': 2, '見込み中': 2, 'B-B': 2,
  '小': 3, '見込み小': 3, 'B-C': 3,
  '未': 4, 'B-D': 4, '不明': 4, '追客中': 4,
  '長期追客': 5, 'C': 5,
  '無': 6, '見込み無': 6, 'D': 6, '追客終了': 6,
};

/** 検討レベルの列数（合計は含まない） */
const AGG_CONSIDERATION_COUNT = 7;

/** 合計ラベルとして扱う文字列 */
const AGG_TOTAL_LABELS = ['計', '合計'];

/** その他（受け皿）ラベル */
const AGG_OTHER_LABEL = 'その他';

/** 対象年度セルの書式（例: 2026年） */
const AGG_YEAR_PATTERN = /^20\d{2}年$/;

// ============================================================
// エントリポイント
// ============================================================

/**
 * 全ドメインシート（9ドメイン×2エリア）を再計算する
 * 手動実行・定期トリガーの両方から呼ばれる
 */
function runDomainAggregation() {
  const ss = getSpreadsheet();
  const failures = [];

  for (const area of AGG_AREAS) {
    for (const domain of AGG_DOMAINS) {
      try {
        _aggregateOneSheet(ss, domain, area);
      } catch (e) {
        failures.push(`${buildDomainSheetName(domain.type, area)}: ${e.message}`);
        AppLogger.error('runDomainAggregation: シート集計でエラー', e, {
          functionName: 'runDomainAggregation',
          customerType: domain.type,
        });
      }
    }
  }

  if (failures.length > 0) {
    AppLogger.error('runDomainAggregation: 一部シートの集計に失敗', null, { failures: failures.join(' / ') });
  } else {
    AppLogger.info('runDomainAggregation: 全シート集計完了');
  }
}

/**
 * 1ドメインシートのみ再計算する（デバッグ・個別実行用）
 * @param {string} domainType 顧客種別（例: '一般住宅'）
 * @param {string} area エリア（'名古屋' or '東京'）
 */
function runDomainAggregationForSheet(domainType, area) {
  const domain = AGG_DOMAINS.find((d) => d.type === domainType);
  if (!domain) throw new Error(`未対応のドメインです: ${domainType}`);
  _aggregateOneSheet(getSpreadsheet(), domain, area);
}

// ============================================================
// トリガー管理
// ============================================================

/** 定期実行トリガーが呼ぶ関数名 */
const AGG_TRIGGER_HANDLER = 'runDomainAggregation';

/** 毎日7時の定期実行トリガーを作成する（既存の同種トリガーは事前に削除） */
function createAggregationDailyTrigger() {
  deleteAggregationTriggers();
  ScriptApp.newTrigger(AGG_TRIGGER_HANDLER).timeBased().everyDays(1).atHour(7).create();
  AppLogger.info('createAggregationDailyTrigger: 作成完了', {});
}

/** 毎時の定期実行トリガーを作成する（既存の同種トリガーは事前に削除） */
function createAggregationHourlyTrigger() {
  deleteAggregationTriggers();
  ScriptApp.newTrigger(AGG_TRIGGER_HANDLER).timeBased().everyHours(1).create();
  AppLogger.info('createAggregationHourlyTrigger: 作成完了', {});
}

/** 本集計の定期実行トリガーを全削除する */
function deleteAggregationTriggers() {
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === AGG_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}

// ============================================================
// シート単位の集計フロー
// ============================================================

/**
 * 1シート分の集計を実行する
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {{ type: string, style: string }} domain
 * @param {string} area
 */
function _aggregateOneSheet(ss, domain, area) {
  const listSheetName   = buildListSheetName(area, domain.type);
  const domainSheetName = buildDomainSheetName(domain.type, area);

  const listSheet   = ss.getSheetByName(listSheetName);
  const domainSheet = ss.getSheetByName(domainSheetName);
  if (!listSheet || !domainSheet) {
    AppLogger.warn('_aggregateOneSheet: シートが見つからないためスキップ', {
      listSheetName, domainSheetName, listFound: !!listSheet, domainFound: !!domainSheet,
    });
    return;
  }

  const grid       = domainSheet.getDataRange().getValues();
  const listData   = listSheet.getDataRange().getValues();
  const targetYear = resolveAggregationYear(grid);

  const writes = buildAggregationWrites(grid, listData, targetYear, domain.style);
  _applyAggregationWrites(domainSheet, writes);

  AppLogger.info('_aggregateOneSheet: 集計完了', {
    sheet: domainSheetName, targetYear, blocks: writes.length,
  });
}

/**
 * 書き込み指示の配列をシートへ適用する
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Array<{ row: number, col: number, values: Array<Array<*>> }>} writes
 */
function _applyAggregationWrites(sheet, writes) {
  for (const w of writes) {
    sheet.getRange(w.row, w.col, w.values.length, w.values[0].length).setValues(w.values);
  }
}

// ============================================================
// 対象年度の決定
// ============================================================

/**
 * 対象年度を決定する
 * ドメインシート B1 が「20XX年」形式ならそれを使い、無ければ現在日付から
 * 集計年度ルール（12/21以降は翌年）で算出する
 *
 * @param {Array<Array<*>>} grid ドメインシートの全データ（0始まり）
 * @param {Date} [now] テスト用の現在日時
 * @returns {string} 例: '2026年'
 */
function resolveAggregationYear(grid, now) {
  const b1 = String(grid?.[0]?.[1] ?? '').trim();
  if (AGG_YEAR_PATTERN.test(b1)) return b1;
  return computeCurrentAggregationYear(now);
}

/**
 * 現在日付から集計年度を算出する（反響日の年度ルールと同一）
 * @param {Date} [now]
 * @returns {string} 例: '2026年'
 */
function computeCurrentAggregationYear(now) {
  const d = now ?? new Date();
  const dateText = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
  return transformInquiryDate(dateText).year;
}

// ============================================================
// 集計本体（純粋関数: grid + listData → 書き込み指示）
// ============================================================

/**
 * 1シート分の書き込み指示を組み立てる
 * @param {Array<Array<*>>} grid ドメインシートの全データ（0始まり）
 * @param {Array<Array<*>>} listData 一覧シートの全データ（0始まり、ヘッダー行含む）
 * @param {string} targetYear 対象年度（例: '2026年'）
 * @param {string} style 'residential' | 'business'
 * @returns {Array<{ row: number, col: number, values: Array<Array<*>> }>}
 */
function buildAggregationWrites(grid, listData, targetYear, style) {
  const yearData = listData.filter(
    (row) => String(row[SALES_LIST_COLS.YEAR - 1]) === targetYear
  );
  const closedData = yearData.filter(
    (row) => String(row[SALES_LIST_COLS.RANK - 1]) === 'A'
  );

  const writes = [];
  const push = (w) => { if (w) writes.push(...(Array.isArray(w) ? w : [w])); };

  // ── 共通ブロック ──────────────────────────────────────────
  push(_buildFunnelWrite(grid, yearData, targetYear));
  push(_buildMonthlyWrite(grid, yearData, targetYear));
  push(_buildStaffWrites(grid, yearData));
  push(_buildLabeledYearColumnWrite(grid, yearData, targetYear, AGG_ROWS.MEDIA_ALL_HEADER, _mediaKeyResolver));
  push(_buildLabeledYearColumnWrite(grid, closedData, targetYear, AGG_ROWS.MEDIA_CLOSED_HEADER, _mediaKeyResolver));
  push(_buildLabeledYearColumnWrite(grid, yearData, targetYear, AGG_ROWS.AREA_ALL_HEADER, _areaKeyResolver));
  push(_buildLabeledYearColumnWrite(grid, closedData, targetYear, AGG_ROWS.AREA_CLOSED_HEADER, _areaKeyResolver));

  // ── レイアウト別ブロック ──────────────────────────────────
  if (style === 'residential') {
    push(_buildIncomeAgeWrites(yearData, closedData));
    push(_buildAgeFamilyWrites(yearData, closedData));
    push(_buildAttrIndustryWrites(yearData, closedData));
    push(_buildNeedsWrites(yearData));
    push(_buildConsiderationWrite(yearData));
    push(_buildLeavingWrite(grid, yearData));
    push(_buildYearLabelWrites(grid, targetYear, AGG_RESIDENTIAL_ROWS.YEAR_LABEL_CELLS));
  } else {
    push(_buildCrossMatrixWrites(grid, yearData, closedData, AGG_BUSINESS_ROWS.INDUSTRY_SCALE_HEADER,
      (row) => _cellText(row[SALES_LIST_COLS.INDUSTRY - 1]),
      (row) => _cellText(row[SALES_LIST_COLS.WORK_PLACE - 1])));
    push(_buildCrossMatrixWrites(grid, yearData, closedData, AGG_BUSINESS_ROWS.JOB_TITLE_HEADER,
      (row) => _cellText(row[BUSINESS_EXTRA_COLS.JOB_TITLE - 1]),
      (row) => _cellText(row[BUSINESS_EXTRA_COLS.CAPITAL_STOCK - 1])));
    push(_buildTypeNeedsWrite(grid, yearData, AGG_BUSINESS_ROWS.TYPE_NEEDS_HEADER));
    push(_buildTypeNeedsWrite(grid, closedData, AGG_BUSINESS_ROWS.TYPE_NEEDS_CLOSED_HEADER));
    push(_buildEventWrite(grid, yearData));
    push(_buildYearLabelWrites(grid, targetYear, AGG_BUSINESS_ROWS.YEAR_LABEL_CELLS));
  }

  return writes;
}

// ============================================================
// 共通ヘルパー
// ============================================================

/**
 * セル値を文字列化する（null/undefined は空文字）
 * @param {*} v
 * @returns {string}
 */
function _cellText(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

/**
 * セルが空でないか
 * @param {*} v
 * @returns {boolean}
 */
function _hasValue(v) {
  return v !== null && v !== undefined && String(v) !== '';
}

/**
 * ゼロ除算を避けて割合を返す（分母0なら0）
 * @param {number} numerator
 * @param {number} denominator
 * @returns {number}
 */
function _aggRatio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * ヘッダー行から対象年度の列インデックス（0始まり）を探す
 * @param {Array<Array<*>>} grid
 * @param {number} headerRow ヘッダー行番号（1始まり）
 * @param {string} targetYear
 * @returns {number} 見つからなければ -1
 */
function _findYearColumn(grid, headerRow, targetYear) {
  const row = grid[headerRow - 1] ?? [];
  return row.findIndex((v) => _cellText(v) === targetYear);
}

/**
 * ラベル列を上から走査し、合計ラベルの手前までのラベル一覧を返す
 * @param {Array<Array<*>>} grid
 * @param {number} startRow 走査開始行（1始まり）
 * @param {number} colIndex ラベル列（0始まり）
 * @param {number} maxRows 走査上限行数
 * @returns {{ labels: string[], hasTotal: boolean }} hasTotal=ラベル直後に合計行があるか
 */
function _scanLabels(grid, startRow, colIndex, maxRows) {
  const labels = [];
  for (let i = 0; i < maxRows; i++) {
    const label = _cellText(grid[startRow - 1 + i]?.[colIndex]);
    if (AGG_TOTAL_LABELS.includes(label)) return { labels, hasTotal: true };
    if (label === '') break;
    labels.push(label);
  }
  return { labels, hasTotal: false };
}

/**
 * ヘッダー行を右へ走査し、合計ラベルの手前までのラベル一覧を返す
 * @param {Array<Array<*>>} grid
 * @param {number} headerRow ヘッダー行番号（1始まり）
 * @param {number} startColIndex 走査開始列（0始まり）
 * @returns {{ labels: string[], hasTotal: boolean }}
 */
function _scanHeaderLabels(grid, headerRow, startColIndex) {
  const row = grid[headerRow - 1] ?? [];
  const labels = [];
  for (let i = startColIndex; i < row.length; i++) {
    const label = _cellText(row[i]);
    if (AGG_TOTAL_LABELS.includes(label)) return { labels, hasTotal: true };
    if (label === '') break;
    labels.push(label);
  }
  return { labels, hasTotal: false };
}

/**
 * 「20XX年」表記のセルを対象年度へ更新する書き込み指示を作る
 * @param {Array<Array<*>>} grid
 * @param {string} targetYear
 * @param {string[]} cellA1List 候補セル（A1形式）
 * @returns {Array<{ row: number, col: number, values: Array<Array<*>> }>}
 */
function _buildYearLabelWrites(grid, targetYear, cellA1List) {
  const writes = [];
  for (const a1 of cellA1List) {
    const match = /^([A-Z]+)(\d+)$/.exec(a1);
    if (!match) continue;
    const col = match[1].split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
    const row = Number(match[2]);
    const current = _cellText(grid[row - 1]?.[col - 1]);
    if (AGG_YEAR_PATTERN.test(current) && current !== targetYear) {
      writes.push({ row, col, values: [[targetYear]] });
    }
  }
  return writes;
}

// ============================================================
// ① 年別ファネル（行35〜44、対象年度の列のみ）
// ============================================================

/**
 * 進捗カウント（反響/来場/再来/3回目以上/成約）を数える
 * @param {Array<Array<*>>} yearData
 * @returns {{ res: number, vis: number, reVis: number, over: number, close: number }}
 */
function _countFunnel(yearData) {
  const c = { res: 0, vis: 0, reVis: 0, over: 0, close: 0 };
  for (const row of yearData) {
    c.res++;
    if (_hasValue(row[SALES_LIST_COLS.MTG_DAY_1 - 1])) c.vis++;
    if (_hasValue(row[SALES_LIST_COLS.MTG_DAY_2 - 1])) c.reVis++;
    if (_hasValue(row[SALES_LIST_COLS.MTG_DAY_3 - 1])) c.over++;
    if (_cellText(row[SALES_LIST_COLS.RANK - 1]) === 'A') c.close++;
  }
  return c;
}

/**
 * 年別ファネルの書き込み指示を作る
 * @param {Array<Array<*>>} grid
 * @param {Array<Array<*>>} yearData
 * @param {string} targetYear
 * @returns {{ row: number, col: number, values: Array<Array<*>> }|null}
 */
function _buildFunnelWrite(grid, yearData, targetYear) {
  const colIndex = _findYearColumn(grid, AGG_ROWS.FUNNEL_HEADER, targetYear);
  if (colIndex === -1) {
    AppLogger.warn('_buildFunnelWrite: 対象年度の列が見つかりません', { targetYear });
    return null;
  }
  const c = _countFunnel(yearData);
  const values = [
    [c.res], [c.vis], [c.reVis], [c.over], [c.close],
    [_aggRatio(c.vis,   c.res)],    // 反響来場率
    [_aggRatio(c.reVis, c.vis)],    // 再来率
    [_aggRatio(c.over,  c.vis)],    // 再々来場率
    [_aggRatio(c.close, c.vis)],    // 歩留
    [_aggRatio(c.close, c.reVis)],  // 再来歩留
  ];
  return { row: AGG_ROWS.FUNNEL_START, col: colIndex + 1, values };
}

// ============================================================
// ② 月ごとの反響数（行70〜82、対象年度の列のみ）
// ============================================================

/**
 * 月別反響数の書き込み指示を作る
 * @param {Array<Array<*>>} grid
 * @param {Array<Array<*>>} yearData
 * @param {string} targetYear
 * @returns {{ row: number, col: number, values: Array<Array<*>> }|null}
 */
function _buildMonthlyWrite(grid, yearData, targetYear) {
  const colIndex = _findYearColumn(grid, AGG_ROWS.MONTHLY_HEADER, targetYear);
  if (colIndex === -1) {
    AppLogger.warn('_buildMonthlyWrite: 対象年度の列が見つかりません', { targetYear });
    return null;
  }
  const counts = new Array(12).fill(0);
  for (const row of yearData) {
    const m = /^(\d{1,2})月$/.exec(_cellText(row[SALES_LIST_COLS.MONTH - 1]));
    if (!m) continue;
    const idx = Number(m[1]) - 1;
    if (idx >= 0 && idx < 12) counts[idx]++;
  }
  const total = counts.reduce((s, v) => s + v, 0);
  const values = [...counts.map((v) => [v]), [total]];
  return { row: AGG_ROWS.MONTHLY_START, col: colIndex + 1, values };
}

// ============================================================
// ③ 担当者別スコア（行108〜115）
// ============================================================

/**
 * 担当者別スコアの書き込み指示を作る
 * 担当者名はヘッダー行（107行目B列〜）から動的取得。
 * 'その他' 列はヘッダーに無い担当者の受け皿、'計'/'合計' 列は横計。
 *
 * @param {Array<Array<*>>} grid
 * @param {Array<Array<*>>} yearData
 * @returns {{ row: number, col: number, values: Array<Array<*>> }|null}
 */
function _buildStaffWrites(grid, yearData) {
  const headerRow = grid[AGG_ROWS.STAFF_HEADER - 1] ?? [];
  const columns = [];  // { kind: 'staff'|'other'|'total', name }
  for (let i = 1; i < headerRow.length; i++) {
    const label = _cellText(headerRow[i]);
    if (label === '') break;
    if (AGG_TOTAL_LABELS.includes(label)) { columns.push({ kind: 'total' }); break; }
    columns.push(label === AGG_OTHER_LABEL ? { kind: 'other' } : { kind: 'staff', name: label });
  }
  if (columns.length === 0) {
    AppLogger.warn('_buildStaffWrites: 担当者ヘッダーが見つかりません', {});
    return null;
  }

  const staffNames = columns.filter((c) => c.kind === 'staff').map((c) => c.name);
  const zero = () => ({ res: 0, vis: 0, reVis: 0, over: 0, close: 0 });
  const perStaff = new Map(staffNames.map((n) => [n, zero()]));
  const other = zero();
  const total = zero();

  for (const row of yearData) {
    const manager = _cellText(row[SALES_LIST_COLS.MANAGER - 1]);
    const bucket = perStaff.get(manager) ?? other;
    for (const c of [bucket, total]) {
      c.res++;
      if (_hasValue(row[SALES_LIST_COLS.MTG_DAY_1 - 1])) c.vis++;
      if (_hasValue(row[SALES_LIST_COLS.MTG_DAY_2 - 1])) c.reVis++;
      if (_hasValue(row[SALES_LIST_COLS.MTG_DAY_3 - 1])) c.over++;
      if (_cellText(row[SALES_LIST_COLS.RANK - 1]) === 'A') c.close++;
    }
  }

  const toColumn = (c) => [
    c.res, c.vis, c.reVis, c.over, c.close,
    _aggRatio(c.vis,   c.res),  // 反響来場率
    _aggRatio(c.reVis, c.vis),  // 再アポ率
    _aggRatio(c.close, c.vis),  // 歩留
  ];

  // 列方向に並べて1回で書き込む（8行 × 列数）
  const columnValues = columns.map((col) => {
    if (col.kind === 'total') return toColumn(total);
    if (col.kind === 'other') return toColumn(other);
    return toColumn(perStaff.get(col.name));
  });
  const values = Array.from({ length: 8 }, (_, r) => columnValues.map((cv) => cv[r]));
  return { row: AGG_ROWS.STAFF_START, col: 2, values };
}

// ============================================================
// ④ 媒体別・エリア別（年ヘッダー列方式、対象年度の列のみ）
// ============================================================

/**
 * 反響媒体のキー解決（完全一致のみ。ラベルに無い媒体はカウントしない）
 * @param {Array<*>} row
 * @param {string[]} labels
 * @returns {number} ラベルインデックス（-1 なら対象外）
 */
function _mediaKeyResolver(row, labels) {
  return labels.indexOf(_cellText(row[CUSTOMER_LIST_COLS.INFO_ROUTE - 1]));
}

/**
 * 希望エリアのキー解決（市・区を優先し、無ければ都道府県）
 * @param {Array<*>} row
 * @param {string[]} labels
 * @returns {number}
 */
function _areaKeyResolver(row, labels) {
  const city = _cellText(row[SALES_LIST_COLS.CITY - 1]);
  if (city !== '') {
    const idx = labels.indexOf(city);
    if (idx !== -1) return idx;
  }
  const pref = _cellText(row[SALES_LIST_COLS.PREFECTURE - 1]);
  return pref === '' ? -1 : labels.indexOf(pref);
}

/**
 * 「A列ラベル × 年ヘッダー列」型ブロックの書き込み指示を作る（媒体別・エリア別共用）
 * @param {Array<Array<*>>} grid
 * @param {Array<Array<*>>} dataSet
 * @param {string} targetYear
 * @param {number} headerRow 年ヘッダー行（1始まり）
 * @param {function(Array<*>, string[]): number} keyResolver 行 → ラベルインデックス
 * @returns {{ row: number, col: number, values: Array<Array<*>> }|null}
 */
function _buildLabeledYearColumnWrite(grid, dataSet, targetYear, headerRow, keyResolver) {
  const colIndex = _findYearColumn(grid, headerRow, targetYear);
  if (colIndex === -1) {
    AppLogger.warn('_buildLabeledYearColumnWrite: 対象年度の列が見つかりません', { headerRow, targetYear });
    return null;
  }
  const { labels, hasTotal } = _scanLabels(grid, headerRow + 1, 0, 120);
  if (labels.length === 0) {
    AppLogger.warn('_buildLabeledYearColumnWrite: ラベルが見つかりません', { headerRow });
    return null;
  }

  const counts = new Array(labels.length).fill(0);
  for (const row of dataSet) {
    const idx = keyResolver(row, labels);
    if (idx !== -1) counts[idx]++;
  }
  const total = counts.reduce((s, v) => s + v, 0);

  // ラベル行〜合計行までを1列で書き込む（ラベルと合計行の間に空行は無い前提）
  const values = [...counts.map((v) => [v])];
  if (hasTotal) values.push([total]);
  return { row: headerRow + 1, col: colIndex + 1, values };
}

// ============================================================
// ⑤ 住宅系クロス集計（年収×年齢・家族数×年齢・属性×業界）
// ============================================================

/**
 * 年齢 → 列インデックス（0始まり）。範囲外・不明は末尾（不明列）
 * @param {*} ageValue
 * @returns {number}
 */
function _resolveAgeIndex(ageValue) {
  const age = Number(ageValue);
  if (!age || age <= 0 || Number.isNaN(age)) return AGG_AGE_SECTIONS.length;
  const idx = AGG_AGE_SECTIONS.findIndex((s) => age > s.min && age <= s.max);
  return idx === -1 ? AGG_AGE_SECTIONS.length : idx;
}

/**
 * 年収 → 行インデックス（0始まり）。不明は末尾（不明行）
 * @param {*} incomeValue
 * @returns {number}
 */
function _resolveIncomeIndex(incomeValue) {
  const income = Number(String(incomeValue ?? '').replace(/[,，円]/g, ''));
  if (!income || income <= 0 || Number.isNaN(income)) return AGG_INCOME_SECTIONS.length;
  const idx = AGG_INCOME_SECTIONS.findIndex((s) => income <= s.max);
  return idx === -1 ? AGG_INCOME_SECTIONS.length : idx;
}

/**
 * 家族数 → 行インデックス（0始まり）。1〜6人以外は末尾（不明行）
 * @param {*} famValue
 * @returns {number}
 */
function _resolveFamilyIndex(famValue) {
  const fam = Number(famValue);
  if (fam >= 1 && fam <= AGG_FAMILY_MAX) return fam - 1;
  return AGG_FAMILY_MAX;
}

/**
 * 行区分×列区分のマトリクスを数え、計行・計列込みの2次元配列にする
 * @param {Array<Array<*>>} dataSet
 * @param {number} rowCount 行区分数（不明含む、計は含まない）
 * @param {number} colCount 列区分数（不明含む、計は含まない）
 * @param {function(Array<*>): number} rowResolver
 * @param {function(Array<*>): number} colResolver
 * @returns {Array<Array<number>>} (rowCount+1) × (colCount+1)（末尾が計）
 */
function _countMatrix(dataSet, rowCount, colCount, rowResolver, colResolver) {
  const matrix = Array.from({ length: rowCount + 1 }, () => new Array(colCount + 1).fill(0));
  for (const row of dataSet) {
    const r = rowResolver(row);
    const c = colResolver(row);
    matrix[r][c]++;
    matrix[r][colCount]++;
    matrix[rowCount][c]++;
    matrix[rowCount][colCount]++;
  }
  return matrix;
}

/**
 * 年収×年齢（反響者=B121〜J130 / 契約者=M121〜U130）の書き込み指示を作る
 * @param {Array<Array<*>>} yearData
 * @param {Array<Array<*>>} closedData
 * @returns {Array<{ row: number, col: number, values: Array<Array<*>> }>}
 */
function _buildIncomeAgeWrites(yearData, closedData) {
  const build = (dataSet, col) => ({
    row: AGG_RESIDENTIAL_ROWS.INCOME_AGE_START,
    col,
    values: _countMatrix(
      dataSet, AGG_INCOME_SECTIONS.length + 1, AGG_AGE_SECTIONS.length + 1,
      (row) => _resolveIncomeIndex(row[SALES_LIST_COLS.INCOME - 1]),
      (row) => _resolveAgeIndex(row[CUSTOMER_LIST_COLS.AGE - 1]),
    ),
  });
  return [build(yearData, 2), build(closedData, 13)];
}

/**
 * 家族数×年齢（反響者=B139〜J146 / 契約者=M139〜U146）の書き込み指示を作る
 * @param {Array<Array<*>>} yearData
 * @param {Array<Array<*>>} closedData
 * @returns {Array<{ row: number, col: number, values: Array<Array<*>> }>}
 */
function _buildAgeFamilyWrites(yearData, closedData) {
  const build = (dataSet, col) => ({
    row: AGG_RESIDENTIAL_ROWS.AGE_FAMILY_START,
    col,
    values: _countMatrix(
      dataSet, AGG_FAMILY_MAX + 1, AGG_AGE_SECTIONS.length + 1,
      (row) => _resolveFamilyIndex(row[CUSTOMER_LIST_COLS.FAMILY_MEMBER - 1]),
      (row) => _resolveAgeIndex(row[CUSTOMER_LIST_COLS.AGE - 1]),
    ),
  });
  return [build(yearData, 2), build(closedData, 13)];
}

/**
 * 属性×業界（反響者=B152〜J172 / 契約者=M152〜U172）の書き込み指示を作る
 * 行=業界（20区分＋計）、列=属性（8区分＋計）
 * @param {Array<Array<*>>} yearData
 * @param {Array<Array<*>>} closedData
 * @returns {Array<{ row: number, col: number, values: Array<Array<*>> }>}
 */
function _buildAttrIndustryWrites(yearData, closedData) {
  const build = (dataSet, col) => ({
    row: AGG_RESIDENTIAL_ROWS.ATTR_INDUSTRY_START,
    col,
    values: _countMatrix(
      dataSet, AGG_INDUSTRY_COUNT, AGG_ATTR_COUNT,
      (row) => AGG_INDUSTRY_TO_IDX[_cellText(row[SALES_LIST_COLS.INDUSTRY - 1])] ?? (AGG_INDUSTRY_COUNT - 1),
      (row) => AGG_OCCUPATION_TO_ATTR[_cellText(row[SALES_LIST_COLS.OCCUPATION - 1])] ?? (AGG_ATTR_COUNT - 1),
    ),
  });
  return [build(yearData, 2), build(closedData, 13)];
}

// ============================================================
// ⑥ 住宅系 問い合わせニーズ（一次取得/持家/実家など）
// ============================================================

/** 問い合わせ種別のシート列順（B〜F） */
const AGG_NEEDS_APPOINTS = ['相談会', '個別相談', '外部相談会', '見学会', '資料請求'];

/**
 * 問い合わせニーズ3ブロックの書き込み指示を作る
 * 各ブロック: 反響/来場/契約/来場率/歩留 の5行 × （種別5列＋計）
 * @param {Array<Array<*>>} yearData
 * @returns {Array<{ row: number, col: number, values: Array<Array<*>> }>}
 */
function _buildNeedsWrites(yearData) {
  return AGG_RESIDENTIAL_ROWS.NEEDS_BLOCKS.map((block) => {
    const n = AGG_NEEDS_APPOINTS.length;
    const res = new Array(n + 1).fill(0);
    const vis = new Array(n + 1).fill(0);
    const close = new Array(n + 1).fill(0);

    for (const row of yearData) {
      if (!_hasValue(row[block.filterCol - 1])) continue;  // 対象ニーズの顧客のみ
      const idx = AGG_NEEDS_APPOINTS.indexOf(_cellText(row[CUSTOMER_LIST_COLS.FIRST_APPOINT - 1]));
      if (idx === -1) continue;
      for (const i of [idx, n]) {
        res[i]++;
        if (_hasValue(row[SALES_LIST_COLS.MTG_DAY_1 - 1])) vis[i]++;
        if (_cellText(row[SALES_LIST_COLS.RANK - 1]) === 'A') close[i]++;
      }
    }
    const att   = res.map((_, i) => _aggRatio(vis[i], res[i]));
    const yieldRate = res.map((_, i) => _aggRatio(close[i], vis[i]));
    return { row: block.startRow, col: 2, values: [res, vis, close, att, yieldRate] };
  });
}

// ============================================================
// ⑦ 住宅系 検討レベル総数（行178 M〜T）
// ============================================================

/**
 * 検討レベル総数の書き込み指示を作る
 * 一覧シートの見込度列（D列）の値を検討レベル7区分に割り付ける
 * @param {Array<Array<*>>} yearData
 * @returns {{ row: number, col: number, values: Array<Array<*>> }}
 */
function _buildConsiderationWrite(yearData) {
  const counts = new Array(AGG_CONSIDERATION_COUNT + 1).fill(0);
  for (const row of yearData) {
    const idx = AGG_CONSIDERATION_MAP[_cellText(row[SALES_LIST_COLS.LIKEHOOD - 1])];
    if (idx === undefined) continue;
    counts[idx]++;
    counts[AGG_CONSIDERATION_COUNT]++;
  }
  return { row: AGG_RESIDENTIAL_ROWS.CONSIDERATION_ROW, col: 13, values: [counts] };
}

// ============================================================
// ⑧ 住宅系 離脱理由×担当者（行183〜合計行、L列=理由ラベル）
// ============================================================

/**
 * 離脱理由×担当者の書き込み指示を作る
 * 理由ラベルはL列183行目〜'合計'、担当者はヘッダー行のN列以降から動的取得。
 * M列=理由総数。ヘッダーに無い担当者は理由総数・合計行のみに計上する。
 * @param {Array<Array<*>>} grid
 * @param {Array<Array<*>>} yearData
 * @returns {{ row: number, col: number, values: Array<Array<*>> }|null}
 */
function _buildLeavingWrite(grid, yearData) {
  const { labels: reasons, hasTotal } = _scanLabels(grid, AGG_RESIDENTIAL_ROWS.LEAVING_START, 11, 30);
  const { labels: staffList } = _scanHeaderLabels(grid, AGG_RESIDENTIAL_ROWS.LEAVING_HEADER, 13);
  if (reasons.length === 0) {
    AppLogger.warn('_buildLeavingWrite: 離脱理由ラベルが見つかりません', {});
    return null;
  }

  // rows: 理由ごと + 合計行 / cols: 理由総数 + 担当者ごと
  const matrix = Array.from({ length: reasons.length + 1 }, () => new Array(staffList.length + 1).fill(0));
  for (const row of yearData) {
    const reason = _cellText(row[RESIDENTIAL_EXTRA_COLS.REASON - 1]);
    const r = reasons.indexOf(reason);
    if (r === -1) continue;
    const staff = _cellText(row[SALES_LIST_COLS.MANAGER - 1]);
    const s = staffList.indexOf(staff);
    matrix[r][0]++;
    matrix[reasons.length][0]++;
    if (s !== -1) {
      matrix[r][s + 1]++;
      matrix[reasons.length][s + 1]++;
    }
  }

  // 合計行はラベル直後にある場合のみ書く（現行シートは理由15行+合計行）
  const rowCount = hasTotal ? reasons.length + 1 : reasons.length;
  return {
    row: AGG_RESIDENTIAL_ROWS.LEAVING_START,
    col: 13,
    values: matrix.slice(0, rowCount),
  };
}

// ============================================================
// ⑨ 法人系 クロス集計（業種×企業規模・肩書×企業規模）
// ============================================================

/**
 * ラベル参照型クロスマトリクス（反響者=B列〜 / 契約者=M列〜）の書き込み指示を作る
 * 行ラベルはA列（ヘッダー行+1〜'計'）、列ラベルはヘッダー行B列〜'計'から動的取得。
 * ラベルに無い値は「不明」行/列に計上する。
 *
 * @param {Array<Array<*>>} grid
 * @param {Array<Array<*>>} yearData
 * @param {Array<Array<*>>} closedData
 * @param {number} headerRow ヘッダー行（1始まり）
 * @param {function(Array<*>): string} rowValueGetter 行 → 行ラベル値
 * @param {function(Array<*>): string} colValueGetter 行 → 列ラベル値
 * @returns {Array<{ row: number, col: number, values: Array<Array<*>> }>}
 */
function _buildCrossMatrixWrites(grid, yearData, closedData, headerRow, rowValueGetter, colValueGetter) {
  const { labels: rowLabels, hasTotal: hasTotalRow } = _scanLabels(grid, headerRow + 1, 0, 40);
  const { labels: colLabels, hasTotal: hasTotalCol } = _scanHeaderLabels(grid, headerRow, 1);
  if (rowLabels.length === 0 || colLabels.length === 0) {
    AppLogger.warn('_buildCrossMatrixWrites: ラベルが見つかりません', { headerRow });
    return [];
  }
  const resolve = (value, labels) => {
    const idx = labels.indexOf(value);
    if (idx !== -1) return idx;
    const unknownIdx = labels.indexOf('不明');
    return unknownIdx !== -1 ? unknownIdx : labels.length - 1;
  };
  const build = (dataSet, col) => {
    const matrix = _countMatrix(
      dataSet, rowLabels.length, colLabels.length,
      (row) => resolve(rowValueGetter(row), rowLabels),
      (row) => resolve(colValueGetter(row), colLabels),
    );
    const values = matrix
      .slice(0, rowLabels.length + (hasTotalRow ? 1 : 0))
      .map((r) => r.slice(0, colLabels.length + (hasTotalCol ? 1 : 0)));
    return { row: headerRow + 1, col, values };
  };
  return [build(yearData, 2), build(closedData, 13)];
}

// ============================================================
// ⑩ 法人系 業態×業種（反響者/契約者）
// ============================================================

/** 業態フラグ列（希望種別A/B/C）→ 業態列インデックス */
const AGG_TYPE_NEEDS_FLAG_COLS = [
  { col: BUSINESS_EXTRA_COLS.HOPE_TYPE_A, idx: 0 },  // 独立・入居希望
  { col: BUSINESS_EXTRA_COLS.HOPE_TYPE_B, idx: 1 },  // 既存店舗・大家
  { col: BUSINESS_EXTRA_COLS.HOPE_TYPE_C, idx: 2 },  // 新店舗・移転
];

/**
 * 業態×業種の書き込み指示を作る
 * 行=業種（A列ラベル）、列=業態3区分＋合計
 * @param {Array<Array<*>>} grid
 * @param {Array<Array<*>>} dataSet
 * @param {number} headerRow ヘッダー行（1始まり）
 * @returns {{ row: number, col: number, values: Array<Array<*>> }|null}
 */
function _buildTypeNeedsWrite(grid, dataSet, headerRow) {
  const { labels: typeLabels, hasTotal } = _scanLabels(grid, headerRow + 1, 0, 40);
  if (typeLabels.length === 0) {
    AppLogger.warn('_buildTypeNeedsWrite: 業種ラベルが見つかりません', { headerRow });
    return null;
  }
  const needsCount = AGG_TYPE_NEEDS_FLAG_COLS.length;
  const resolveNeeds = (row) => {
    for (const { col, idx } of AGG_TYPE_NEEDS_FLAG_COLS) {
      if (_hasValue(row[col - 1])) return idx;
    }
    return -1;
  };
  const resolveType = (row) => {
    const idx = typeLabels.indexOf(_cellText(row[SALES_LIST_COLS.INDUSTRY - 1]));
    if (idx !== -1) return idx;
    const unknownIdx = typeLabels.indexOf('不明');
    return unknownIdx !== -1 ? unknownIdx : typeLabels.length - 1;
  };

  const matrix = Array.from({ length: typeLabels.length + 1 }, () => new Array(needsCount + 1).fill(0));
  for (const row of dataSet) {
    const c = resolveNeeds(row);
    if (c === -1) continue;
    const r = resolveType(row);
    matrix[r][c]++;
    matrix[r][needsCount]++;
    matrix[typeLabels.length][c]++;
    matrix[typeLabels.length][needsCount]++;
  }
  return {
    row: headerRow + 1,
    col: 2,
    values: matrix.slice(0, typeLabels.length + (hasTotal ? 1 : 0)),
  };
}

// ============================================================
// ⑪ 法人系 集客イベント（行155〜159、L〜列）
// ============================================================

/**
 * 集客イベントの書き込み指示を作る
 * 列=初回アポイント種別（M154〜'計'）、行=反響/来場/契約/来場率/歩留
 * @param {Array<Array<*>>} grid
 * @param {Array<Array<*>>} yearData
 * @returns {{ row: number, col: number, values: Array<Array<*>> }|null}
 */
function _buildEventWrite(grid, yearData) {
  const { labels: items, hasTotal } = _scanHeaderLabels(grid, AGG_BUSINESS_ROWS.EVENT_HEADER, 12);
  if (items.length === 0) {
    AppLogger.warn('_buildEventWrite: イベント項目が見つかりません', {});
    return null;
  }
  const n = items.length;
  const res = new Array(n + 1).fill(0);
  const vis = new Array(n + 1).fill(0);
  const close = new Array(n + 1).fill(0);

  for (const row of yearData) {
    const idx = items.indexOf(_cellText(row[CUSTOMER_LIST_COLS.FIRST_APPOINT - 1]));
    if (idx === -1) continue;
    for (const i of [idx, n]) {
      res[i]++;
      if (_hasValue(row[SALES_LIST_COLS.MTG_DAY_1 - 1])) vis[i]++;
      if (_cellText(row[SALES_LIST_COLS.RANK - 1]) === 'A') close[i]++;
    }
  }
  const att   = res.map((_, i) => _aggRatio(vis[i], res[i]));
  const yieldRate = res.map((_, i) => _aggRatio(close[i], vis[i]));
  const width = n + (hasTotal ? 1 : 0);
  return {
    row: AGG_BUSINESS_ROWS.EVENT_HEADER + 1,
    col: 13,
    values: [res, vis, close, att, yieldRate].map((r) => r.slice(0, width)),
  };
}
