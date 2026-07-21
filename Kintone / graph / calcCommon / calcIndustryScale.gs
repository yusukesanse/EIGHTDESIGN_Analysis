// ============================================================
// graph/calcBusiness.gs
// ============================================================

/**
 * 業界×企業規模の件数を集計し、グラフシートへ書き込む
 * @param {Object} config
 */
function calcIndustryScale(config) {
  try {
    _calcIndustryScaleBlock(config, INDUSTRY_SCALE_BLOCK_ALL);

    if (config.listData[1]?.length > 0) {
      _calcIndustryScaleBlock(config, INDUSTRY_SCALE_BLOCK_CLOSED);
    }
  } catch (e) {
    handleError(e.stack, e.message, 'calcIndustryScale',
      config.record.customer_name.value, config.record.customer_type.value);
  }
}

// ============================================================
// 定数
// ============================================================

/** ブロック定義 */
const INDUSTRY_SCALE_BLOCK_ALL    = { startRow: 121, startCol: 2,  dataIndex: 0 };
const INDUSTRY_SCALE_BLOCK_CLOSED = { startRow: 121, startCol: 13, dataIndex: 1 };

/**
 * グラフシート上の企業規模ヘッダー行番号（1始まり）
 * この行の2列目以降、空セルまでを企業規模リストとして取得する
 */
const INDUSTRY_SCALE_COMPANY_HEADER_ROW = 120;

/**
 * グラフシート上の業界ラベル行範囲（0始まり）
 * slice(from, to) の形式
 */
const INDUSTRY_SCALE_INDUSTRY_ROWS = [121, 140];

/** 不明値の代替文字列 */
const UNKNOWN_LABEL = '不明';

/** 合計キーの接尾辞 */
const TOTAL_SUFFIX = '計';

/** 業界・企業規模の列インデックス（0始まり） */
const COL_INDUSTRY_SCALE_INDUSTRY = SALES_LIST_COLS.INDUSTRY - 1;
const COL_INDUSTRY_SCALE_COMPANY  = SALES_LIST_COLS.WORK_PLACE - 1;

// ============================================================
// ブロック単位の集計・書き込み
// ============================================================

/**
 * 指定ブロックの業界×企業規模を集計してグラフシートへ書き込む
 * @param {Object} config
 * @param {{ startRow: number, startCol: number, dataIndex: number }} block
 */
function _calcIndustryScaleBlock(config, block) {
  // ── 1. メタデータ取得 ─────────────────────────────────────
  const { industryList, companyList } = _readIndustryScaleMeta(config.graphData);

  // ── 2. カウンタ初期化 ─────────────────────────────────────
  const counts = _initIndustryScaleCounts(industryList, companyList);

  // ── 3. 一覧データから集計 ─────────────────────────────────
  _countIndustryScaleFromSheet(config.listData[block.dataIndex], industryList, companyList, counts);

  // ── 4. Webhookレコードの差分を適用（営業アプリのみ） ───────
  if (config.appId === config.salesAppId) {
    _applyIndustryScaleDelta(config, industryList, companyList, counts);
  }

  // ── 5. グラフシートへ書き込み ─────────────────────────────
  _writeIndustryScaleCounts(config.graphSheet, block, industryList, companyList, counts);
}

// ============================================================
// メタデータ取得
// ============================================================

/**
 * グラフシートから業界リストと企業規模リストを動的取得する
 * @param {Array<Array<*>>} graphData
 * @returns {{ industryList: string[], companyList: string[] }}
 */
function _readIndustryScaleMeta(graphData) {
  // 企業規模: ヘッダー行の2列目以降、空セルまで取得
  const companyHeaderRow = graphData[INDUSTRY_SCALE_COMPANY_HEADER_ROW];
  const companyList = [];
  for (let i = 1; i < companyHeaderRow.length; i++) {
    if (companyHeaderRow[i] === '') break;
    companyList.push(String(companyHeaderRow[i]));
  }

  // 業界: A列の指定行範囲から空セルを除いて取得
  const industryList = graphData
    .slice(INDUSTRY_SCALE_INDUSTRY_ROWS[0], INDUSTRY_SCALE_INDUSTRY_ROWS[1])
    .map(row => String(row[0] ?? ''))
    .filter(v => v !== '');

  AppLogger.debug('_readIndustryScaleMeta', { industryList, companyList });
  return { industryList, companyList };
}

// ============================================================
// カウンタ初期化
// ============================================================

/**
 * 業界×企業規模のカウンタを全キー0で初期化する
 * Bug 1修正: 合計キー（${industry}_計 / 計_${company} / 計_計）も含めて初期化
 *
 * @param {string[]} industryList
 * @param {string[]} companyList
 * @returns {Object<string, number>}
 */
function _initIndustryScaleCounts(industryList, companyList) {
  const counts = {};
  const allIndustries = [...industryList, TOTAL_SUFFIX];
  const allCompanies  = [...companyList,  TOTAL_SUFFIX];

  for (const industry of allIndustries) {
    for (const company of allCompanies) {
      counts[`${industry}_${company}`] = 0;
    }
  }
  return counts;
}

// ============================================================
// 区分解決ヘルパー
// ============================================================

/**
 * 値が対象リストに含まれない場合に UNKNOWN_LABEL へフォールバックする
 * @param {string} value
 * @param {string[]} list
 * @returns {string}
 */
function _resolveOrUnknown(value, list) {
  const str = String(value ?? '');
  return list.includes(str) ? str : UNKNOWN_LABEL;
}

// ============================================================
// シートからの集計
// ============================================================

/**
 * 一覧データから業界×企業規模のカウントを集計する
 * @param {Array<Array<*>>} dataSet
 * @param {string[]} industryList
 * @param {string[]} companyList
 * @param {Object<string, number>} counts
 */
function _countIndustryScaleFromSheet(dataSet, industryList, companyList, counts) {
  for (const row of dataSet) {
    const industry = _resolveOrUnknown(row[COL_INDUSTRY_SCALE_INDUSTRY], industryList);
    const company  = _resolveOrUnknown(row[COL_INDUSTRY_SCALE_COMPANY],  companyList);
    _incIndustryScale(counts, industry, company);
  }
}

// ============================================================
// Webhook差分適用
// ============================================================

/**
 * Webhookレコードの業界×企業規模差分をカウントに適用する
 * Bug 3修正: 旧値がリスト外のとき counts[undefined]-- を防ぐ（_resolveOrUnknown で吸収）
 *
 * @param {Object} config
 * @param {string[]} industryList
 * @param {string[]} companyList
 * @param {Object<string, number>} counts
 */
function _applyIndustryScaleDelta(config, industryList, companyList, counts) {
  // Bug 4修正: company_size → SALES_FIELDS.INDUSTRY / WORK_PLACE を使用
  const newIndustry = _resolveOrUnknown(
    config.record?.industry?.value, industryList
  );
  const newCompany = _resolveOrUnknown(
    config.record?.work_place?.value, companyList
  );
  const hasExisting = config.existingCustomerData?.length > 0;

  if (hasExisting) {
    const oldIndustry = _resolveOrUnknown(
      config.existingCustomerData[COL_INDUSTRY_SCALE_INDUSTRY], industryList
    );
    const oldCompany = _resolveOrUnknown(
      config.existingCustomerData[COL_INDUSTRY_SCALE_COMPANY], companyList
    );

    if (oldIndustry !== newIndustry || oldCompany !== newCompany) {
      _decIndustryScale(counts, oldIndustry, oldCompany);
      _incIndustryScale(counts, newIndustry, newCompany);
    }
  } else {
    _incIndustryScale(counts, newIndustry, newCompany);
  }
}

/**
 * 業界×企業規模カウントを加算する（合計キーを同時更新）
 * @param {Object<string, number>} counts
 * @param {string} industry
 * @param {string} company
 */
function _incIndustryScale(counts, industry, company) {
  counts[`${industry}_${company}`]++;
  counts[`${industry}_${TOTAL_SUFFIX}`]++;
  counts[`${TOTAL_SUFFIX}_${company}`]++;
  counts[`${TOTAL_SUFFIX}_${TOTAL_SUFFIX}`]++;
}

/**
 * 業界×企業規模カウントを減算する（合計キーを同時更新）
 * Bug 2修正: for ループによる counts["計_計"] の後付け加算を廃止し、
 *            加減算を _incIndustryScale / _decIndustryScale に一元化
 * @param {Object<string, number>} counts
 * @param {string} industry
 * @param {string} company
 */
function _decIndustryScale(counts, industry, company) {
  counts[`${industry}_${company}`]--;
  counts[`${industry}_${TOTAL_SUFFIX}`]--;
  counts[`${TOTAL_SUFFIX}_${company}`]--;
  counts[`${TOTAL_SUFFIX}_${TOTAL_SUFFIX}`]--;
}

// ============================================================
// 書き込み
// ============================================================

/**
 * 業界×企業規模カウントをグラフシートへ書き込む
 * 企業規模ごとに1列ずつ、startCol から右方向に書き込む
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} graphSheet
 * @param {{ startRow: number, startCol: number }} block
 * @param {string[]} industryList
 * @param {string[]} companyList
 * @param {Object<string, number>} counts
 */
function _writeIndustryScaleCounts(graphSheet, block, industryList, companyList, counts) {
  // 業界リスト + 合計行 を縦に、企業規模リスト + 合計列 を横に書き込む
  const allIndustries = [...industryList, TOTAL_SUFFIX];
  const allCompanies  = [...companyList,  TOTAL_SUFFIX];

  allCompanies.forEach((company, colOffset) => {
    const writeData = allIndustries.map(industry => [counts[`${industry}_${company}`] ?? 0]);
    graphSheet
      .getRange(block.startRow, block.startCol + colOffset, writeData.length, 1)
      .setValues(writeData);
  });

  AppLogger.debug('calcIndustryScale: 書き込み完了', {
    startRow: block.startRow, startCol: block.startCol,
  });
}