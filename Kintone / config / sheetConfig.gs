/**
 * sheetConfig.gs
 * シート列構造の定義
 * 列追加時の影響を局所化し、位置依存コードを排除する
 */

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

/**
 * グラフシート名を生成するテンプレート関数
 * @param {string} customerType - 顧客種別（例: "一般住宅"）
 * @param {string} area - 販促エリア（例: "名古屋"）
 * @returns {string} シート名（例: "【一般住宅】名古屋"）
 */
function buildGraphSheetName(customerType, area) {
  return `【${customerType}】${area}`;
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

// ============================================================
// 顧客種別をフォーマット
// ============================================================
/**
 * 顧客種別をフォーマットする
 * @param {string} rawType - 生の顧客種別文字列
 * @return {string} フォーマット後の顧客種別
 */
function formatCustomerType(rawType) {
  if (rawType.includes("住宅")) return "一般住宅";
  else if (rawType.includes("店舗")) return "小型店舗";
  else if (rawType.includes("オフィス")) return "オフィス";
  else if (rawType.includes("トレーラー")) return "エイトトレーラー";
  else if (rawType.includes("医療福祉")) return "医療福祉";
  else if (rawType.includes("工場")) return "工場・倉庫";
  else if (rawType.includes("みせいえ")) return "みせいえ";
  else if (rawType.includes("賃貸")) return "賃貸";
  else if (rawType.includes("新築") || rawType.includes("BinO")) return "新築";
  return "";
}
