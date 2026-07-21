// // ============================================================
// // graph/calcAllProgress.gs
// // ============================================================

// /**
//  * 全ドメインシートの顧客進捗データを更新して書き込む
//  * @param {Object} config
//  */
// function calcAllProgress(config) {
//   try {
//     // ── 1. 対象年度の列インデックスを取得 ─────────────────────
//     const graphColIdx    = _findYearColIdx(config.graphData, ALL_PROGRESS_YEAR_ROW, config.inquiryYear);

//     // ── 2. エリア別進捗データを取得 ───────────────────────────
//     const promoArea      = normalizePromotionArea(config.record.promotion_area.value);
//     const areaProgress   = _getAreaProgress(promoArea, config.graphData, config.unmatchData, graphColIdx);

//     // ── 3. 書き込みデータを生成 ───────────────────────────────
//     const progressResult = _buildProgressResult(areaProgress);

//     // ── 4. 顧客種別シートへ書き込み ───────────────────────────
//     const allDomainColIdx = _findYearColIdx(
//       config.allDomainData, config.headerRow.cxHeader, config.inquiryYear
//     );
//     _assertColIdx(allDomainColIdx, 'calcAllProgress', config);

//     config.allDomainSheet
//       .getRange(
//         config.headerRow.cxHeader + 1,
//         allDomainColIdx + 1,
//         progressResult.length, 1
//       )
//       .setValues(progressResult);

//     // ── 5. 全ドメイン集計の後処理 ─────────────────────────────
//     _aggregateAllDomainProgress(config);

//   } catch (e) {
//     handleError(e.stack, e.message, 'calcAllProgress',
//       config.record.customer_name.value, config.record.customer_type.value);
//   }
// }

// // ============================================================
// // エリア別進捗データ取得
// // ============================================================

// /**
//  * 販促エリアに基づき、グラフシートとアンマッチシートをエリアに振り分けて進捗オブジェクトを返す
//  * 名古屋・遠方の場合: graphData = 名古屋側、unmatchedData = 東京側
//  * 東京の場合:         graphData = 東京側、  unmatchedData = 名古屋側
//  * @param {string} promoArea - 変換済み販促エリア
//  * @param {Array<Array<*>>} graphData     - 現在のウェブフックレコードが所属するシートのデータ
//  * @param {Array<Array<*>>} unmatchedData - アンマッチシート（反対エリア）のデータ
//  * @param {number} colIdx
//  * @returns {{ nagoya: Object, tokyo: Object }}
//  */
// function _getAreaProgress(promoArea, graphData, unmatchedData, colIdx) {
//   const graphProgress     = _extractProgressData(graphData,     colIdx);
//   const unmatchedProgress = _extractProgressData(unmatchedData, colIdx);

//   const isNagoyaSide = promoArea === '名古屋' || promoArea === '遠方';
//   return {
//     nagoya: _toProgressObj(isNagoyaSide ? graphProgress     : unmatchedProgress),
//     tokyo:  _toProgressObj(isNagoyaSide ? unmatchedProgress : graphProgress),
//   };
// }

// /**
//  * 2次元配列データの指定列から進捗行を抽出する
//  * @param {Array<Array<*>>} data
//  * @param {number} colIdx
//  * @returns {Array<number>}
//  */
// function _extractProgressData(data, colIdx) {
//   return data
//     .slice(ALL_PROGRESS_DATA_ROWS.from, ALL_PROGRESS_DATA_ROWS.to)
//     .map(row => Number(row[colIdx]) || 0);
// }

// /**
//  * 進捗データ配列を PROGRESS_METRIC_KEYS でキー付きオブジェクトに変換する
//  * @param {Array<number>} array
//  * @returns {Object<string, number>}
//  */
// function _toProgressObj(array) {
//   return PROGRESS_METRIC_KEYS.reduce((obj, key, i) => {
//     obj[key] = Number(array[i]) || 0;
//     return obj;
//   }, {});
// }

// // ============================================================
// // 書き込みデータ生成
// // ============================================================

// /**
//  * エリア別進捗オブジェクトから全ドメインシートへの書き込み用2次元配列を生成する
//  * 順序: 合計・名古屋・東京 の3行ずつ × 5指標 + 率系15行 = 30行
//  * @param {{ nagoya: Object, tokyo: Object }} areaProgress
//  * @returns {Array<[number]>}
//  */
// function _buildProgressResult({ nagoya, tokyo }) {
//   const total = (key) => nagoya[key] + tokyo[key];
//   const r     = _safeRatio;

//   return [
//     [total('res')],   [nagoya.res],   [tokyo.res],
//     [total('vis')],   [nagoya.vis],   [tokyo.vis],
//     [total('reVis')], [nagoya.reVis], [tokyo.reVis],
//     [total('over')],  [nagoya.over],  [tokyo.over],
//     [total('close')], [nagoya.close], [tokyo.close],
//     [r(total('vis'),   total('res'))],
//     [r(nagoya.vis,     nagoya.res)],
//     [r(tokyo.vis,      tokyo.res)],
//     [r(total('reVis'), total('vis'))],
//     [r(nagoya.reVis,   nagoya.vis)],
//     [r(tokyo.reVis,    tokyo.vis)],
//     [r(total('over'),  total('vis'))],
//     [r(nagoya.over,    nagoya.vis)],
//     [r(tokyo.over,     tokyo.vis)],
//     [r(total('close'), total('vis'))],
//     [r(nagoya.close,   nagoya.vis)],
//     [r(tokyo.close,    tokyo.vis)],
//     [r(total('close'), total('reVis'))],
//     [r(nagoya.close,   nagoya.reVis)],
//     [r(tokyo.close,    tokyo.reVis)],
//   ];
// }

// // ============================================================
// // 後処理: 全ドメイン顧客進捗の集計
// // ============================================================

// /**
//  * 全ドメインシートの各顧客種別進捗を合算し、全ドメイン行へ書き込む
//  * calcAllProgress 書き込み後に最新データを再取得して集計する
//  * @param {Object} config
//  */
// function _aggregateAllDomainProgress(config) {
//   // 書き込み後の最新データを再取得
//   const freshData  = getFormattedSheetData(config.allDomainSheet);
//   const firstCol   = freshData.map(row => row[0]);

//   // 全ドメイン以外の各顧客種別の進捗ヘッダー行を収集
//   const headerRows = _findProgressHeaderRows(
//     firstCol,
//     ALL_DOMAIN_PROGRESS_KEYWORD,
//     ALL_DOMAIN_PROGRESS_ANTI_KEYWORD
//   );

//   if (headerRows.length === 0) {
//     AppLogger.warn('_aggregateAllDomainProgress: 進捗ヘッダー行が見つかりません');
//     return;
//   }

//   // 各顧客種別の進捗列値を収集
//   const progressResults = headerRows.map(rowIdx => {
//     const colIdx = _findYearColIdx(freshData, rowIdx, config.inquiryYear);
//     return freshData
//       .slice(rowIdx + 1, rowIdx + 1 + ALL_DOMAIN_PROGRESS_ROWS)
//       .map(row => Number(row[colIdx]) || 0);
//   });

//   // 行ごとに合算
//   const numRows    = progressResults[0].length;
//   const totalArray = Array.from({ length: numRows }, (_, i) =>
//     progressResults.reduce((sum, result) => sum + (result[i] ?? 0), 0)
//   );

//   // 来場率・歩留率を付加
//   const resultArray = [
//     ...totalArray,
//     _safeRatio(totalArray[3],  totalArray[0]),
//     _safeRatio(totalArray[12], totalArray[3]),
//   ].map(v => [v]);

//   // 全ドメイン行へ書き込み
//   const headerColIdx = _findYearColIdx(
//     freshData, config.allDomainHeaderRow.cxHeader, config.inquiryYear
//   );
//   _assertColIdx(headerColIdx, '_aggregateAllDomainProgress', config);

//   config.allDomainSheet
//     .getRange(
//       config.allDomainHeaderRow.cxHeader + 1,
//       headerColIdx + 1,
//       resultArray.length, 1
//     )
//     .setValues(resultArray);

//   AppLogger.debug('_aggregateAllDomainProgress: 書き込み完了', {
//     cxHeader: config.allDomainHeaderRow.cxHeader,
//     headerColIdx,
//   });
// }