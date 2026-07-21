/**
 * constants.gs
 * 固定値の集中管理
 * ハードコード禁止・環境差異をここで吸収する
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