// // ============================================================
// // graph/calcAllDomains.gs
// // ============================================================

// /**
//  * 全ドメインシートの顧客進捗・月次反響・スタッフスコアを更新する
//  * @param {Object} config
//  */
// function calcAllDomains(config) {
//   try {
//     const enriched = _enrichAllDomainsConfig(config);
//     calcAllProgress(enriched);
//     calcAllMonthly(enriched);
//     // calcAllStaff(enriched);
//   } catch (e) {
//     handleError(e.stack, e.message, 'calcAllDomains',
//       config.record.customer_name.value, config.record.customer_type.value);
//   }
// }

// // ============================================================
// // config 拡張
// // ============================================================

// /**
//  * 全ドメイン処理に必要なデータを config に追加して返す
//  * @param {Object} config
//  * @returns {Object} 全ドメイン用プロパティを付加した config のコピー
//  */
// function _enrichAllDomainsConfig(config) {
//   const ss             = config.ss;
//   const allDomainSheet = ss.getSheetByName(ALL_DOMAINS_SHEET_NAME);
//   const allDomainData  = getFormattedSheetData(allDomainSheet);
//   const customerType   = normalizeCustomerType(config.record.customer_type.value);
//   const promoArea      = normalizePromotionArea(config.record.promotion_area.value);

//   // 顧客種別ごとのヘッダー行（calcAllProgress / calcAllMonthly の書き込み先）
//   const headerRow          = _searchAllDomainHeaderRow(customerType, allDomainData);
//   // 全ドメイン集計行のヘッダー（_aggregateAllDomainProgress / _aggregateAllDomainMonthly の書き込み先）
//   const allDomainHeaderRow = _searchAllDomainHeaderRow('全ドメイン', allDomainData);

//   const unmatchData = _parseUnmatchedSheetData(ss, customerType, promoArea);

//   return { ...config, allDomainSheet, allDomainData, headerRow, allDomainHeaderRow, unmatchData };
// }

// // ============================================================
// // シートデータ取得
// // ============================================================

// /**
//  * アンマッチシート（販促エリアが異なる側）のデータを取得する
//  * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
//  * @param {string} customerType - 変換済み顧客種別
//  * @param {string} promoArea    - 変換済み販促エリア
//  * @returns {Array<Array<*>>}
//  */
// function _parseUnmatchedSheetData(ss, customerType, promoArea) {
//   const unmatchArea = UNMATCH_AREA_MAP[promoArea];
//   if (!unmatchArea) {
//     throw new Error(`未定義の販促エリア: ${promoArea}`);
//   }

//   const sheetName    = `【${customerType}】${unmatchArea}`;
//   const unmatchSheet = ss.getSheetByName(sheetName);
//   if (!unmatchSheet) {
//     throw new Error(`シートが見つかりません: ${sheetName}`);
//   }

//   return getFormattedSheetData(unmatchSheet);
// }

// // ============================================================
// // ヘッダー行検索
// // ============================================================

// /**
//  * 全ドメインシートから顧客進捗・月次反響のヘッダー行インデックスを返す
//  * '全ドメイン' を渡すと全ドメイン集計行のインデックスを返す
//  * @param {string} customerType - 変換済み顧客種別 または '全ドメイン'
//  * @param {Array<Array<*>>} domainData
//  * @returns {{ cxHeader: number, monthHeader: number }}
//  */
// function _searchAllDomainHeaderRow(customerType, domainData) {
//   const progressKey = `${customerType}_顧客進捗`;
//   const monthlyKey  = `${customerType}_月ごとの反響`;

//   let cxHeader    = -1;
//   let monthHeader = -1;

//   for (let i = 0; i < domainData.length; i++) {
//     const cell = domainData[i][0];
//     if (cell === progressKey) cxHeader    = i;
//     if (cell === monthlyKey)  monthHeader = i;
//     if (cxHeader !== -1 && monthHeader !== -1) break;
//   }

//   if (cxHeader === -1 || monthHeader === -1) {
//     AppLogger.warn('_searchAllDomainHeaderRow: ヘッダー行が見つかりません', {
//       customerType, cxHeader, monthHeader,
//     });
//   }

//   return { cxHeader, monthHeader };
// }