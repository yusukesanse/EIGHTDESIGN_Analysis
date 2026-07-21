// // ============================================================
// // graph/calcAllMonthly.gs
// // ============================================================

// /**
//  * 全ドメインシートの月別反響数を更新して書き込む
//  * @param {Object} config
//  */
// function calcAllMonthly(config) {
//   try {
//     // ── 1. 対象年度の列インデックスを取得 ─────────────────────
//     const graphColIdx = _findYearColIdx(config.graphData, ALL_MONTHLY_YEAR_ROW, config.inquiryYear);

//     // ── 2. エリア別月別データを取得 ───────────────────────────
//     const promoArea = normalizePromotionArea(config.record.promotion_area.value);
//     const areaData  = _getAreaMonthly(promoArea, config.graphData, config.unmatchData, graphColIdx);

//     // ── 3. 名古屋・東京の月別合計を生成 ──────────────────────
//     const resultData = Array.from(
//       { length: ALL_MONTHLY_MONTHS },
//       (_, i) => [areaData.nagoya[i] + areaData.tokyo[i]]
//     );

//     // ── 4. 顧客種別シートへ書き込み ───────────────────────────
//     const headerColIdx = _findYearColIdx(
//       config.allDomainData, config.headerRow.monthHeader, config.inquiryYear
//     );
//     _assertColIdx(headerColIdx, 'calcAllMonthly', config);

//     config.allDomainSheet
//       .getRange(
//         config.headerRow.monthHeader + 1,
//         headerColIdx + 1,
//         resultData.length, 1
//       )
//       .setValues(resultData);

//     // ── 5. 全ドメイン月別の後処理 ─────────────────────────────
//     _aggregateAllDomainMonthly(config);

//   } catch (e) {
//     handleError(e.stack, e.message, 'calcAllMonthly',
//       config.record.customer_name.value, config.record.customer_type.value);
//   }
// }

// // ============================================================
// // エリア別月別データ取得
// // ============================================================

// /**
//  * 販促エリアに基づき、グラフシートとアンマッチシートをエリアに振り分けて月別配列を返す
//  * 名古屋・遠方の場合: graphData = 名古屋側、unmatchedData = 東京側
//  * 東京の場合:         graphData = 東京側、  unmatchedData = 名古屋側
//  * @param {string} promoArea - 変換済み販促エリア
//  * @param {Array<Array<*>>} graphData     - 現在のウェブフックレコードが所属するシートのデータ
//  * @param {Array<Array<*>>} unmatchedData - アンマッチシート（反対エリア）のデータ
//  * @param {number} colIdx
//  * @returns {{ nagoya: number[], tokyo: number[] }}
//  */
// function _getAreaMonthly(promoArea, graphData, unmatchedData, colIdx) {
//   const graphMonthly   = _extractMonthlyData(graphData,     colIdx);
//   const unmatchMonthly = _extractMonthlyData(unmatchedData, colIdx);

//   const isNagoyaSide = promoArea === '名古屋' || promoArea === '遠方';
//   return {
//     nagoya: isNagoyaSide ? graphMonthly   : unmatchMonthly,
//     tokyo:  isNagoyaSide ? unmatchMonthly : graphMonthly,
//   };
// }

// /**
//  * 2次元配列データの指定列から月別データ行を抽出する
//  * @param {Array<Array<*>>} data
//  * @param {number} colIdx
//  * @returns {number[]}
//  */
// function _extractMonthlyData(data, colIdx) {
//   return data
//     .slice(ALL_MONTHLY_DATA_ROWS.from, ALL_MONTHLY_DATA_ROWS.to)
//     .map(row => Number(row[colIdx]) || 0);
// }

// // ============================================================
// // 後処理: 全ドメイン月別集計
// // ============================================================

// /**
//  * 全ドメインシートの各顧客種別月別データを合算し、全ドメイン行へ書き込む
//  * calcAllMonthly 書き込み後に最新データを再取得して集計する
//  * @param {Object} config
//  */
// function _aggregateAllDomainMonthly(config) {
//   // 書き込み後の最新データを再取得
//   const freshData  = getFormattedSheetData(config.allDomainSheet);
//   const firstCol   = freshData.map(row => row[0]);

//   // 全ドメイン以外の各顧客種別の月別ヘッダー行を収集
//   const headerRows = _findProgressHeaderRows(
//     firstCol,
//     ALL_DOMAIN_MONTHLY_KEYWORD,
//     ALL_DOMAIN_MONTHLY_ANTI_KEYWORD
//   );

//   if (headerRows.length === 0) {
//     AppLogger.warn('_aggregateAllDomainMonthly: 月別ヘッダー行が見つかりません');
//     return;
//   }

//   // 各顧客種別の月別列値を収集
//   const monthlyResults = headerRows.map(rowIdx => {
//     const colIdx = _findYearColIdx(freshData, rowIdx, config.inquiryYear);
//     return freshData
//       .slice(rowIdx + 1, rowIdx + 1 + ALL_DOMAIN_MONTHLY_ROWS)
//       .map(row => Number(row[colIdx]) || 0);
//   });

//   // 行ごとに合算
//   const numRows    = monthlyResults[0].length;
//   const totalArray = Array.from({ length: numRows }, (_, i) =>
//     monthlyResults.reduce((sum, result) => sum + (result[i] ?? 0), 0)
//   );

//   // 来場率・歩留率を付加
//   const resultArray = [
//     ...totalArray,
//     _safeRatio(totalArray[MONTHLY_VISIT_IDX],  totalArray[0]),
//     _safeRatio(totalArray[MONTHLY_CLOSED_IDX], totalArray[MONTHLY_VISIT_IDX]),
//   ].map(v => [v]);

//   // 全ドメイン行へ書き込み
//   const headerColIdx = _findYearColIdx(
//     freshData, config.allDomainHeaderRow.monthHeader, config.inquiryYear
//   );
//   _assertColIdx(headerColIdx, '_aggregateAllDomainMonthly', config);

//   config.allDomainSheet
//     .getRange(
//       config.allDomainHeaderRow.monthHeader + 1,
//       headerColIdx + 1,
//       resultArray.length, 1
//     )
//     .setValues(resultArray);

//   AppLogger.debug('_aggregateAllDomainMonthly: 書き込み完了', {
//     monthHeader: config.allDomainHeaderRow.monthHeader,
//     headerColIdx,
//   });
// }