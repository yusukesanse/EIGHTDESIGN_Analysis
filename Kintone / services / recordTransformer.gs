/**
 * recordTransformer.gs
 * 業務ロジック変換層
 * 最も変更が発生しやすい層。Spreadsheet依存を持たず、純粋関数に近づける
 */

// ============================================================
// 日付変換
// ============================================================

/**
 * "YYYY-MM-DD" 形式の問い合わせ日を、スプレッドシート管理用の年・月・日付に変換する
 * 21日以降は翌月扱い、12月21日以降は翌年扱い
 *
 * @param {string} inquiryDateStr - "YYYY-MM-DD" 形式の問い合わせ日
 * @returns {{ year: string, month: string, monthAndDay: string }|{}} 変換結果。入力が空の場合は空オブジェクト
 */
function transformInquiryDate(inquiryDateStr) {
  if (!inquiryDateStr) return {};

  let [year, month, day] = inquiryDateStr.split('-').map(Number);

  // 12月21日以降 → 翌年扱い
  if (month === YEAR_ROLLOVER.month && day >= YEAR_ROLLOVER.day) year++;

  // 21日以降 → 翌月扱い（12月→1月）
  if (day >= MONTH_ROLLOVER_DAY) {
    month++;
    if (month > 12) month = 1;
  }

  // 元の月・日を「反響日」表示用に残す
  const originalParts = inquiryDateStr.split('-');
  const originalMonth = parseInt(originalParts[1], 10);
  const originalDay   = parseInt(originalParts[2], 10);

  return {
    year:       `${year}年`,
    month:      `${month}月`,
    monthAndDay:`${originalMonth}月${originalDay}日`,
  };
}

// ============================================================
// 顧客種別・エリア正規化
// ============================================================

/**
 * 顧客種別の生データを正規化する
 * @param {string} rawType - kintoneから取得した顧客種別の値
 * @returns {string} 正規化後の顧客種別（CUSTOMER_TYPESの値）
 */
function normalizeCustomerType(rawType) {
  if (!rawType) return '';
  if (rawType.includes('住宅'))                       return CUSTOMER_TYPES.RESIDENTIAL;
  if (rawType.includes('店舗'))                       return CUSTOMER_TYPES.SMALL_STORE;
  if (rawType.includes('オフィス'))                   return CUSTOMER_TYPES.OFFICE;
  if (rawType.includes('トレーラー'))                 return CUSTOMER_TYPES.TRAILER;
  if (rawType.includes('医療福祉'))                   return CUSTOMER_TYPES.MEDICAL;
  if (rawType.includes('工場'))                       return CUSTOMER_TYPES.FACTORY;
  if (rawType.includes('みせいえ'))                   return CUSTOMER_TYPES.MISEIE;
  if (rawType.includes('賃貸'))                       return CUSTOMER_TYPES.RENTAL;
  if (rawType.includes('新築') || rawType.includes('BinO')) return CUSTOMER_TYPES.NEW_BUILD;
  return '';
}

/**
 * 販促エリアの生データを正規化する（末尾の「店」を除去）
 * @param {string} rawArea - kintoneから取得した販促エリアの値
 * @returns {string} 正規化後の販促エリア
 */
function normalizePromotionArea(rawArea) {
  return rawArea ? rawArea.replace(/店$/, '') : '';
}

// ============================================================
// ランク・ステータス変換
// ============================================================

/**
 * kintoneのランク値をスプレッドシート表示用に変換する
 * @param {string} rawRank - kintoneのランク値
 * @returns {string|null} スプレッドシート表示用のランク値。マッピングなければnull
 */
function transformRank(rawRank) {
  return RANK_MAP[rawRank] ?? null;
}

/**
 * 商談ステータスと現在ランクから「見込み」列の表示値を決定する
 * 商談ステータスがパススルー対象なら商談ステータスをそのまま使用する
 * @param {string} negoStatus - 商談ステータス
 * @param {string} rawRank - 現在のランク値（kintone生値）
 * @returns {string} 「見込み」列に表示する文字列
 */
function transformNegotiationStatus(negoStatus, rawRank) {
  if (NEGO_STATUS_PASS_THROUGH.includes(negoStatus)) return negoStatus;
  return rawRank ?? '';
}

// ============================================================
// イベント情報抽出
// ============================================================

/**
 * 問い合わせ内容テキストから「イベント」情報を抽出する
 * 【 イベント 】〜\n の形式を想定
 * @param {string} text - 問い合わせ内容テキスト
 * @returns {string} イベント内容（マッチしない場合は空文字）
 */
function extractEventDetail(text) {
  if (!text) return '';
  const match = text.match(/【 イベント 】(.*?)\n/);
  return match ? match[1].trim() : '';
}

// ============================================================
// 年収変換
// ============================================================

/**
 * 年収の数値文字列を万円単位に変換する（末尾に"0000"を付与）
 * @param {string} rawIncome - kintoneの年収フィールド値（例: "500"）
 * @returns {string} 万円単位の年収文字列（例: "5000000"）
 */
function transformIncome(rawIncome) {
  if (!rawIncome) return '';
  return `${rawIncome}0000`;
}

// ============================================================
// 顧客情報シート用配列生成
// ============================================================

/**
 * 顧客情報のフィールドデータをシート書き込み用の列配列に変換する
 * @param {Object} fields - extractCustomerFields() の戻り値
 * @returns {Array<{ col: number, value: * }>} 列インデックスと値のペア配列
 */
function buildCustomerRowData(fields) {
  const inquiryDate = transformInquiryDate(fields.inquiryDate);

  return [
    { col: CUSTOMER_LIST_COLS.YEAR,              value: inquiryDate.year        },
    { col: CUSTOMER_LIST_COLS.MONTH,             value: inquiryDate.month       },
    { col: CUSTOMER_LIST_COLS.RANK,              value: transformRank(fields.likehoodNow) },
    { col: CUSTOMER_LIST_COLS.LIKEHOOD,          value: fields.likehoodNow      },
    { col: CUSTOMER_LIST_COLS.CUSTOMER_NAME,     value: fields.customerName     },
    { col: CUSTOMER_LIST_COLS.FIRST_APPOINT,     value: fields.firstAppoint     },
    { col: CUSTOMER_LIST_COLS.INQUIRY_DATE,      value: inquiryDate.monthAndDay },
    { col: CUSTOMER_LIST_COLS.INFO_ROUTE,        value: fields.informationRoute },
    { col: CUSTOMER_LIST_COLS.MANAGER,           value: fields.manager          },
    { col: CUSTOMER_LIST_COLS.AGE,               value: fields.age              },
    { col: CUSTOMER_LIST_COLS.CURRENT_RESIDENCE, value: fields.currentResidence },
    { col: CUSTOMER_LIST_COLS.FAMILY_MEMBER,     value: fields.familyMember     },
  ];
}

// ============================================================
// 営業・商談管理シート用配列生成
// ============================================================

/**
 * 営業・商談管理のフィールドデータをシート書き込み用の列配列に変換する
 * 顧客種別によって追加列が変わる
 *
 * @param {Object} fields - extractSalesFields() の戻り値
 * @param {Object} negotiation - parseLatestNegotiation() の戻り値
 * @param {Object} meetingData - parseMeetingData() の戻り値
 * @returns {Array<{ col: number, value: * }>} 列インデックスと値のペア配列
 */
function buildSalesRowData(fields, negotiation, meetingData) {
  const inquiryDate     = transformInquiryDate(fields.inquiryDate);
  const customerType    = normalizeCustomerType(fields.customerType);
  const inquiryContent  = parseInquiryContent(fields.inquiryStatusRows);
  const eventDetail     = extractEventDetail(inquiryContent);

  // 全顧客種別共通の列データ
  const rowData = [
    { col: SALES_LIST_COLS.YEAR,                 value: inquiryDate.year },
    { col: SALES_LIST_COLS.MONTH,                value: inquiryDate.month },
    { col: SALES_LIST_COLS.RANK,                 value: transformRank(fields.likehoodNow) },
    { col: SALES_LIST_COLS.LIKEHOOD,             value: transformNegotiationStatus(fields.negoStatus, fields.likehoodNow) },
    { col: SALES_LIST_COLS.MTG_COUNT,            value: meetingData?.mtgCount ?? '' },
    { col: SALES_LIST_COLS.CUSTOMER_NAME,        value: fields.customerName },
    { col: SALES_LIST_COLS.INQUIRY_DATE,         value: inquiryDate.monthAndDay },
    { col: SALES_LIST_COLS.CONSULTATION_CONTENT, value: fields.consultationContent },
    { col: SALES_LIST_COLS.MANAGER,              value: fields.manager },
    { col: SALES_LIST_COLS.LATEST_FOLLOWUP,      value: negotiation?.resDate ?? '' },
    { col: SALES_LIST_COLS.MTG_DAY_1,            value: meetingData?.mtgDays[0] ?? '' },
    { col: SALES_LIST_COLS.MTG_DAY_2,            value: meetingData?.mtgDays[1] ?? '' },
    { col: SALES_LIST_COLS.MTG_DAY_3,            value: meetingData?.mtgDays[2] ?? '' },
    { col: SALES_LIST_COLS.NEXT_APPT,            value: negotiation?.nextAppt ?? '' },
    { col: SALES_LIST_COLS.LAND_ATTRIBUTES,      value: fields.landAttributes },
    { col: SALES_LIST_COLS.PREFECTURE,           value: fields.prefectures },
    { col: SALES_LIST_COLS.CITY,                 value: fields.city },
    { col: SALES_LIST_COLS.TOWN,                 value: fields.town },
    { col: SALES_LIST_COLS.AREA,                 value: fields.area },
    { col: SALES_LIST_COLS.WORK_PLACE,           value: fields.workPlace },
    { col: SALES_LIST_COLS.INDUSTRY,             value: fields.industry },
    { col: SALES_LIST_COLS.OCCUPATION,           value: fields.occupation },
    { col: SALES_LIST_COLS.FAMILY_MEMBER,        value: fields.familyMember },
    { col: SALES_LIST_COLS.INCOME,               value: transformIncome(fields.income) },
    { col: SALES_LIST_COLS.SELF_FUNDED,          value: fields.selfFunded },
  ];

  // 顧客種別に応じた追加列データを付加
  const extraData = _buildExtraRowData(customerType, fields, eventDetail);
  rowData.push(...extraData);

  return rowData;
}

// ============================================================
// 顧客種別別追加列生成（内部関数）
// ============================================================

/**
 * 顧客種別ごとの追加列データを生成する
 * @param {string} customerType - 正規化済み顧客種別
 * @param {Object} fields - extractSalesFields() の戻り値
 * @param {string} eventDetail - 抽出済みイベント詳細
 * @returns {Array<{ col: number, value: * }>}
 */
function _buildExtraRowData(customerType, fields, eventDetail) {
  switch (customerType) {
    case CUSTOMER_TYPES.RESIDENTIAL:
    case CUSTOMER_TYPES.NEW_BUILD:
      return _buildResidentialExtraData(fields, eventDetail);

    case CUSTOMER_TYPES.SMALL_STORE:
      return _buildBusinessExtraData(
        fields, eventDetail, _resolveStoreHopeType(fields.constructionStatus)
      );

    case CUSTOMER_TYPES.RENTAL:
      return _buildBusinessExtraData(
        fields, eventDetail, _resolveStoreHopeType(fields.rentalType)
      );

    default:
      return _buildBusinessExtraData(
        fields, eventDetail, _resolveOtherHopeType(fields.constructionStatus)
      );
  }
}

/**
 * 一般住宅・新築の追加列データを生成する
 * @param {Object} fields
 * @param {string} eventDetail
 * @returns {Array<{ col: number, value: * }>}
 */
function _buildResidentialExtraData(fields, eventDetail) {
  const inquiryNeedsEntry = _resolveInquiryNeeds(fields.hopeRenovation, fields.landAttributes);
  return [
    { col: SALES_LIST_COLS.CURRENT_RESIDENCE,   value: fields.currentResidence },
    inquiryNeedsEntry,
    { col: RESIDENTIAL_EXTRA_COLS.WORK_PLACE_SUB, value: fields.workPlaceSub },
    { col: RESIDENTIAL_EXTRA_COLS.INCOME_SUB,     value: transformIncome(fields.incomeSub) },
    { col: RESIDENTIAL_EXTRA_COLS.REASON,         value: fields.reason },
    { col: RESIDENTIAL_EXTRA_COLS.EVENT,          value: eventDetail },
  ];
}

/**
 * 店舗・賃貸・その他の追加列データを生成する
 * @param {Object} fields
 * @param {string} eventDetail
 * @param {{ col: number, value: string }} hopeTypeEntry
 * @returns {Array<{ col: number, value: * }>}
 */
function _buildBusinessExtraData(fields, eventDetail, hopeTypeEntry) {
  return [
    hopeTypeEntry,
    { col: BUSINESS_EXTRA_COLS.JOB_TITLE,      value: fields.jobTitle },
    { col: BUSINESS_EXTRA_COLS.HOPE_BUSINESS,  value: fields.hopeBusinessType },
    { col: BUSINESS_EXTRA_COLS.CAPITAL_STOCK,  value: fields.capitalStock },
    { col: BUSINESS_EXTRA_COLS.REASON,         value: fields.reason },
    { col: BUSINESS_EXTRA_COLS.EVENT,          value: eventDetail },
  ];
}

// ============================================================
// 希望種別解決ロジック（内部関数）
// ============================================================

/**
 * 希望リノベ種別・物件有無から「問い合わせニーズ」列を決定する
 * @param {string} renovationType
 * @param {string} landAvailability
 * @returns {{ col: number, value: string }}
 */
function _resolveInquiryNeeds(renovationType, landAvailability) {
  if (renovationType === 'マンションリノベ' || renovationType === '戸建てリノベ') {
    if (landAvailability === 'なし') return { col: RESIDENTIAL_EXTRA_COLS.FIRST_ACQUIRER, value: '1' };
    if (landAvailability === 'あり') return { col: RESIDENTIAL_EXTRA_COLS.OWN_HOUSE,      value: '1' };
  }
  if (renovationType === '実家リノベ') return { col: RESIDENTIAL_EXTRA_COLS.PARENTAL_HOME, value: '1' };
  return { col: RESIDENTIAL_EXTRA_COLS.FIRST_ACQUIRER, value: '' };
}

/**
 * 店舗・賃貸の建設状況から希望種別列を決定する
 * @param {string} type
 * @returns {{ col: number, value: string }}
 */
function _resolveStoreHopeType(type) {
  const map = {
    '入居希望': BUSINESS_EXTRA_COLS.HOPE_TYPE_A,
    '独立':     BUSINESS_EXTRA_COLS.HOPE_TYPE_A,
    '大家':     BUSINESS_EXTRA_COLS.HOPE_TYPE_B,
    '既存店舗': BUSINESS_EXTRA_COLS.HOPE_TYPE_B,
    '紹介':     BUSINESS_EXTRA_COLS.HOPE_TYPE_C,
    '新店舗':   BUSINESS_EXTRA_COLS.HOPE_TYPE_C,
  };
  const col = map[type] ?? BUSINESS_EXTRA_COLS.HOPE_TYPE_A;
  return { col, value: map[type] ? '1' : '' };
}

/**
 * その他業種の建設状況から希望種別列を決定する
 * @param {string} type
 * @returns {{ col: number, value: string }}
 */
function _resolveOtherHopeType(type) {
  const map = {
    '独立': BUSINESS_EXTRA_COLS.HOPE_TYPE_A,
    '既存': BUSINESS_EXTRA_COLS.HOPE_TYPE_B,
    '移転': BUSINESS_EXTRA_COLS.HOPE_TYPE_C,
  };
  const col = map[type] ?? BUSINESS_EXTRA_COLS.HOPE_TYPE_A;
  return { col, value: map[type] ? '1' : '' };
}