/**
 * sheets.gs — スプレッドシートI/O（旧 sheetFinder.gs + sheetWriter.gs）
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
// 対象シート取得
// ============================================================

/**
 * 顧客種別と販促エリアに応じた一覧シートを取得する
 * @param {string} customerType - 正規化済み顧客種別（normalizeCustomerType の戻り値）
 * @param {string} promotionArea - 正規化済み販促エリア（normalizePromotionArea の戻り値）
 * @returns {Sheet|null} 一覧シート。対応エリアが無ければ null
 */
function getListSheet(customerType, promotionArea) {
  const sheetArea = _resolveSheetArea(promotionArea);

  if (!sheetArea) {
    AppLogger.warn('対応するシートエリアが見つかりません', { promotionArea, customerType });
    return null;
  }

  const listSheetName = buildListSheetName(sheetArea, customerType);
  return getSheetByName(listSheetName);
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

// ============================================================
// 一覧横断の顧客名出現確認（安定ID移行前の安全ゲート）
// ============================================================

/**
 * 18一覧のF列を横断し、顧客名が完全一致する行をすべて返す。
 * 安定ID導入前に、別target残存や同名複数を成功扱いにしないための検査専用。
 *
 * @param {string} customerName
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [spreadsheet]
 * @returns {Array<{listSheetName: string, rowIndex: number}>}
 */
function findCustomerOccurrencesAcrossLists(customerName, spreadsheet) {
  assertNonEmptyString(customerName, 'customerName');
  const ss = spreadsheet || getSpreadsheet();
  const occurrences = [];
  const seenSheetNames = new Set();

  for (const area of AGG_AREAS) {
    for (const domain of AGG_DOMAINS) {
      const listSheetName = buildListSheetName(area, domain.type);
      if (seenSheetNames.has(listSheetName)) {
        throw new Error(`一覧シート名が重複しています: ${listSheetName}`);
      }
      seenSheetNames.add(listSheetName);

      const sheet = ss.getSheetByName(listSheetName);
      if (!sheet) {
        throw new Error(`一覧横断確認の対象シートが見つかりません: ${listSheetName}`);
      }

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) continue;
      const names = sheet
        .getRange(2, LIST_COL_INDEX.CUSTOMER_NAME + 1, lastRow - 1, 1)
        .getValues();
      for (let rowOffset = 0; rowOffset < names.length; rowOffset++) {
        if (names[rowOffset][0] === customerName) {
          occurrences.push({
            listSheetName,
            rowIndex: rowOffset + 2,
          });
        }
      }
    }
  }

  if (seenSheetNames.size !== 18) {
    throw new Error(`一覧横断確認の対象が18枚ではありません: ${seenSheetNames.size}`);
  }
  return occurrences;
}

// ============================================================
// 書き込み計画の算出（純粋関数・Range I/O なし）
// ============================================================

/**
 * 書き込み計画（どの行にどう書くか）を算出する。純粋関数（シート未変更）。
 * 行特定ロジック:
 *   顧客名一致 → 対象月ブロック末尾直下 → 対象年ブロック末尾直下 → 末尾に新規行を追加。
 *
 * 対象年ブロックが存在しない場合も、既存の末尾行を上書きせず末尾へ新規行を追加する
 * （反響年・反響月は colData に含まれるため、挿入行へそのまま書き込まれる）。
 *
 * @param {Array<Array<*>>} listData - getFormattedSheetData() の戻り値（0番目ダミー行あり）
 * @param {string} customerName - お客様名
 * @param {string} targetYear - 問い合わせ年（例: "2025年"）
 * @param {string} targetMonth - 問い合わせ月（例: "3月"）
 * @param {Array<{ col: number, value: * }>} colDataArray - 列インデックス（1始まり）と値
 * @returns {{
 *   rowIndex: number,
 *   insertAfterRow: (number|null),
 *   setMonth: boolean,
 *   month: string,
 *   colData: Array<{ col: number, value: * }>,
 * }}
 */
function planRowWrite(listData, customerName, targetYear, targetMonth, colDataArray) {
  let rowIndex        = -1;
  let insertAfterRow  = null;
  let setMonth        = false;

  // ── 既存行の検索（顧客名一致）─────────────────────────────
  for (let i = 1; i < listData.length; i++) {
    if (listData[i][LIST_COL_INDEX.CUSTOMER_NAME] === customerName) {
      rowIndex = i;
      break;
    }
  }

  if (rowIndex === -1) {
    // ── 年・月ブロックの特定 ────────────────────────────────
    const yearRows  = [];
    const monthRows = [];
    for (let i = 1; i < listData.length; i++) {
      if (listData[i][LIST_COL_INDEX.YEAR] === targetYear) {
        yearRows.push(i);
        if (listData[i][LIST_COL_INDEX.MONTH] === targetMonth) monthRows.push(i);
      }
    }

    if (monthRows.length > 0) {
      insertAfterRow = monthRows[monthRows.length - 1];   // 対象月ブロック末尾直下
      rowIndex       = insertAfterRow + 1;
    } else if (yearRows.length > 0) {
      insertAfterRow = yearRows[yearRows.length - 1];      // 対象年ブロック末尾直下
      rowIndex       = insertAfterRow + 1;
      setMonth       = true;                               // 月セルを設定
    } else {
      insertAfterRow = listData.length - 1;                // 対象年なし → 末尾へ新規行を追加
      rowIndex       = listData.length;                    // （既存末尾行は上書きしない）
    }
  }

  return { rowIndex, insertAfterRow, setMonth, month: targetMonth, colData: colDataArray };
}

// ============================================================
// 書き込み計画の適用（Range I/O）
// ============================================================

/**
 * 書き込み計画を実シートへ適用する。
 * 従来の findOrCreateRow（挿入・月セル設定）＋ updateRowData と同一の物理効果。
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {ReturnType<typeof planRowWrite>} plan
 */
function applyRowWrite(sheet, plan) {
  if (plan.insertAfterRow !== null) {
    sheet.insertRowAfter(plan.insertAfterRow);
    AppLogger.info('新規行を挿入', { afterRow: plan.insertAfterRow, row: plan.rowIndex });
    if (plan.setMonth) {
      sheet.getRange(plan.rowIndex, LIST_COL_INDEX.MONTH + 1).setValue(plan.month);
    }
  }
  updateRowData(sheet, plan.rowIndex, plan.colData);
}

// ============================================================
// 行書き込み（Range I/O）
// ============================================================

/**
 * 指定行の「指定列のみ」を更新する。
 * 行全体の読み書きはせず、対象列だけを書き込むため、対象外の列に設定された
 * 数式・値には一切触れない（数式が評価済みの値へ置換される問題を防ぐ）。
 * 連続する列はまとめて setValues し、API 呼び出し回数を抑える。
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - 書き込み対象シート
 * @param {number} rowIndex - 書き込み行番号（1始まり）
 * @param {Array<{ col: number, value: * }>} colDataArray - 列インデックス（1始まり）と値のペア配列
 */
function updateRowData(sheet, rowIndex, colDataArray) {
  assertNotNull(sheet, 'sheet');
  assertNotNull(rowIndex, 'rowIndex');
  assertArray(colDataArray, 'colDataArray');

  const timer   = AppLogger.startTimer(`updateRowData: row=${rowIndex}`);
  const lastCol = sheet.getLastColumn();

  // 対象列を col→value に集約（重複列は後勝ち＝従来の行配列上書きと同じ優先順位）
  const byCol = new Map();
  for (const { col, value } of colDataArray) {
    if (col >= 1 && col <= lastCol) {
      byCol.set(col, value ?? '');
    } else {
      AppLogger.warn(`列インデックスが範囲外です: col=${col}, lastCol=${lastCol}`);
    }
  }

  // 連続する列をまとめて setValues（対象外の列＝数式セル等には触れない）
  const cols = [...byCol.keys()].sort((a, b) => a - b);
  let writeCount = 0;
  let i = 0;
  while (i < cols.length) {
    let j = i;
    while (j + 1 < cols.length && cols[j + 1] === cols[j] + 1) j++;
    const startCol   = cols[i];
    const rowSegment = [];
    for (let c = startCol; c <= cols[j]; c++) rowSegment.push(byCol.get(c));
    sheet.getRange(rowIndex, startCol, 1, rowSegment.length).setValues([rowSegment]);
    writeCount++;
    i = j + 1;
  }

  timer.stop();
  AppLogger.debug('行データを更新しました', { row: rowIndex, updatedCols: byCol.size, writes: writeCount });
}

// ============================================================
// 顧客情報書き込みエントリポイント
// ============================================================

/**
 * 顧客情報を一覧シートに書き込む
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} listSheet - 一覧シート
 * @param {Array<Array<*>>} sheetData - getFormattedSheetData() の戻り値
 * @param {Array<{ col: number, value: * }>} rowData - buildCustomerRowData() の戻り値
 * @param {string} customerName - お客様名
 * @param {string} targetYear - 問い合わせ年
 * @param {string} targetMonth - 問い合わせ月
 * @returns {ReturnType<typeof planRowWrite>} 書き込み計画
 */
function writeCustomerRecord(listSheet, sheetData, rowData, customerName, targetYear, targetMonth) {
  const plan = planRowWrite(sheetData, customerName, targetYear, targetMonth, rowData);
  applyRowWrite(listSheet, plan);
  AppLogger.info('顧客情報を書き込みました', { row: plan.rowIndex, customerName });
  return plan;
}

// ============================================================
// 営業・商談管理書き込みエントリポイント
// ============================================================

/**
 * 営業・商談管理データを一覧シートに書き込む
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} listSheet - 一覧シート
 * @param {Array<Array<*>>} sheetData - getFormattedSheetData() の戻り値
 * @param {Array<{ col: number, value: * }>} rowData - buildSalesRowData() の戻り値
 * @param {string} customerName - お客様名
 * @param {string} targetYear - 問い合わせ年
 * @param {string} targetMonth - 問い合わせ月
 * @returns {ReturnType<typeof planRowWrite>} 書き込み計画
 */
function writeSalesRecord(listSheet, sheetData, rowData, customerName, targetYear, targetMonth) {
  const plan = planRowWrite(sheetData, customerName, targetYear, targetMonth, rowData);
  applyRowWrite(listSheet, plan);
  AppLogger.info('営業データを書き込みました', { row: plan.rowIndex, customerName });
  return plan;
}
