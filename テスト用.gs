// /**
//  * 18集計シートの読み取り専用監査。
//  *
//  * 確認対象:
//  * - 進捗（反響、来場、再来、3回目以上、成約）
//  * - 月別反響数
//  * - 18組の一覧/集計シートと年度列の存在
//  * - 一覧/集計シートの読み取り時間
//  *
//  * シートへの書き込み、Webhook送信、行追加、修復は一切行わない。
//  */

// const AUDIT_SPREADSHEET_ID =
//   PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');

// const AUDIT_TARGETS = [
//   ['名古屋-一般住宅', '【一般住宅】名古屋'],
//   ['名古屋-小型店舗', '【小型店舗】名古屋'],
//   ['名古屋-エイトトレーラー', '【エイトトレーラー】名古屋'],
//   ['名古屋-オフィス', '【オフィス】名古屋'],
//   ['名古屋-新築', '【新築】名古屋'],
//   ['名古屋-工場・倉庫', '【工場・倉庫】名古屋'],
//   ['名古屋-医療福祉', '【医療福祉】名古屋'],
//   ['名古屋-賃貸', '【賃貸】名古屋'],
//   ['名古屋-みせいえ', '【みせいえ】名古屋'],
//   ['東京-一般住宅', '【一般住宅】東京'],
//   ['東京-小型店舗', '【小型店舗】東京'],
//   ['東京-エイトトレーラー', '【エイトトレーラー】東京'],
//   ['東京-オフィス', '【オフィス】東京'],
//   ['東京-新築', '【新築】東京'],
//   ['東京-工場・倉庫', '【工場・倉庫】東京'],
//   ['東京-医療福祉', '【医療福祉】東京'],
//   ['東京-賃貸', '【賃貸】東京'],
//   ['東京-みせいえ', '【みせいえ】東京'],
// ];

// const AUDIT_COL = {
//   YEAR: 0,
//   MONTH: 1,
//   RANK: 2,
//   FIRST_VISIT: 12,
//   SECOND_VISIT: 13,
//   THIRD_VISIT: 14,
// };

// const AUDIT_PROGRESS_HEADER_ROW = 34;
// const AUDIT_PROGRESS_START_ROW = 35;
// const AUDIT_MONTHLY_HEADER_ROW = 69;
// const AUDIT_MONTHLY_START_ROW = 70;

// /**
//  * エディタからこの関数を実行する。
//  * 結果は「実行ログ」にJSONで出力される。
//  */
// function auditAllDomainAggregations() {
//   if (!AUDIT_SPREADSHEET_ID) {
//     throw new Error('Script Properties の SPREADSHEET_ID が未設定です。');
//   }

//   const startedAt = Date.now();
//   const ss = SpreadsheetApp.openById(AUDIT_SPREADSHEET_ID);
//   const results = AUDIT_TARGETS.map(function (pair) {
//     return auditOneDomain_(ss, pair[0], pair[1]);
//   });

//   const mismatches = results.reduce(function (sum, result) {
//     return sum + result.mismatchCount;
//   }, 0);

//   const report = {
//     mode: 'READ_ONLY',
//     spreadsheetId: AUDIT_SPREADSHEET_ID,
//     targetCount: AUDIT_TARGETS.length,
//     mismatchCount: mismatches,
//     elapsedMs: Date.now() - startedAt,
//     results: results,
//   };

//   console.log(JSON.stringify(report, null, 2));
//   return report;
// }

// function auditOneDomain_(ss, listSheetName, graphSheetName) {
//   const pairStartedAt = Date.now();
//   const listSheet = ss.getSheetByName(listSheetName);
//   const graphSheet = ss.getSheetByName(graphSheetName);

//   if (!listSheet || !graphSheet) {
//     return {
//       listSheet: listSheetName,
//       graphSheet: graphSheetName,
//       status: 'MISSING_SHEET',
//       missingListSheet: !listSheet,
//       missingGraphSheet: !graphSheet,
//       mismatchCount: 1,
//       elapsedMs: Date.now() - pairStartedAt,
//     };
//   }

//   const listReadStartedAt = Date.now();
//   const listValues = listSheet.getDataRange().getValues();
//   const listReadMs = Date.now() - listReadStartedAt;

//   const graphReadStartedAt = Date.now();
//   const graphLastColumn = graphSheet.getLastColumn();
//   const graphValues = graphSheet
//     .getRange(
//       AUDIT_PROGRESS_HEADER_ROW,
//       1,
//       AUDIT_MONTHLY_START_ROW + 12 - AUDIT_PROGRESS_HEADER_ROW,
//       graphLastColumn
//     )
//     .getValues();
//   const graphReadMs = Date.now() - graphReadStartedAt;

//   const calcStartedAt = Date.now();
//   const expectedByYear = buildExpectedCore_(listValues);
//   const progressHeader = graphValues[0] || [];
//   const monthlyHeader =
//     graphValues[AUDIT_MONTHLY_HEADER_ROW - AUDIT_PROGRESS_HEADER_ROW] || [];
//   const yearResults = [];

//   Object.keys(expectedByYear).sort().forEach(function (year) {
//     const expected = expectedByYear[year];
//     const progressColumn = progressHeader.indexOf(year);
//     const monthlyColumn = monthlyHeader.indexOf(year);

//     if (progressColumn === -1 || monthlyColumn === -1) {
//       yearResults.push({
//         year: year,
//         status: 'MISSING_YEAR_COLUMN',
//         progressColumnFound: progressColumn !== -1,
//         monthlyColumnFound: monthlyColumn !== -1,
//       });
//       return;
//     }

//     const actualProgress = [];
//     for (let offset = 0; offset < 5; offset++) {
//       const rowIndex =
//         AUDIT_PROGRESS_START_ROW + offset - AUDIT_PROGRESS_HEADER_ROW;
//       actualProgress.push(Number(graphValues[rowIndex][progressColumn] || 0));
//     }

//     const actualMonthly = [];
//     for (let offset = 0; offset < 12; offset++) {
//       const rowIndex =
//         AUDIT_MONTHLY_START_ROW + offset - AUDIT_PROGRESS_HEADER_ROW;
//       actualMonthly.push(Number(graphValues[rowIndex][monthlyColumn] || 0));
//     }

//     const expectedProgress = [
//       expected.response,
//       expected.firstVisit,
//       expected.secondVisit,
//       expected.thirdVisit,
//       expected.closed,
//     ];

//     const progressDiffs = diffArray_(expectedProgress, actualProgress);
//     const monthlyDiffs = diffArray_(expected.monthly, actualMonthly);

//     yearResults.push({
//       year: year,
//       status:
//         progressDiffs.length === 0 && monthlyDiffs.length === 0
//           ? 'MATCH'
//           : 'MISMATCH',
//       expectedProgress: expectedProgress,
//       actualProgress: actualProgress,
//       progressDiffs: progressDiffs,
//       monthlyDiffs: monthlyDiffs,
//     });
//   });

//   const mismatchCount = yearResults.filter(function (result) {
//     return result.status !== 'MATCH';
//   }).length;

//   return {
//     listSheet: listSheetName,
//     graphSheet: graphSheetName,
//     status: mismatchCount === 0 ? 'MATCH' : 'MISMATCH',
//     listRowCount: listValues.length,
//     listColumnCount: listValues[0] ? listValues[0].length : 0,
//     graphColumnCount: graphLastColumn,
//     listReadMs: listReadMs,
//     graphReadMs: graphReadMs,
//     calculationMs: Date.now() - calcStartedAt,
//     elapsedMs: Date.now() - pairStartedAt,
//     mismatchCount: mismatchCount,
//     years: yearResults,
//   };
// }

// function buildExpectedCore_(rows) {
//   const result = {};

//   for (let index = 1; index < rows.length; index++) {
//     const row = rows[index];
//     const year = String(row[AUDIT_COL.YEAR] || '');
//     if (!/^20\d{2}年$/.test(year)) continue;

//     if (!result[year]) {
//       result[year] = {
//         response: 0,
//         firstVisit: 0,
//         secondVisit: 0,
//         thirdVisit: 0,
//         closed: 0,
//         monthly: new Array(12).fill(0),
//       };
//     }

//     const counts = result[year];
//     counts.response++;
//     if (row[AUDIT_COL.FIRST_VISIT] !== '') counts.firstVisit++;
//     if (row[AUDIT_COL.SECOND_VISIT] !== '') counts.secondVisit++;
//     if (row[AUDIT_COL.THIRD_VISIT] !== '') counts.thirdVisit++;
//     if (row[AUDIT_COL.RANK] === 'A') counts.closed++;

//     const month = parseInt(String(row[AUDIT_COL.MONTH]), 10);
//     if (month >= 1 && month <= 12) counts.monthly[month - 1]++;
//   }

//   return result;
// }

// function diffArray_(expected, actual) {
//   const diffs = [];
//   const length = Math.max(expected.length, actual.length);

//   for (let index = 0; index < length; index++) {
//     if (Number(expected[index]) !== Number(actual[index])) {
//       diffs.push({
//         index: index,
//         expected: expected[index],
//         actual: actual[index],
//       });
//     }
//   }

//   return diffs;
// }
