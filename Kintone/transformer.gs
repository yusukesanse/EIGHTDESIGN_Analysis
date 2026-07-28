/**
 * transformer.gs — 業務ロジック変換・正規化モデル（旧 recordTransformer.gs）
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

  // 元の年・月・日（「反響日」表示や繰り上げ判定の基準に使う）
  const [origYear, origMonth, origDay] = inquiryDateStr.split('-').map(Number);
  let year  = origYear;
  let month = origMonth;

  // 12月21日以降 → 翌年扱い
  if (origMonth === YEAR_ROLLOVER.month && origDay >= YEAR_ROLLOVER.day) year++;

  // 21日以降 → 翌月扱い（12月→1月）
  if (origDay >= MONTH_ROLLOVER_DAY) {
    month++;
    if (month > 12) month = 1;
  }

  return {
    year:       `${year}年`,
    month:      `${month}月`,
    monthAndDay:`${origMonth}月${origDay}日`,
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
    // 家族数（列27）は営業レコードに存在しないため書き込まない。
    // 顧客情報アプリの Webhook が設定した値を、営業更新のたびに空で上書きしないため。
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
  const inquiryNeedsEntries = _resolveInquiryNeeds(fields.hopeRenovation, fields.landAttributes);
  return [
    { col: SALES_LIST_COLS.CURRENT_RESIDENCE,   value: fields.currentResidence },
    ...inquiryNeedsEntries,
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
function _buildBusinessExtraData(fields, eventDetail, hopeTypeEntries) {
  return [
    ...hopeTypeEntries,
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
 * 3つの分類フラグ列について、該当列に '1'、それ以外は '' を書く列エントリ群を生成する。
 * 非該当となった列も毎回 '' で明示的にクリアするため、分類変更時に旧フラグが残らない。
 * @param {number[]} allCols - 対象となる全フラグ列（1始まり）
 * @param {number|undefined} activeCol - '1' を立てる列（該当なしは undefined）
 * @returns {Array<{ col: number, value: string }>}
 */
function _buildFlagEntries(allCols, activeCol) {
  return allCols.map(col => ({ col, value: col === activeCol ? '1' : '' }));
}

/**
 * 希望リノベ種別・物件有無から「問い合わせニーズ」フラグ列（一次取得/持家/実家）を決定する。
 * 該当列に '1'、他の2列は '' でクリアする。
 * @param {string} renovationType
 * @param {string} landAvailability
 * @returns {Array<{ col: number, value: string }>}
 */
function _resolveInquiryNeeds(renovationType, landAvailability) {
  const R = RESIDENTIAL_EXTRA_COLS;
  let activeCol;
  if (renovationType === 'マンションリノベ' || renovationType === '戸建てリノベ') {
    if (landAvailability === 'なし') activeCol = R.FIRST_ACQUIRER;
    else if (landAvailability === 'あり') activeCol = R.OWN_HOUSE;
  } else if (renovationType === '実家リノベ') {
    activeCol = R.PARENTAL_HOME;
  }
  return _buildFlagEntries([R.FIRST_ACQUIRER, R.OWN_HOUSE, R.PARENTAL_HOME], activeCol);
}

/**
 * 店舗・賃貸の建設状況から希望種別フラグ列（A/B/C）を決定する。
 * 該当列に '1'、他の2列は '' でクリアする。
 * @param {string} type
 * @returns {Array<{ col: number, value: string }>}
 */
function _resolveStoreHopeType(type) {
  const B = BUSINESS_EXTRA_COLS;
  const map = {
    '入居希望': B.HOPE_TYPE_A,
    '独立':     B.HOPE_TYPE_A,
    '大家':     B.HOPE_TYPE_B,
    '既存店舗': B.HOPE_TYPE_B,
    '紹介':     B.HOPE_TYPE_C,
    '新店舗':   B.HOPE_TYPE_C,
  };
  return _buildFlagEntries([B.HOPE_TYPE_A, B.HOPE_TYPE_B, B.HOPE_TYPE_C], map[type]);
}

/**
 * その他業種の建設状況から希望種別フラグ列（A/B/C）を決定する。
 * 該当列に '1'、他の2列は '' でクリアする。
 * @param {string} type
 * @returns {Array<{ col: number, value: string }>}
 */
function _resolveOtherHopeType(type) {
  const B = BUSINESS_EXTRA_COLS;
  const map = {
    '独立': B.HOPE_TYPE_A,
    '既存': B.HOPE_TYPE_B,
    '移転': B.HOPE_TYPE_C,
  };
  return _buildFlagEntries([B.HOPE_TYPE_A, B.HOPE_TYPE_B, B.HOPE_TYPE_C], map[type]);
}

// ============================================================
// 正規化済みレコードモデル
// ============================================================

/**
 * Webhookレコードを、一覧行生成・グラフ集計の両方が受け取れる
 * 単一の正規化済みモデルへ変換する。
 *
 * 設計方針:
 *   - kintone生レコードの解釈・正規化を「この1関数」に集約する
 *     （正規化ルールを複数箇所へ複製しない／生レコード参照を分散させない）。
 *   - 既存の抽出・正規化関数を再利用し、新たな変換ロジックは追加しない
 *     （＝出力は現行と同一）。
 *   - 集計年・集計月は transformInquiryDate の結果をそのまま保持する
 *     （問い合わせ日が空のとき undefined になる点も現行踏襲）。
 *
 * recordId / revision / eventType は Webhook の冪等性・監査用メタ情報として保持する。
 * 一覧シートの既存レイアウトにはレコードID列がないため、行識別自体は引き続き
 * customerName を使用する。sourceKey は処理ログ・将来のID移行に利用する。
 *
 * @param {string} appId - kintoneアプリID
 * @param {Object} record - kintoneレコードオブジェクト
 * @param {string} [eventType=''] - Webhookイベント種別
 * @returns {Object} 正規化済みモデル
 * @throws {Error} 未対応アプリIDの場合
 */
function buildNormalizedRecord(appId, record, eventType = '') {
  const isCustomer = appId === CUSTOMER_APP_ID;
  const isSales    = appId === SALES_APP_ID;

  const fields = isCustomer ? extractCustomerFields(record)
               : isSales    ? extractSalesFields(record)
               : null;

  if (!fields) {
    throw new Error(`未対応のアプリID: ${appId}`);
  }

  assertNonEmptyString(fields.customerName, 'customerName');
  assertDateString(fields.inquiryDate, 'inquiryDate');

  const customerType  = normalizeCustomerType(fields.customerType);
  const promotionArea = normalizePromotionArea(fields.promotionArea);
  const inquiry       = transformInquiryDate(fields.inquiryDate);
  const sheetArea     = _resolveSheetArea(promotionArea);
  const recordId      = getFieldValue(record, '$id');
  const revision      = getFieldValue(record, '$revision');

  if (!customerType) {
    throw new Error(`未対応の顧客種別です: ${fields.customerType}`);
  }
  if (!sheetArea) {
    throw new Error(`未対応の販促エリアです: ${promotionArea}`);
  }
  assertPositiveSafeIntegerString(recordId, '$id');
  assertNonNegativeSafeIntegerString(revision, '$revision');

  return {
    // ── Webhook / kintone メタ情報 ──────────────────────────
    appId,
    eventType,
    recordId,
    revision,
    sourceKey: `${appId}:${recordId}`,

    // ── 共通の正規化済み項目 ────────────────────────────────
    customerName:     fields.customerName,
    customerType,
    promotionArea,
    inquiryDate:      fields.inquiryDate,
    aggregationYear:  inquiry.year,   // 現行踏襲: 空日付時は undefined
    aggregationMonth: inquiry.month,
    rank:             transformRank(fields.likehoodNow),
    manager:          fields.manager,

    // ── アプリ由来の正規化済み項目（build*RowData がそのまま消費）──
    customerFields:   isCustomer ? fields : null,
    salesFields:      isSales    ? fields : null,

    // ── 対象シート名 ────────────────────────────────────────
    sheetArea,
    listSheetName:    buildListSheetName(sheetArea, customerType),
  };
}
