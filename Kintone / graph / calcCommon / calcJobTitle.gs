// ============================================================
// graph/calcBusiness.gs
// ============================================================

/**
 * 担当者肩書き×企業規模の件数を集計し、グラフシートへ書き込む
 * @param {Object} config
 */
function calcJobTitle(config) {
  try {
    _calcJobTitleBlock(config, JOB_TITLE_BLOCK_ALL);

    if (config.listData[1]?.length > 0) {
      _calcJobTitleBlock(config, JOB_TITLE_BLOCK_CLOSED);
    }
  } catch (e) {
    handleError(e.stack, e.message, 'calcJobTitle',
      config.record.customer_name.value, config.record.customer_type.value);
  }
}

// ============================================================
// 定数
// ============================================================

/** ブロック定義 */
const JOB_TITLE_BLOCK_ALL    = { startRow: 145, startCol: 2,  dataIndex: 0 };
const JOB_TITLE_BLOCK_CLOSED = { startRow: 145, startCol: 13, dataIndex: 1 };

/**
 * グラフシート上の企業規模ヘッダー行番号（1始まり）
 * 2列目以降、空セルまでを企業規模リストとして取得する
 */
const JOB_TITLE_COMPANY_HEADER_ROW = 144;

/**
 * グラフシート上の肩書きラベル行範囲（0始まり）
 * A列から slice(from, to) で取得する
 */
const JOB_TITLE_ROWS = [145, 150];

/** 担当者肩書き・企業規模の列インデックス（0始まり） */
const COL_JOB_TITLE_COMPANY   = BUSINESS_EXTRA_COLS.CAPITAL_STOCK  - 1; // 企業規模
const COL_JOB_TITLE_JOB_TITLE = BUSINESS_EXTRA_COLS.JOB_TITLE      - 1; // 担当者肩書き

// ============================================================
// ブロック単位の集計・書き込み
// ============================================================

/**
 * 指定ブロックの担当者肩書き×企業規模を集計してグラフシートへ書き込む
 * @param {Object} config
 * @param {{ startRow: number, startCol: number, dataIndex: number }} block
 */
function _calcJobTitleBlock(config, block) {
  const { companyList, jobTitleList } = _readJobTitleMeta(config.graphData);
  const counts = _initJobTitleCounts(companyList, jobTitleList);
  _countJobTitleFromSheet(config.listData[block.dataIndex], companyList, jobTitleList, counts);

  if (config.appId === config.salesAppId) {
    _applyJobTitleDelta(config, companyList, jobTitleList, counts);
  }

  _writeJobTitleCounts(config.graphSheet, block, companyList, jobTitleList, counts);
}

// ============================================================
// メタデータ取得
// ============================================================

/**
 * グラフシートから企業規模リストと肩書きリストを動的取得する
 * @param {Array<Array<*>>} graphData
 * @returns {{ companyList: string[], jobTitleList: string[] }}
 */
function _readJobTitleMeta(graphData) {
  // 企業規模: ヘッダー行の2列目以降、空セルまで取得
  const companyHeaderRow = graphData[JOB_TITLE_COMPANY_HEADER_ROW];
  const companyList = [];
  for (let i = 1; i < companyHeaderRow.length; i++) {
    if (companyHeaderRow[i] === '') break;
    companyList.push(String(companyHeaderRow[i]));
  }

  // 担当者肩書き: A列の指定行範囲から空セルを除いて取得
  const jobTitleList = graphData
    .slice(JOB_TITLE_ROWS[0], JOB_TITLE_ROWS[1])
    .map(row => String(row[0] ?? ''))
    .filter(v => v !== '');

  AppLogger.debug('_readJobTitleMeta', { companyList, jobTitleList });
  return { companyList, jobTitleList };
}

// ============================================================
// カウンタ初期化
// ============================================================

/**
 * 担当者肩書き×企業規模のカウンタを全キー0で初期化する
 * Bug 1修正: 合計キー（${company}_計 / 計_${jobTitle} / 計_計）も含めて初期化
 *
 * @param {string[]} companyList
 * @param {string[]} jobTitleList
 * @returns {Object<string, number>}
 */
function _initJobTitleCounts(companyList, jobTitleList) {
  const counts  = {};
  const allCompanies  = [...companyList,  TOTAL_SUFFIX];
  const allJobTitles  = [...jobTitleList, TOTAL_SUFFIX];

  for (const company of allCompanies) {
    for (const job of allJobTitles) {
      counts[`${company}_${job}`] = 0;
    }
  }
  return counts;
}

// ============================================================
// シートからの集計
// ============================================================

/**
 * 一覧データから担当者肩書き×企業規模のカウントを集計する
 * @param {Array<Array<*>>} dataSet
 * @param {string[]} companyList
 * @param {string[]} jobTitleList
 * @param {Object<string, number>} counts
 */
function _countJobTitleFromSheet(dataSet, companyList, jobTitleList, counts) {
  for (const row of dataSet) {
    const company  = _resolveOrUnknown(row[COL_JOB_TITLE_COMPANY],   companyList);
    const jobTitle = _resolveOrUnknown(row[COL_JOB_TITLE_JOB_TITLE], jobTitleList);
    _incJobTitle(counts, company, jobTitle);
  }
}

// ============================================================
// Webhook差分適用
// ============================================================

/**
 * Webhookレコードの担当者肩書き×企業規模差分をカウントに適用する
 * Bug 3修正: company_size → work_place（SALES_FIELDSに準拠）
 * Bug 4修正: _resolveOrUnknown で存在しない値を UNKNOWN_LABEL に統一
 *
 * @param {Object} config
 * @param {string[]} companyList
 * @param {string[]} jobTitleList
 * @param {Object<string, number>} counts
 */
function _applyJobTitleDelta(config, companyList, jobTitleList, counts) {
  const newCompany  = _resolveOrUnknown(config.record?.work_place?.value,  companyList);
  const newJobTitle = _resolveOrUnknown(config.record?.job_title?.value,   jobTitleList);
  const hasExisting = config.existingCustomerData?.length > 0;

  if (hasExisting) {
    const oldCompany  = _resolveOrUnknown(config.existingCustomerData[COL_JOB_TITLE_COMPANY],   companyList);
    const oldJobTitle = _resolveOrUnknown(config.existingCustomerData[COL_JOB_TITLE_JOB_TITLE], jobTitleList);

    if (oldCompany !== newCompany || oldJobTitle !== newJobTitle) {
      _decJobTitle(counts, oldCompany, oldJobTitle);
      _incJobTitle(counts, newCompany, newJobTitle);
    }
  } else {
    _incJobTitle(counts, newCompany, newJobTitle);
  }
}

/**
 * 担当者肩書き×企業規模カウントを加算する（合計キーを同時更新）
 * @param {Object<string, number>} counts
 * @param {string} company
 * @param {string} jobTitle
 */
function _incJobTitle(counts, company, jobTitle) {
  counts[`${company}_${jobTitle}`]++;
  counts[`${company}_${TOTAL_SUFFIX}`]++;
  counts[`${TOTAL_SUFFIX}_${jobTitle}`]++;
  counts[`${TOTAL_SUFFIX}_${TOTAL_SUFFIX}`]++;
}

/**
 * 担当者肩書き×企業規模カウントを減算する（合計キーを同時更新）
 * Bug 2修正: for ループによる counts["計_計"] 後付け加算を廃止
 *
 * @param {Object<string, number>} counts
 * @param {string} company
 * @param {string} jobTitle
 */
function _decJobTitle(counts, company, jobTitle) {
  counts[`${company}_${jobTitle}`]--;
  counts[`${company}_${TOTAL_SUFFIX}`]--;
  counts[`${TOTAL_SUFFIX}_${jobTitle}`]--;
  counts[`${TOTAL_SUFFIX}_${TOTAL_SUFFIX}`]--;
}

// ============================================================
// 書き込み
// ============================================================

/**
 * 担当者肩書き×企業規模カウントをグラフシートへ書き込む
 * 企業規模ごとに1列ずつ、startCol から右方向に書き込む
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} graphSheet
 * @param {{ startRow: number, startCol: number }} block
 * @param {string[]} companyList
 * @param {string[]} jobTitleList
 * @param {Object<string, number>} counts
 */
function _writeJobTitleCounts(graphSheet, block, companyList, jobTitleList, counts) {
  const allCompanies  = [...companyList,  TOTAL_SUFFIX];
  const allJobTitles  = [...jobTitleList, TOTAL_SUFFIX];

  allCompanies.forEach((company, colOffset) => {
    const writeData = allJobTitles.map(job => [counts[`${company}_${job}`] ?? 0]);
    graphSheet
      .getRange(block.startRow, block.startCol + colOffset, writeData.length, 1)
      .setValues(writeData);
  });

  AppLogger.debug('calcJobTitle: 書き込み完了', {
    startRow: block.startRow, startCol: block.startCol,
  });
}