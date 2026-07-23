/**
 * config.gs — 定数・フィールドコード・シート列定義（旧 constants.gs + sheetConfig.gs）
 */

// ============================================================
// スプレッドシート設定
// ============================================================

/** @type {string} メインスプレッドシートID */
const SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');

/** @type {string} Slack通知用WebhookURL */
const SLACK_WEBHOOK_URL = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL');

// ============================================================
// kintoneアプリID
// ============================================================

/** @type {string} 顧客情報アプリ */
const CUSTOMER_APP_ID = '20';

/** @type {string} 営業・商談管理アプリ */
const SALES_APP_ID = '27';

// ============================================================
// kintoneフィールドコード定義
// ============================================================

/** @enum {string} 顧客情報アプリのフィールドコード */
const CUSTOMER_FIELDS = {
  CUSTOMER_TYPE:      'customer_type',
  CUSTOMER_NAME:      'customer_name',
  PROMOTION_AREA:     'promotion_area',
  INQUIRY_DATE:       'inquiry_date',
  LIKEHOOD_NOW:       'likehood_now',
  FIRST_APPOINT:      'first_appoint',
  INFORMATION_ROUTE:  'information_route',
  MANAGER:            'manager',
  AGE:                'age',
  CURRENT_RESIDENCE:  'current_residence',
  FAMILY_MEMBER:      'family_member',
};

/** @enum {string} 営業・商談管理アプリのフィールドコード */
const SALES_FIELDS = {
  CUSTOMER_TYPE:        'customer_type',
  CUSTOMER_NAME:        'customer_name',
  PROMOTION_AREA:       'promotion_area',
  INQUIRY_DATE:         'inquiry_date',
  LIKEHOOD_NOW:         'likehood_now',
  NEGO_STATUS:          'nego_status',
  DEAL_HISTORY:         'deal_history',
  CONSULTATION_CONTENT: 'consultation_content',
  MANAGER:              'manager',
  LAND_ATTRIBUTES:      'land_attributes',
  PREFECTURES:          'prefectures',
  CITY:                 'city',
  TOWN:                 'town',
  AREA:                 'area',
  WORK_PLACE:           'work_place',
  WORK_PLACE_SUB:       'work_place_sub',
  INDUSTRY:             'industry',
  OCCUPATION:           'occupation',
  INCOME:               'income',
  INCOME_SUB:           'income_sub',
  SELF_FUNDED:          'self_funded',
  HOPE_RENOVATION:      'hope_renovation',
  CONSTRUCTION_STATUS:  'construction_status',
  RENTAL_TYPE:          'rental_type',
  CURRENT_RESIDENCE:    'current_residence',
  REASON:               'reason',
  JOB_TITLE:            'job_title',
  HOPE_BUSINESS_TYPE:   'hope_business_type',
  CAPITAL_STOCK:        'capital_stock',
  INQUIRY_STATUS:       'inquiry_status',
};

/** @enum {string} 商談履歴サブテーブルのフィールドコード */
const DEAL_HISTORY_FIELDS = {
  DEAL_COUNT:       'deal_count',
  RESPONSE_DATE:    'response_date',
  NEXT_APPOINTMENT: 'next_appointment',
};

// ============================================================
// 顧客種別定義
// ============================================================

/** @enum {string} 顧客種別の正規化後の値 */
const CUSTOMER_TYPES = {
  RESIDENTIAL:   '一般住宅',
  SMALL_STORE:   '小型店舗',
  OFFICE:        'オフィス',
  TRAILER:       'エイトトレーラー',
  MEDICAL:       '医療福祉',
  FACTORY:       '工場・倉庫',
  MISEIE:        'みせいえ',
  RENTAL:        '賃貸',
  NEW_BUILD:     '新築',
};

// ============================================================
// エリア定義
// ============================================================

/** @enum {string} 対応販促エリア */
const AREAS = {
  NAGOYA: '名古屋',
  REMOTE: '遠方',
  TOKYO:  '東京',
};

// ============================================================
// ランク定義
// ============================================================

/** @enum {string} kintone側のランク値 → スプレッドシート表示値 マッピング */
const RANK_MAP = {
  '不明':   'B-D',
  '長期追客': 'C',
  '見込み無': 'D',
  '見込み小': 'B-C',
  '見込み中': 'B-B',
  '見込み大': 'B-A',
  '成約':   'A',
};

// ============================================================
// 商談ステータス定義
// ============================================================

/** @enum {string} 商談状況の正規値 */
const NEGO_STATUS_PASS_THROUGH = ['長期追客', '追客中', '追客終了'];

// ============================================================
// 日付ルール定義
// ============================================================

/**
 * 何日以降なら「翌月」扱いにするか
 * @type {number}
 */
const MONTH_ROLLOVER_DAY = 21;

/**
 * 何月・何日以降なら「翌年」扱いにするか
 * @type {{ month: number, day: number }}
 */
const YEAR_ROLLOVER = { month: 12, day: 21 };

// ============================================================
// デバッグ設定
// ============================================================

/** @type {boolean} デバッグログ出力フラグ */
const DEBUG_MODE = PropertiesService.getScriptProperties().getProperty('DEBUG_MODE') === 'true';

// ============================================================
// 一覧シート列定義 — 顧客情報（CUSTOMER_APP_ID）
// ============================================================

/**
 * 顧客情報一覧シートの列インデックスマップ（1始まり）
 * @enum {number}
 */
const CUSTOMER_LIST_COLS = {
  YEAR:             1,   // 反響年
  MONTH:            2,   // 反響月
  RANK:             3,   // ランク（見込み度）
  LIKEHOOD:         4,   // 見込度
  // 5: 予備
  CUSTOMER_NAME:    6,   // お客様名
  FIRST_APPOINT:    7,   // 初回アポイント
  INQUIRY_DATE:     8,   // 反響日
  INFO_ROUTE:       9,   // 反響媒体
  // 10: 予備
  MANAGER:          11,  // 担当者
  // 12-21: 予備
  AGE:              22,  // 年齢
  CURRENT_RESIDENCE:23,  // 住居形態
  // 24-26: 予備
  FAMILY_MEMBER:    27,  // 家族数
};

// ============================================================
// 一覧シート列定義 — 営業・商談管理（SALES_APP_ID）
// ============================================================

/**
 * 営業・商談管理一覧シートの列インデックスマップ（1始まり）
 * @enum {number}
 */
const SALES_LIST_COLS = {
  YEAR:                 1,   // 反響年
  MONTH:                2,   // 反響月
  RANK:                 3,   // 現在のランク
  LIKEHOOD:             4,   // 見込み（商談ステータス）
  MTG_COUNT:            5,   // 来場回数
  CUSTOMER_NAME:        6,   // お客様名
  // 7: 予備
  INQUIRY_DATE:         8,   // 反響日
  // 9: 予備
  CONSULTATION_CONTENT: 10,  // 相談内容
  MANAGER:              11,  // 担当者
  LATEST_FOLLOWUP:      12,  // 最新追客日
  MTG_DAY_1:            13,  // 1回目の商談日
  MTG_DAY_2:            14,  // 2回目の商談日
  MTG_DAY_3:            15,  // 3回目の商談日
  NEXT_APPT:            16,  // 次アポ
  LAND_ATTRIBUTES:      17,  // 物件（土地）の有無
  PREFECTURE:           18,  // 希望エリア（都道府県）
  CITY:                 19,  // 希望エリア（市・区）
  TOWN:                 20,  // 希望エリア（町・村）
  AREA:                 21,  // 希望エリア（それ以降）
  // 22: 予備
  CURRENT_RESIDENCE:    23,  // 住居形態（一般住宅・新築のみ）
  WORK_PLACE:           24,  // 勤務先
  INDUSTRY:             25,  // 業種
  OCCUPATION:           26,  // 職業
  FAMILY_MEMBER:        27,  // 家族数
  INCOME:               28,  // 年収
  SELF_FUNDED:          29,  // 自己資金
  // 30-37: 顧客種別によって用途が変わる列（下記参照）
};

/**
 * 一般住宅・新築の追加列（SALES_LIST_COLSの30以降）
 * @enum {number}
 */
const RESIDENTIAL_EXTRA_COLS = {
  WORK_PLACE_SUB: 30,  // 収入合算者勤務先
  INCOME_SUB:     31,  // 収入合算者年収
  FIRST_ACQUIRER: 32,  // 一次取得（物件なし）
  OWN_HOUSE:      33,  // 持家（物件あり）
  PARENTAL_HOME:  34,  // 実家リノベ
  REASON:         35,  // 理由
  EVENT:          36,  // イベント
};

/**
 * 店舗・賃貸・その他の追加列（SALES_LIST_COLSの30以降）
 * @enum {number}
 */
const BUSINESS_EXTRA_COLS = {
  HOPE_TYPE_A:    30,  // 希望種別A（入居希望/独立など）
  HOPE_TYPE_B:    31,  // 希望種別B（大家/既存など）
  HOPE_TYPE_C:    32,  // 希望種別C（紹介/新店舗など）
  JOB_TITLE:      33,  // 反響役職
  HOPE_BUSINESS:  34,  // 業態
  CAPITAL_STOCK:  35,  // 資本金
  REASON:         36,  // 理由
  EVENT:          37,  // イベント
};

// ============================================================
// シート名テンプレート
// ============================================================

/**
 * 一覧シート名を生成するテンプレート関数
 * @param {string} area - 販促エリア（例: "名古屋"）
 * @param {string} customerType - 顧客種別（例: "一般住宅"）
 * @returns {string} シート名（例: "名古屋-一般住宅"）
 */
function buildListSheetName(area, customerType) {
  return `${area}-${customerType}`;
}

// ============================================================
// シートデータ行列位置定数
// ============================================================

/**
 * シートデータのインデックスオフセット
 * getValues()は0始まりの配列を返すが、スプレッドシートの行番号は1始まり
 * unshift()でダミー行を先頭に追加しているため、配列インデックス=行番号となる
 */
const SHEET_ROW_OFFSET = 1;

/**
 * シートデータにおける年・月の列インデックス（0始まり）
 * yearMatchingRows, monthMatchingRows の検索で使用
 */
const LIST_COL_INDEX = {
  YEAR:          0,   // A列 = インデックス0
  MONTH:         1,   // B列 = インデックス1
  RANK:          2,   // C列 = インデックス2
  CUSTOMER_NAME: 5,   // F列 = インデックス5
};
