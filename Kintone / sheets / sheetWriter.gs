/**
 * sheetWriter.gs
 * シート書き込み専用層
 * Spreadsheet操作をここに集約し、書き込みロジックを一元管理する
 * setValues() を使いAPI呼び出しを最小化する
 */

// ============================================================
// 書き込みターゲット行の特定
// ============================================================

/**
 * お客様名に一致する行番号を返す
 * 一致しない場合は問い合わせ日の年・月ブロック内に新規行を挿入し、その行番号を返す
 *
 * @param {Array<Array<*>>} sheetData - getFormattedSheetData() の戻り値（0番目ダミー行あり）
 * @param {string} customerName - 検索するお客様名
 * @param {string} targetYear - 問い合わせ年（例: "2025年"）
 * @param {string} targetMonth - 問い合わせ月（例: "3月"）
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - 書き込み対象シート
 * @returns {number} 書き込み対象の行番号（1始まり）
 */
function findOrCreateRow(sheetData, customerName, targetYear, targetMonth, sheet) {
  // ── 既存行の検索 ──────────────────────────────────────────
  for (let i = 1; i < sheetData.length; i++) {
    if (sheetData[i][LIST_COL_INDEX.CUSTOMER_NAME] === customerName) {
      AppLogger.debug('既存行を検出', { row: i, customerName });
      return i;
    }
  }

  // ── 年・月ブロックの特定 ──────────────────────────────────
  const yearRows  = [];
  const monthRows = [];

  for (let i = 1; i < sheetData.length; i++) {
    if (sheetData[i][LIST_COL_INDEX.YEAR] === targetYear) {
      yearRows.push(i);
      if (sheetData[i][LIST_COL_INDEX.MONTH] === targetMonth) {
        monthRows.push(i);
      }
    }
  }

  // ── 新規行の挿入 ──────────────────────────────────────────
  if (monthRows.length > 0) {
    // 対象月ブロック末尾の直下に挿入
    const lastMonthRow = monthRows[monthRows.length - 1];
    sheet.insertRowAfter(lastMonthRow);
    AppLogger.info('対象月ブロックに新規行を挿入', { afterRow: lastMonthRow, customerName });
    return lastMonthRow + 1;
  }

  if (yearRows.length > 0) {
    // 対象年ブロック末尾の直下に挿入し、月セルを設定
    const lastYearRow = yearRows[yearRows.length - 1];
    sheet.insertRowAfter(lastYearRow);
    const newRow = lastYearRow + 1;
    sheet.getRange(newRow, LIST_COL_INDEX.MONTH + 1).setValue(targetMonth);
    AppLogger.info('対象年ブロックに新規行を挿入', { afterRow: lastYearRow, targetMonth, customerName });
    return newRow;
  }

  // 年・月いずれも存在しない場合は末尾を利用
  const fallbackRow = sheetData.length - 1; // ダミー行分を引いた実データ末尾
  AppLogger.warn('対象年月ブロック未検出。末尾行を使用', { row: fallbackRow, targetYear, targetMonth, customerName });
  return fallbackRow;
}

// ============================================================
// 行書き込み
// ============================================================

/**
 * 指定行の列データを一括で更新する
 * setValues() を1回のみ呼び出してAPI呼び出しを最小化する
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - 書き込み対象シート
 * @param {number} rowIndex - 書き込み行番号（1始まり）
 * @param {Array<{ col: number, value: * }>} colDataArray - 列インデックス（1始まり）と値のペア配列
 */
function updateRowData(sheet, rowIndex, colDataArray) {
  assertNotNull(sheet, 'sheet');
  assertNotNull(rowIndex, 'rowIndex');
  assertArray(colDataArray, 'colDataArray');

  const timer = AppLogger.startTimer(`updateRowData: row=${rowIndex}`);

  // 現在の行データを取得（1回のAPI呼び出し）
  const lastCol  = sheet.getLastColumn();
  const range    = sheet.getRange(rowIndex, 1, 1, lastCol);
  const rowValues = range.getValues()[0];

  // 更新対象の列のみ差し替え
  for (const { col, value } of colDataArray) {
    if (col >= 1 && col <= lastCol) {
      rowValues[col - 1] = value ?? '';
    } else {
      AppLogger.warn(`列インデックスが範囲外です: col=${col}, lastCol=${lastCol}`);
    }
  }

  // 1回のAPI呼び出しで書き込み（パフォーマンス最適化）
  range.setValues([rowValues]);

  timer.stop();
  AppLogger.debug('行データを更新しました', { row: rowIndex, updatedCols: colDataArray.length });
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
 */
function writeCustomerRecord(listSheet, sheetData, rowData, customerName, targetYear, targetMonth) {
  const rowIndex = findOrCreateRow(sheetData, customerName, targetYear, targetMonth, listSheet);
  updateRowData(listSheet, rowIndex, rowData);
  AppLogger.info('顧客情報を書き込みました', { row: rowIndex, customerName });
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
 */
function writeSalesRecord(listSheet, sheetData, rowData, customerName, targetYear, targetMonth) {
  const rowIndex = findOrCreateRow(sheetData, customerName, targetYear, targetMonth, listSheet);
  updateRowData(listSheet, rowIndex, rowData);
  AppLogger.info('営業データを書き込みました', { row: rowIndex, customerName });
}