/**
 * sheetFinder.gs
 * スプレッドシートアクセス管理
 * IDや名前変更に強くし、他層から直接SpreadsheetAppを呼ばせない
 */

// ============================================================
// スプレッドシート取得（シングルトンキャッシュ）
// ============================================================

/** @type {GoogleAppsScript.Spreadsheet.Spreadsheet|null} */
let _cachedSpreadsheet = null;

/**
 * メインスプレッドシートを取得する
 * 同一実行内では初回取得後にキャッシュされたオブジェクトを返す
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 * @throws {Error} SPREADSHEET_ID が未設定の場合
 */
function getSpreadsheet() {
  if (_cachedSpreadsheet) return _cachedSpreadsheet;

  assertNonEmptyString(SPREADSHEET_ID, 'SPREADSHEET_ID');
  _cachedSpreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  AppLogger.debug('スプレッドシートを取得しました', { spreadsheetId: SPREADSHEET_ID });
  return _cachedSpreadsheet;
}

// ============================================================
// シートキャッシュ
// ============================================================

/** @type {Map<string, GoogleAppsScript.Spreadsheet.Sheet|null>} シート名→Sheetオブジェクトのキャッシュ */
const _sheetCache = new Map();

/**
 * シート名からシートオブジェクトを取得する（キャッシュ付き）
 * @param {string} sheetName - シート名
 * @returns {GoogleAppsScript.Spreadsheet.Sheet|null} シートオブジェクト。存在しなければnull
 */
function getSheetByName(sheetName) {
  if (_sheetCache.has(sheetName)) return _sheetCache.get(sheetName);

  const ss    = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName) ?? null;
  _sheetCache.set(sheetName, sheet);

  if (!sheet) {
    AppLogger.warn(`シートが見つかりません: "${sheetName}"`);
  } else {
    AppLogger.debug(`シートを取得しました: "${sheetName}"`);
  }

  return sheet;
}

/**
 * キャッシュをリセットする（テスト用・再取得が必要な場合）
 */
function clearSheetCache() {
  _sheetCache.clear();
  _cachedSpreadsheet = null;
}

// ============================================================
// 対象シートペア取得
// ============================================================

/**
 * 顧客種別と販促エリアに応じた一覧シートとグラフシートを取得する
 * @param {string} customerType - 正規化済み顧客種別（normalizeCustomerType の戻り値）
 * @param {string} promotionArea - 正規化済み販促エリア（normalizePromotionArea の戻り値）
 * @returns {{ listSheet: Sheet|null, graphSheet: Sheet|null }}
 */
function getTargetSheets(customerType, promotionArea) {
  const sheetArea = _resolveSheetArea(promotionArea);

  if (!sheetArea) {
    AppLogger.warn('対応するシートエリアが見つかりません', { promotionArea, customerType });
    return { listSheet: null, graphSheet: null };
  }

  const listSheetName  = buildListSheetName(sheetArea, customerType);
  const graphSheetName = buildGraphSheetName(customerType, sheetArea);

  return {
    listSheet:  getSheetByName(listSheetName),
    graphSheet: getSheetByName(graphSheetName),
  };
}

/**
 * 販促エリアをシート名で使用する「エリア文字列」に解決する
 * 「遠方」は「名古屋」シートに集約
 * @param {string} area - 正規化済みの販促エリア
 * @returns {string|null} シート名用エリア文字列。対応なければnull
 */
function _resolveSheetArea(area) {
  if (area === AREAS.NAGOYA || area === AREAS.REMOTE) return AREAS.NAGOYA;
  if (area === AREAS.TOKYO) return AREAS.TOKYO;
  return null;
}

// ============================================================
// シートデータ取得
// ============================================================

/**
 * シートの全データを取得し、Dateオブジェクトを "MM月DD日" 形式の文字列に変換する
 * 先頭にダミー行（空配列）をunshiftし、配列インデックス=スプレッドシート行番号となるよう調整する
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - 取得対象のシート
 * @returns {Array<Array<*>>} フォーマット済みシートデータ（0番目はダミー行）
 */
function getFormattedSheetData(sheet) {
  assertNotNull(sheet, 'sheet');
  const timer = AppLogger.startTimer(`getFormattedSheetData: ${sheet.getName()}`);

  const values = sheet.getDataRange().getValues();
  const tz     = Session.getScriptTimeZone();

  // Dateオブジェクトを文字列に変換
  for (let i = 0; i < values.length; i++) {
    for (let j = 0; j < values[i].length; j++) {
      if (values[i][j] instanceof Date) {
        values[i][j] = Utilities.formatDate(values[i][j], tz, 'MM月dd日');
      }
    }
  }

  // インデックス=行番号となるようダミー行を先頭に追加
  values.unshift(["",""]);

  timer.stop();
  return values;
}