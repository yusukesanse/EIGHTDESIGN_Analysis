/**
 * Meta広告費集計スクリプト
 * 
 * 機能：
 * - Meta APIから広告セット別のspendを取得
 * - 対応表に基づいてドメイン×地域ごとに集計
 * - 前月21日〜当月20日の期間で集計
 * - 「広告費管理」シートのmeta行に書き込み
 */

// ===========================================
// 設定
// ===========================================
const CONFIG = {
  // Meta API設定
  META_ACCESS_TOKEN: PropertiesService.getScriptProperties().getProperty('META_ACCESS_TOKEN'),
  META_AD_ACCOUNT_ID: PropertiesService.getScriptProperties().getProperty('META_AD_ACCOUNT_ID'),
  META_API_VERSION: 'v23.0',
  
  // スプレッドシート設定
  SPREADSHEET_ID: PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'),
  MAIN_SHEET_NAME: '広告費管理',
  MAPPING_SHEET_NAME: '広告セット振り分け',
  
  // シート構造設定
  HEADER_ROW: 1,
  DATA_START_ROW: 2,
  DOMAIN_COL: 1,      // A列
  AREA_COL: 2,        // B列
  MEDIA_COL: 3,       // C列
  MONTH_START_COL: 4, // D列から月データ開始
  
  // 集計期間設定（前月21日〜当月20日）
  PERIOD_START_DAY: 21,
  PERIOD_END_DAY: 20
};

// ===========================================
// メイン関数
// ===========================================

/**
 * メイン実行関数 - 毎日トリガーで実行
 */
function updateMetaAdSpend() {
  try {
    Logger.log('=== Meta広告費集計 開始 ===');
    
    // 1. 現在の集計期間を計算
    const period = calculateCurrentPeriod();
    Logger.log(`集計期間: ${period.startDate} 〜 ${period.endDate}`);
    Logger.log(`対象月列: ${period.monthLabel}`);
    
    // 2. Meta APIから広告セットデータを取得
    const adSetData = fetchMetaAdSetInsights(period.startDate, period.endDate);
    Logger.log(`取得した広告セット数: ${adSetData.length}`);
    
    // 3. 対応表を読み込み
    const mappingData = loadMappingSheet();
    Logger.log(`対応表のエントリ数: ${mappingData.length}`);
    
    // 4. ドメイン×地域ごとに集計
    const aggregatedData = aggregateSpendByDomainArea(adSetData, mappingData);
    Logger.log(`集計結果: ${JSON.stringify(aggregatedData)}`);
    
    // 5. シートに書き込み
    writeToSheet(aggregatedData, period.monthLabel);
    
    Logger.log('=== Meta広告費集計 完了 ===');
    
  } catch (error) {
    Logger.log(`エラー発生: ${error.message}`);
    Logger.log(`スタックトレース: ${error.stack}`);
    throw error;
  }
}

/**
 * テスト用：特定月の集計を実行
 * @param {number} year - 年
 * @param {number} month - 月
 */
function updateMetaAdSpendForMonth(year, month) {
  try {
    Logger.log(`=== Meta広告費集計 (${year}/${month}) 開始 ===`);
    
    const period = calculatePeriodForMonth(year, month);
    Logger.log(`集計期間: ${period.startDate} 〜 ${period.endDate}`);
    
    const adSetData = fetchMetaAdSetInsights(period.startDate, period.endDate);
    Logger.log(`取得した広告セット数: ${adSetData.length}`);
    
    const mappingData = loadMappingSheet();
    const aggregatedData = aggregateSpendByDomainArea(adSetData, mappingData);
    
    writeToSheet(aggregatedData, period.monthLabel);
    
    Logger.log(`=== Meta広告費集計 (${year}/${month}) 完了 ===`);
    
  } catch (error) {
    Logger.log(`エラー発生: ${error.message}`);
    throw error;
  }
}

// ===========================================
// 期間計算関数
// ===========================================

/**
 * 現在の日付に基づいて集計期間を計算
 * @returns {Object} {startDate, endDate, monthLabel}
 */
function calculateCurrentPeriod() {
  const today = new Date();
  const currentDay = today.getDate();
  const currentMonth = today.getMonth() + 1;
  const currentYear = today.getFullYear();
  
  let targetYear, targetMonth;
  
  // 当月20日以前なら当月、21日以降なら翌月の列に記入
  if (currentDay <= CONFIG.PERIOD_END_DAY) {
    targetYear = currentYear;
    targetMonth = currentMonth;
  } else {
    targetYear = currentMonth === 12 ? currentYear + 1 : currentYear;
    targetMonth = currentMonth === 12 ? 1 : currentMonth + 1;
  }
  
  return calculatePeriodForMonth(targetYear, targetMonth);
}

/**
 * 指定月の集計期間を計算
 * @param {number} year - 年
 * @param {number} month - 月
 * @returns {Object} {startDate, endDate, monthLabel}
 */
function calculatePeriodForMonth(year, month) {
  // 前月21日
  let startYear = month === 1 ? year - 1 : year;
  let startMonth = month === 1 ? 12 : month - 1;
  const startDate = formatDate(startYear, startMonth, CONFIG.PERIOD_START_DAY);
  
  // 当月20日
  const endDate = formatDate(year, month, CONFIG.PERIOD_END_DAY);
  
  // 月ラベル（例：2024/01）
  const monthLabel = `${year}/${String(month).padStart(2, '0')}`;
  
  return { startDate, endDate, monthLabel };
}

/**
 * 日付をYYYY-MM-DD形式にフォーマット
 */
function formatDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ===========================================
// Meta API関数
// ===========================================

/**
 * Meta APIから広告セットのインサイトを取得
 * @param {string} startDate - 開始日（YYYY-MM-DD）
 * @param {string} endDate - 終了日（YYYY-MM-DD）
 * @returns {Array} 広告セットデータの配列
 */
function fetchMetaAdSetInsights(startDate, endDate) {
  const allData = [];
  let nextUrl = buildInitialUrl(startDate, endDate);
  let pageCount = 0;
  const maxPages = 50;
  
  while (nextUrl && pageCount < maxPages) {
    pageCount++;
    Logger.log(`ページ ${pageCount} を取得中...`);
    
    const response = UrlFetchApp.fetch(nextUrl, {
      method: 'GET',
      muteHttpExceptions: true
    });
    
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    if (responseCode !== 200) {
      Logger.log(`API エラー (${responseCode}): ${responseText}`);
      throw new Error(`Meta API エラー: ${responseCode}`);
    }
    
    const data = JSON.parse(responseText);
    
    // データを処理
    if (data.data && data.data.length > 0) {
      for (const adset of data.data) {
        if (adset.insights && adset.insights.data && adset.insights.data.length > 0) {
          const insight = adset.insights.data[0];
          allData.push({
            adset_id: adset.id,
            adset_name: adset.name,
            spend: parseFloat(insight.spend || 0)
          });
        }
      }
    }
    
    // 次のページURLを取得
    nextUrl = data.paging && data.paging.next ? data.paging.next : null;
  }
  
  Logger.log(`合計 ${pageCount} ページ、${allData.length} 件の広告セットを取得`);
  return allData;
}

/**
 * Meta API初期URLを構築
 */
function buildInitialUrl(startDate, endDate) {
  const baseUrl = `https://graph.facebook.com/${CONFIG.META_API_VERSION}/${CONFIG.META_AD_ACCOUNT_ID}/adsets`;
  const fields = 'id,name,insights.time_range({"since":"' + startDate + '","until":"' + endDate + '"}){spend}';
  
  const params = [
    `fields=${encodeURIComponent(fields)}`,
    `limit=100`,
    `access_token=${CONFIG.META_ACCESS_TOKEN}`
  ];
  
  return `${baseUrl}?${params.join('&')}`;
}

// ===========================================
// 対応表読み込み関数
// ===========================================

/**
 * 「広告セット振り分け」シートからデータを読み込み
 * @returns {Array} [{adsetNameKeyword, domain, area}]
 */
function loadMappingSheet() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.MAPPING_SHEET_NAME);
  
  if (!sheet) {
    throw new Error(`対応表シート "${CONFIG.MAPPING_SHEET_NAME}" が見つかりません`);
  }
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('対応表にデータがありません');
    return [];
  }
  
  // B列（広告セット名）とD列（ドメイン）を読み込み
  const data = sheet.getRange(2, 2, lastRow - 1, 3).getValues(); // B列〜D列
  const mappingData = [];
  
  for (const row of data) {
    const adsetNameKeyword = String(row[0]).trim(); // B列：広告セット名
    const domain = String(row[2]).trim();           // D列：ドメイン
    
    // ドメインが空、または「必要なし」の場合はスキップ
    if (!adsetNameKeyword || !domain || domain === '必要なし') {
      continue;
    }
    
    // 地域を判定：広告セット名に「東京」が含まれれば東京、それ以外は愛知
    let area = '愛知';
    if (adsetNameKeyword.includes('東京')) {
      area = '東京';
    }
    
    // 特殊な地域の処理
    if (domain === 'トレーラー' || domain === 'ゴルフ') {
      area = '全国';
    } else if (domain === '医療福祉') {
      area = '愛知・東京';
    } else if (domain === 'BinO') {
      area = '豊田(愛知)';
    }
    
    mappingData.push({ adsetNameKeyword, domain, area });
  }
  
  Logger.log(`対応表から ${mappingData.length} 件のマッピングを読み込み`);
  return mappingData;
}

// ===========================================
// 集計関数
// ===========================================

/**
 * 広告セットデータをドメイン×地域ごとに集計
 * @param {Array} adSetData - 広告セットデータ
 * @param {Array} mappingData - 対応表データ
 * @returns {Object} {domain_area: spend}
 */
function aggregateSpendByDomainArea(adSetData, mappingData) {
  const result = {};
  const matchedAdsets = new Set(); // マッチした広告セットを追跡
  
  for (const adset of adSetData) {
    // 対応表から該当するマッピングを検索（部分一致）
    for (const mapping of mappingData) {
      if (adset.adset_name.includes(mapping.adsetNameKeyword)) {
        const key = `${mapping.domain}|${mapping.area}`;
        
        if (!result[key]) {
          result[key] = 0;
        }
        result[key] += adset.spend;
        matchedAdsets.add(adset.adset_id);
        
        Logger.log(`マッチ: "${adset.adset_name}" → ${mapping.domain}/${mapping.area} (キーワード: "${mapping.adsetNameKeyword}", spend: ${adset.spend})`);
        break; // 最初にマッチしたものを使用
      }
    }
  }
  
  // マッチしなかった広告セットをログ出力
  const unmatchedAdsets = adSetData.filter(a => !matchedAdsets.has(a.adset_id));
  if (unmatchedAdsets.length > 0) {
    Logger.log(`=== マッチしなかった広告セット (${unmatchedAdsets.length}件) ===`);
    for (const adset of unmatchedAdsets) {
      Logger.log(`  - ${adset.adset_name} (spend: ${adset.spend})`);
    }
  }
  
  return result;
}

// ===========================================
// シート書き込み関数
// ===========================================

/**
 * 集計結果をシートに書き込み
 * @param {Object} aggregatedData - 集計データ
 * @param {string} monthLabel - 月ラベル（例：2024/01）
 */
function writeToSheet(aggregatedData, monthLabel) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.MAIN_SHEET_NAME);
  
  if (!sheet) {
    throw new Error(`シート "${CONFIG.MAIN_SHEET_NAME}" が見つかりません`);
  }
  
  // 月の列を特定
  const monthCol = findMonthColumn(sheet, monthLabel);
  if (!monthCol) {
    throw new Error(`月 "${monthLabel}" の列が見つかりません`);
  }
  Logger.log(`月 "${monthLabel}" は ${monthCol} 列目`);
  
  // シートのデータを読み込み（ドメイン、地域、媒体）
  const lastRow = sheet.getLastRow();
  const sheetData = sheet.getRange(CONFIG.DATA_START_ROW, 1, lastRow - 1, 3).getValues();
  
  // 各行のドメインと地域を解決（空欄の場合は上の行から継承）
  let currentDomain = '';
  let currentArea = '';
  
  for (let i = 0; i < sheetData.length; i++) {
    const rowIndex = CONFIG.DATA_START_ROW + i;
    const domain = String(sheetData[i][0]).trim();
    const area = String(sheetData[i][1]).trim();
    const media = String(sheetData[i][2]).trim();
    
    // ドメインと地域を更新（空欄でなければ）
    if (domain) currentDomain = domain;
    if (area) currentArea = area;
    
    // mediaが「meta」の行に書き込み
    if (media === 'meta') {
      const key = `${currentDomain}|${currentArea}`;
      const spend = aggregatedData[key] || 0;
      
      if (spend > 0) {
        sheet.getRange(rowIndex, monthCol).setValue(spend);
        Logger.log(`書き込み: 行${rowIndex} (${currentDomain}/${currentArea}/meta) = ${spend}`);
      }
    }
  }
}

/**
 * 月ラベルに対応する列を検索
 * @param {Sheet} sheet - シート
 * @param {string} monthLabel - 月ラベル（例：2024/01）
 * @returns {number|null} 列番号またはnull
 */
function findMonthColumn(sheet, monthLabel) {
  const lastCol = sheet.getLastColumn();
  const headerRow = sheet.getRange(CONFIG.HEADER_ROW, CONFIG.MONTH_START_COL, 1, lastCol - CONFIG.MONTH_START_COL + 1).getValues()[0];
  
  for (let i = 0; i < headerRow.length; i++) {
    const cellValue = headerRow[i];
    let cellMonthLabel = '';
    
    // 日付オブジェクトの場合
    if (cellValue instanceof Date) {
      const year = cellValue.getFullYear();
      const month = cellValue.getMonth() + 1;
      cellMonthLabel = `${year}/${String(month).padStart(2, '0')}`;
    } 
    // 文字列の場合
    else if (typeof cellValue === 'string') {
      cellMonthLabel = cellValue.trim();
    }
    
    if (cellMonthLabel === monthLabel) {
      return CONFIG.MONTH_START_COL + i;
    }
  }
  
  return null;
}

// ===========================================
// トリガー設定関数
// ===========================================

/**
 * 毎日実行のトリガーを設定
 */
function createDailyTrigger() {
  // 既存のトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'updateMetaAdSpend') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  
  // 新しいトリガーを作成（毎日午前6時に実行）
  ScriptApp.newTrigger('updateMetaAdSpend')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
  
  Logger.log('毎日午前6時に実行するトリガーを設定しました');
}

/**
 * トリガーを削除
 */
function deleteTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'updateMetaAdSpend') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  Logger.log('トリガーを削除しました');
}

// ===========================================
// テスト・デバッグ関数
// ===========================================

/**
 * 設定確認用
 */
function testConfig() {
  Logger.log('=== 設定確認 ===');
  Logger.log(`スプレッドシートID: ${CONFIG.SPREADSHEET_ID}`);
  Logger.log(`メインシート名: ${CONFIG.MAIN_SHEET_NAME}`);
  Logger.log(`対応表シート名: ${CONFIG.MAPPING_SHEET_NAME}`);
  Logger.log(`Meta API Version: ${CONFIG.META_API_VERSION}`);
  Logger.log(`広告アカウントID: ${CONFIG.META_AD_ACCOUNT_ID}`);
  
  // 期間計算テスト
  const period = calculateCurrentPeriod();
  Logger.log(`現在の集計期間: ${period.startDate} 〜 ${period.endDate}`);
  Logger.log(`対象月: ${period.monthLabel}`);
}

/**
 * 対応表読み込みテスト
 */
function testLoadMapping() {
  const mappingData = loadMappingSheet();
  Logger.log(`対応表エントリ数: ${mappingData.length}`);
  for (const entry of mappingData) {
    Logger.log(`${entry.domain} / ${entry.area}: ${entry.keywords.length}件のキーワード`);
  }
}

/**
 * Meta API接続テスト
 */
function testMetaApiConnection() {
  try {
    const period = calculateCurrentPeriod();
    const adSetData = fetchMetaAdSetInsights(period.startDate, period.endDate);
    Logger.log(`取得成功: ${adSetData.length}件の広告セット`);
    
    // 最初の5件を表示
    for (let i = 0; i < Math.min(5, adSetData.length); i++) {
      const adset = adSetData[i];
      Logger.log(`  ${adset.adset_name}: ${adset.spend}`);
    }
  } catch (error) {
    Logger.log(`API接続エラー: ${error.message}`);
  }
}