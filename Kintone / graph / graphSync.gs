function syncGraphSheets(appId, record, graphSheet, sheetData, cAppId, sAppId) {
  // 修正: getInquiryYear → transformInquiryDate に統一
  const inquiryYear = transformInquiryDate(record.inquiry_date.value).year;

  const yearMatchingData     = sheetData.listData.filter(row => row[0] === inquiryYear);
  const closedDealsData      = yearMatchingData.filter(row => row[2] === 'A');
  const existingCustomerData = _findExistingCustomer(sheetData.listData, record.customer_name.value);

  const config = {
    record,
    graphSheet,
    graphData:         sheetData.graphData,
    listData:          [yearMatchingData, closedDealsData],
    inquiryYear,
    existingCustomerData,
    appId,
    customerAppId:     cAppId,
    salesAppId:        sAppId,
    ss:                getSpreadsheet(),
  };

  _runGraphProcessors(config);
  // calcAllDomains(config);
}

/**
 * 一覧データからお客様名で既存顧客行を検索して返す
 * @param {Array}  listData
 * @param {string} customerName
 * @returns {Array|[]} 既存顧客の行データ。未検出時は空配列
 */
function _findExistingCustomer(listData, customerName) {
  return listData.find(row => row[5] === customerName) ?? [];
}

/**
 * 顧客種別ごとの集計処理を実行する
 * @param {Object} config
 */
function _runGraphProcessors(config) {
  // ③ 修正: formatCustomerType → transformCustomerType
  const customerType = normalizeCustomerType(config.record.customer_type.value);

  try {
    calcProgress(config);
    calcMonthly(config);
    calcStaff(config);
    calcMedia(config);
    calcArea(config);

    if (customerType === CUSTOMER_TYPES.RESIDENTIAL || customerType === CUSTOMER_TYPES.NEW_BUILD) {
      _runResidentialCalcs(config);
    } else {
      _runBusinessCalcs(config);
    }
  } catch (error) {
    handleError(error.stack, error.message, 'graphSync',
      config.record.customer_name.value, config.record.customer_type.value);
  }
}

// 一般顧客の場合の処理
function _runResidentialCalcs(config) {
  calcIncomeAge(config);
  calcAgeFamily(config);
  calcAttrIndustry(config);
  calcConsideration(config);
  calcLeaving(config);
  calcNeeds(config);
}

// 法人顧客の場合の処理
function _runBusinessCalcs(config) {
  calcIndustryScale(config);
  calcJobTitle(config);
  calcTypeNeeds(config);
  calcEvent(config);
}

// /**
//  * 問い合わせ日を処理し、年・月・反響日の書式を返す
//  * 21日以降は翌月扱い、12月21日以降は翌年1月扱い
//  *
//  * @param {string} inquiryDateStr - "YYYY-MM-DD"形式の問い合わせ日
//  * @returns {{ year: string, month: string, monthAndDay: string }|{}}
//  */
// function getInquiryYear(inquiryDateStr) {
//   if (!inquiryDateStr) return {};

//   let [year, month, day] = inquiryDateStr.split('-').map(Number);

//   if (day >= 21) {
//     month++;
//     if (month > 12) {
//       month = 1;
//       year++;   // Bug 1 修正: 月繰り上げ後に年を繰り上げる
//     }
//   }

//   return {
//     year:       `${year}年`,
//     month:      `${month}月`,
//     monthAndDay:`${inquiryDateStr.split('-')[1]}月${day}日`,
//   };
// }
