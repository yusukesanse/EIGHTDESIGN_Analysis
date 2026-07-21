// ============================================================
// graph/calcAllDomainsConfig.gs
// calcAllDomains / calcAllProgress / calcAllMonthly で使用する定数
// ============================================================

// ============================================================
// 共通
// ============================================================

/** 全ドメインシート名 */
const ALL_DOMAINS_SHEET_NAME = '全ドメイン';

/**
 * 販促エリア → アンマッチシートのエリア名マッピング
 * @type {Object<string, string>}
 */
const UNMATCH_AREA_MAP = {
  '名古屋': '東京',
  '遠方':   '東京',
  '東京':   '名古屋',
};

// ============================================================
// 顧客進捗（calcAllProgress）
// ============================================================

/** 対象年度ヘッダーが格納されているグラフシート行インデックス（0始まり） */
const ALL_PROGRESS_YEAR_ROW = 34;

/** グラフシートから抽出する進捗データの行範囲（0始まり） */
const ALL_PROGRESS_DATA_ROWS = { from: 35, to: 45 };

/** 進捗指標キー（抽出順と一致） */
const PROGRESS_METRIC_KEYS = ['res', 'vis', 'reVis', 'over', 'close', 'visRate', 'reVisRate', 'yield', 'reYield'];

/** 後処理で集計する進捗行数 */
const ALL_DOMAIN_PROGRESS_ROWS = 30;

/** 後処理ヘッダーキーワード */
const ALL_DOMAIN_PROGRESS_KEYWORD      = '_顧客進捗';
const ALL_DOMAIN_PROGRESS_ANTI_KEYWORD = '全ドメイン_顧客進捗';

// ============================================================
// 月別反響（calcAllMonthly）
// ============================================================

/** 対象年度ヘッダーが格納されているグラフシート行インデックス（0始まり） */
const ALL_MONTHLY_YEAR_ROW = 69;

/** グラフシートから抽出する月別データの行範囲（0始まり） */
const ALL_MONTHLY_DATA_ROWS = { from: 70, to: 83 };

/** 集計対象の月数（13ヶ月：当年4月〜翌年4月） */
const ALL_MONTHLY_MONTHS = ALL_MONTHLY_DATA_ROWS.to - ALL_MONTHLY_DATA_ROWS.from;

/** 後処理で集計する月別行数 */
const ALL_DOMAIN_MONTHLY_ROWS = 13;

/** 来場数・成約数の配列インデックス */
const MONTHLY_VISIT_IDX  = 3;   // 来場数
const MONTHLY_CLOSED_IDX = 12;  // 成約数

/** 後処理ヘッダーキーワード */
const ALL_DOMAIN_MONTHLY_KEYWORD      = '_月ごとの反響';
const ALL_DOMAIN_MONTHLY_ANTI_KEYWORD = '全ドメイン_月ごとの反響';