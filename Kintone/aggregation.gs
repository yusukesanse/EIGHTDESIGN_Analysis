// ============================================================
// aggregation.gs — ドメインシート集計（全面再計算方式）
// ------------------------------------------------------------
// 一覧シート（例: 名古屋-一般住宅）を読み直し、ドメインシートに存在する
// 全管理年度と B1 選択年度の詳細ブロックを全面再計算して値で書き込む。
//
// 方針（2026-07-24 決定）:
//   - スプレッドシート数式による集計は廃止し、GAS で全面再計算する
//   - 差分加算はしない（Webhook とは独立に、毎回一覧シートから数え直す）
//   - 年別列は過去年を含む全管理年度を再計算し、一覧から消えた値もゼロへ戻す
//   - 担当者別・詳細ブロックの対象年度はドメインシートの B1（「2026年」形式）を優先し、
//     無ければ現在日付から集計年度ルール（21日繰り上げ）で算出する
//
// エントリポイント:
//   - runDomainAggregation()            … 18シート全部を再計算（手動実行/トリガー共用）
//   - runDomainAggregationForSheet(type, area) … 1シートのみ再計算（デバッグ用）
//   - dryRunDomainAggregation()         … 【書き込まない】18シート分を計算し、現在値との差分をログに出す
//   - dryRunDomainAggregationForSheet(type, area) … 【書き込まない】1シートの差分を詳細ログに出す
//   - createAggregationDailyTrigger()   … 毎日7時の定期実行トリガーを作成
//   - createAggregationHourlyTrigger()  … 毎時の定期実行トリガーを作成
//   - deleteAggregationTriggers()       … 本集計のトリガーを全削除
// ============================================================

// ============================================================
// 対象ドメイン定義
// ------------------------------------------------------------
// AGG_AREAS / AGG_DOMAINS は config.gs 側に置く。GAS は .gs をファイル名順に
// 評価するため（aggregation は config より先）、ここで AREAS / CUSTOMER_TYPES を
// トップレベル参照すると "Cannot access 'AREAS' before initialization" になる。
// ============================================================

/**
 * ドメインシート名を組み立てる
 * @param {string} domainType 顧客種別（例: '一般住宅'）
 * @param {string} area エリア（例: '名古屋'）
 * @returns {string} 例: '【一般住宅】名古屋'
 */
function buildDomainSheetName(domainType, area) {
  return `【${domainType}】${area}`;
}

// ============================================================
// ドメインシートの行アンカー定義
// （全18シートで共通の骨格。xlsx実物とold graphコードで検証済み）
// ============================================================

/** 両レイアウト共通ブロック */
const AGG_ROWS = {
  FUNNEL_HEADER:  34,   // 年ヘッダー行（B34〜に「2019年」…）
  FUNNEL_START:   35,   // 反響者/来場者/再来者/3回目以上/成約/各率 = 10行
  MONTHLY_HEADER: 69,   // 年ヘッダー行
  MONTHLY_START:  70,   // 1月〜12月＋計 = 13行
  STAFF_HEADER:  107,   // 担当者名ヘッダー行（B107〜。'その他'=受け皿、'計'/'合計'=合計列）
  STAFF_START:   108,   // 反響数/来場数/再来数/3回目以上/成約/反響来場率/再アポ率/歩留 = 8行
  MEDIA_ALL_HEADER:    229,  // 反響者×反響媒体 年ヘッダー行（ラベルはA230〜'合計'）
  MEDIA_CLOSED_HEADER: 285,  // 成約者×反響媒体
  AREA_ALL_HEADER:     341,  // 反響者×エリア（ラベルはA342〜'合計'）
  AREA_CLOSED_HEADER:  471,  // 成約者×エリア
};

/** 住宅系（一般住宅・新築）専用ブロック */
const AGG_RESIDENTIAL_ROWS = {
  INCOME_AGE_START:    121,  // 年収×年齢: 年収9区分＋計 = 10行、反響者=B〜J / 契約者=M〜U
  AGE_FAMILY_START:    139,  // 家族数×年齢: 家族数7区分＋計 = 8行
  ATTR_INDUSTRY_START: 152,  // 属性×業界: 業界20区分＋計 = 21行
  NEEDS_BLOCKS: [            // 問い合わせニーズ（反響/来場/契約/来場率/歩留 = 5行、B〜G列）
    { filterCol: 32, startRow: 178 },  // 一次取得
    { filterCol: 33, startRow: 186 },  // 持家
    { filterCol: 34, startRow: 194 },  // 実家など
  ],
  CONSIDERATION_ROW:   178,  // 検討レベル総数（M〜T列: 成約/大/中/小/未/長期追客/無/合計）
  LEAVING_HEADER:      182,  // 離脱理由ヘッダー行（L=ラベル、M=理由総数、N〜=担当者）
  LEAVING_START:       183,  // 理由行（L列ラベル）〜'合計'行
  YEAR_LABEL_CELLS: [        // 「20XX年」表記なら対象年度に更新する候補セル
    'A107', 'A119', 'L119', 'A120', 'L120', 'A137', 'L137', 'A138',
    'A151', 'L151', 'A175', 'A176', 'A177', 'A193', 'L177', 'L181', 'L182',
  ],
};

/** 法人系専用ブロック */
const AGG_BUSINESS_ROWS = {
  INDUSTRY_SCALE_HEADER: 120,  // 業種×企業規模: 企業規模ヘッダー（B〜）、業種はA121〜'計'手前
  JOB_TITLE_HEADER:      144,  // 肩書×企業規模: 同構造（肩書はA145〜）
  TYPE_NEEDS_HEADER:     154,  // 業態×業種(反響者): B=独立/C=既存店舗/D=新店舗/E=合計
  TYPE_NEEDS_CLOSED_HEADER: 176,  // 業態×業種(契約者)
  EVENT_HEADER:          154,  // 集客イベント: L154〜ヘッダー、L155〜=反響/来場/契約/来場率/歩留
  YEAR_LABEL_CELLS: [
    'A107', 'A120', 'L120', 'A144', 'L144', 'A154', 'A176',
  ],
};

// ============================================================
// 区分定義（クロス集計）
// ============================================================

/** 年齢区分（min 超 max 以下）。列順はシートのヘッダー順（〜24歳/25〜30/…/60歳〜/不明） */
const AGG_AGE_SECTIONS = [
  { min: 0,  max: 24 },
  { min: 24, max: 30 },
  { min: 30, max: 36 },
  { min: 36, max: 43 },
  { min: 43, max: 48 },
  { min: 48, max: 59 },
  { min: 59, max: Infinity },
];

/** 年収区分（円、0 超 max 以下）。行順はシートのラベル順（〜400万円/…/1000万〜/不明） */
const AGG_INCOME_SECTIONS = [
  { max: 4000000 },
  { max: 5000000 },
  { max: 6000000 },
  { max: 7000000 },
  { max: 8000000 },
  { max: 9000000 },
  { max: 10000000 },
  { max: Infinity },
];

/** 家族数区分数（1人〜6人。範囲外は不明） */
const AGG_FAMILY_MAX = 6;

/**
 * 職業 → 属性列インデックス（0始まり）
 * シート列順: 会社員 / 会社員(上場) / 経営者・役員 / 公務員・士業 / 自営業・自由業 / 教員 / 医師 / 不明
 */
const AGG_OCCUPATION_TO_ATTR = {
  '会社員':                             0,
  '会社員（上場企業）':                 1,
  '会社経営者':                         2,
  '会社役員':                           2,
  '公務員':                             3,
  '士業（弁護士・行政書士・税理士など）': 3,
  '自営業':                             4,
  '自由業':                             4,
  '教員':                               5,
  '医師（開業医）':                     6,
  '医師（勤務医）':                     6,
};

/** 属性の列数（不明を含む。計は含まない） */
const AGG_ATTR_COUNT = 8;

/**
 * 業界名 → 行インデックス（0始まり）。シートの行ラベル順
 */
const AGG_INDUSTRY_TO_IDX = {
  '製造': 0,  'クリエイター': 1, 'IT': 2,      'サービス': 3,  'アパレル': 4,
  '医療福祉': 5, '飲食': 6,       '運輸': 7,    '教育': 8,     '金融': 9,
  '建設': 10, '公官庁': 11,     '小売': 12,   '士業': 13,    '出版・広告': 14,
  '造船': 15, '通信': 16,       '美容': 17,   '不動産': 18,
};

/** 業界の行数（不明を含む。計は含まない） */
const AGG_INDUSTRY_COUNT = 20;

/**
 * 見込度/商談状況 → 検討レベル列インデックス（0始まり）
 * シート列順（M〜S）: 成約 / 大 / 中 / 小 / 未 / 長期追客 / 無
 */
const AGG_CONSIDERATION_MAP = {
  '成約': 0, 'A': 0,
  '大': 1, '見込み大': 1, 'B-A': 1,
  '中': 2, '見込み中': 2, 'B-B': 2,
  '小': 3, '見込み小': 3, 'B-C': 3,
  '未': 4, 'B-D': 4, '不明': 4, '追客中': 4,
  '長期追客': 5, 'C': 5,
  '無': 6, '見込み無': 6, 'D': 6, '追客終了': 6,
};

/** 検討レベルの列数（合計は含まない） */
const AGG_CONSIDERATION_COUNT = 7;

/** 合計ラベルとして扱う文字列 */
const AGG_TOTAL_LABELS = ['計', '合計'];

/** その他（受け皿）ラベル */
const AGG_OTHER_LABEL = 'その他';

/**
 * 分類できない値の受け皿として使えるラベル（優先順）。
 * 方針（2026-07-28 決定）: 語彙に無い値は集計を止めず「不明」へ寄せる。
 * ただし受け皿行/列がシートに1つも無い場合だけは、合計が反響数と食い違う
 * ため黙って落とさずエラーにする。
 */
const AGG_UNKNOWN_LABELS = [AGG_OTHER_LABEL, '不明'];

/**
 * エリア別ブロック専用の受け皿ラベル（優先順）。
 * 実シートのエリアブロックには「その他」「不明」行が無く、末尾側の
 * 「他都道府県」が唯一の受け皿になる（2026-07-28 決定）。
 * 顧客情報アプリのWebhookは希望エリア列（18・19列）を書かないため、
 * 営業側の更新が来るまでエリアは空欄であり、受け皿が無いと集計できない。
 */
const AGG_AREA_UNKNOWN_LABELS = [AGG_OTHER_LABEL, '不明', '他都道府県'];

/**
 * 離脱理由ブロック専用の受け皿ラベル（優先順）。
 * 実シートの理由一覧に「理由不明」があり、ここが唯一の受け皿になる。
 * 理由が空欄の行はそもそも離脱していないため、受け皿へは入れない。
 */
const AGG_LEAVING_UNKNOWN_LABELS = [AGG_OTHER_LABEL, '理由不明', '不明'];

/** 一覧シートで集計可能な正規化済みランク */
const AGG_ALLOWED_RANKS = ['A', 'B-A', 'B-B', 'B-C', 'B-D', 'C', 'D'];

/** 検討レベルで分類できない見込度を寄せる区分（「未」＝不明と同じ列） */
const AGG_CONSIDERATION_UNKNOWN_INDEX = 4;

/** 対象年度セルの書式（例: 2026年） */
const AGG_YEAR_PATTERN = /^20\d{2}年$/;

/** 一覧シート反響月セルの書式（例: 2月） */
const AGG_MONTH_PATTERN = /^(?:[1-9]|1[0-2])月$/;

/** 集計不能行をまとめて報告するときの列挙上限 */
const AGG_INVALID_ROW_SAMPLE_LIMIT = 20;

/**
 * 年度列を持つ必須ブロック。
 * 各ブロックに存在する全年度を再計算し、一覧に存在する年度と B1 選択年度は
 * 全ブロックにヘッダーが存在することを preflight で保証する。
 */
const AGG_YEARLY_SECTIONS = [
  { key: 'funnel',     label: '年別ファネル',   headerRow: AGG_ROWS.FUNNEL_HEADER },
  { key: 'monthly',    label: '月別反響数',     headerRow: AGG_ROWS.MONTHLY_HEADER },
  { key: 'mediaAll',   label: '反響媒体（全体）', headerRow: AGG_ROWS.MEDIA_ALL_HEADER },
  { key: 'mediaClosed', label: '反響媒体（成約）', headerRow: AGG_ROWS.MEDIA_CLOSED_HEADER },
  { key: 'areaAll',    label: 'エリア（全体）', headerRow: AGG_ROWS.AREA_ALL_HEADER },
  { key: 'areaClosed', label: 'エリア（成約）', headerRow: AGG_ROWS.AREA_CLOSED_HEADER },
];

/** 定期集計がWebhookと共有するScriptLockの待機上限 */
const AGG_LOCK_TIMEOUT_MS = 30000;

// ============================================================
// エントリポイント
// ============================================================

/**
 * 全ドメインシート（9ドメイン×2エリア）を再計算する
 * 手動実行・定期トリガーの両方から呼ばれる
 */
function runDomainAggregation() {
  const startedAtMs = Date.now();
  const ss = getSpreadsheet();
  const results = [];
  const jobContext = createSyncOperationContext('FULL_AGGREGATION', {
    status: 'STARTED',
    stage: 'START',
    targetCount: AGG_AREAS.length * AGG_DOMAINS.length,
  });

  try {
    _withAggregationScriptLock(() => recordSyncJob(jobContext, ss));
  } catch (ledgerError) {
    if (!ledgerError.stage) ledgerError.stage = 'LOG_START';
    Object.assign(jobContext, {
      status: 'FAILED',
      stage: 'LOG_START',
      elapsedMs: Date.now() - startedAtMs,
      processedCount: 0,
      succeededCount: 0,
      failedCount: 0,
      error: ledgerError,
    });
    _recordAggregationJobFailure(jobContext, ledgerError, ss);
    throw ledgerError;
  }

  for (const area of AGG_AREAS) {
    for (const domain of AGG_DOMAINS) {
      const sheetStartedAtMs = Date.now();
      try {
        // 1組ごとにロックを解放し、長い18組処理の間にもWebhookが収束できるようにする。
        results.push(_withAggregationScriptLock(
          () => _runDomainAggregationForSheet(domain.type, area, ss)
        ));
      } catch (e) {
        results.push({
          status: 'FAILED',
          success: false,
          domainType: domain.type,
          area,
          listSheetName: buildListSheetName(area, domain.type),
          domainSheetName: buildDomainSheetName(domain.type, area),
          targetSheet: e.targetSheet || buildDomainSheetName(domain.type, area),
          stage: e.stage || 'UNKNOWN',
          message: e.message,
          durationMs: e.aggregationResult?.durationMs ?? (Date.now() - sheetStartedAtMs),
        });
      }
    }
  }

  const failed = results.filter((result) => !result.success);
  const succeeded = results.length - failed.length;
  const summary = {
    status: failed.length === 0 ? 'SUCCESS' : 'FAILED',
    success: failed.length === 0,
    total: results.length,
    succeeded,
    failed: failed.length,
    durationMs: Date.now() - startedAtMs,
    results,
  };

  Object.assign(jobContext, {
    status: failed.length === 0
      ? 'SUCCEEDED'
      : (succeeded === 0 ? 'FAILED' : 'PARTIAL_FAILURE'),
    stage: 'COMPLETE',
    elapsedMs: summary.durationMs,
    processedCount: results.length,
    succeededCount: succeeded,
    failedCount: failed.length,
    changedCells: results
      .filter((result) => result.success)
      .reduce((sum, result) => sum + (Number(result.cells) || 0), 0),
    details: { aggregationSummary: summary },
  });

  if (failed.length > 0) {
    const error = new Error(
      `runDomainAggregation: ${failed.length}/${results.length}組の集計に失敗しました`
    );
    error.name = 'DomainAggregationBatchError';
    error.stage = 'BATCH_COMPLETE';
    error.aggregationSummary = summary;
    jobContext.error = error;

    try {
      _withAggregationScriptLock(() => recordSyncJob(jobContext, ss));
    } catch (ledgerError) {
      if (!ledgerError.stage) ledgerError.stage = 'LOG_COMPLETE';
      error.ledgerError = normalizeSyncLedgerError(ledgerError);
      Object.assign(jobContext, {
        stage: 'LOG_COMPLETE',
        error,
      });
      _recordAggregationJobFailure(jobContext, error, ss);
    }

    AppLogger.error('runDomainAggregation: 一部シートの集計に失敗', error, {
      failed: failed.map((result) =>
        `${result.domainSheetName}[${result.stage}]: ${result.message}`
      ).join(' / '),
      durationMs: summary.durationMs,
    });
    throw error;
  }

  AppLogger.info('runDomainAggregation: 全シート集計完了', {
    total: summary.total,
    durationMs: summary.durationMs,
  });
  try {
    _withAggregationScriptLock(() => recordSyncJob(jobContext, ss));
  } catch (ledgerError) {
    if (!ledgerError.stage) ledgerError.stage = 'LOG_COMPLETE';
    Object.assign(jobContext, {
      status: 'FAILED',
      stage: 'LOG_COMPLETE',
      error: ledgerError,
    });
    _recordAggregationJobFailure(jobContext, ledgerError, ss);
    throw ledgerError;
  }
  return summary;
}

/**
 * 定期処理の永続ログ障害を、元エラーを上書きせず再記録する。
 * ScriptLock取得自体に失敗した場合もconsole/Loggerへフォールバックする。
 *
 * @param {Object} context
 * @param {*} primaryError
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @returns {boolean}
 * @private
 */
function _recordAggregationJobFailure(context, primaryError, spreadsheet) {
  try {
    return _withAggregationScriptLock(
      () => recordSyncJobSafe(context, primaryError, spreadsheet)
    );
  } catch (lockError) {
    try {
      _syncLedgerConsoleFallback(
        SYNC_LEDGER_KIND.JOB,
        context,
        primaryError,
        lockError
      );
    } catch (fallbackError) {
      // 元の処理エラーを守るため何も投げない。
    }
    return false;
  }
}

/**
 * 定期集計の1組処理、手動個別実行、ジョブログをWebhookの一覧更新から排他する。
 * Webhookは既に同じScriptLockを保持するため、内部共通経路
 * `_runDomainAggregationForSheet()` を直接呼ぶ。
 *
 * @param {Function} action
 * @returns {*}
 */
function _withAggregationScriptLock(action) {
  const lock = LockService.getScriptLock();
  let acquired = false;
  try {
    lock.waitLock(AGG_LOCK_TIMEOUT_MS);
    acquired = true;
    return action();
  } catch (error) {
    if (!acquired && !error.stage) error.stage = 'LOCK_WAIT';
    throw error;
  } finally {
    if (acquired) lock.releaseLock();
  }
}

/**
 * 1ドメインシートのみを厳格に全面再計算する（Webhook・個別実行共用）
 * @param {string} domainType 顧客種別（例: '一般住宅'）
 * @param {string} area エリア（'名古屋' or '東京'）
 * @returns {{
 *   status: string, success: boolean, domainType: string, area: string,
 *   listSheetName: string, domainSheetName: string, targetYear: string,
 *   managedYears: string[], sourceRows: number, blocks: number, cells: number,
 *   verifiedCells: number, durationMs: number
 * }}
 * @throws {Error} 入力・シート構造・書き込み・検証のいずれかに失敗した場合
 */
function runDomainAggregationForSheet(domainType, area) {
  return _withAggregationScriptLock(
    () => _runDomainAggregationForSheet(domainType, area)
  );
}

/**
 * 個別実行と18組定期実行が共有する経路。
 * @param {string} domainType
 * @param {string} area
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [ss]
 * @returns {ReturnType<typeof _aggregateOneSheet>}
 */
function _runDomainAggregationForSheet(domainType, area, ss) {
  const startedAtMs = Date.now();
  let stage = 'VALIDATE_TARGET';
  let domain;

  try {
    domain = _resolveAggregationDomain(domainType, area);
    stage = 'OPEN_SPREADSHEET';
    const spreadsheet = ss || getSpreadsheet();
    stage = 'AGGREGATE_SHEET';
    return _aggregateOneSheet(spreadsheet, domain, area);
  } catch (e) {
    const targetSheet = buildDomainSheetName(domainType, area);
    const error = _annotateAggregationError(e, {
      stage,
      targetSheet,
      domainType,
      area,
      durationMs: Date.now() - startedAtMs,
    });
    AppLogger.error('runDomainAggregationForSheet: 集計に失敗', error, {
      domainType,
      area,
      targetSheet: error.targetSheet,
      stage: error.stage,
      durationMs: error.aggregationResult.durationMs,
    });
    throw error;
  }
}

// ============================================================
// ドライラン（書き込まずに現在値との差分をログへ出す動作確認用）
// ============================================================

/**
 * 【書き込まない】全ドメインシートを計算し、現在のセル値との差分サマリーをログへ出す
 * GASエディタから実行し、「実行ログ」で結果を確認する
 */
function dryRunDomainAggregation() {
  const ss = getSpreadsheet();
  const lines = [];
  for (const area of AGG_AREAS) {
    for (const domain of AGG_DOMAINS) {
      try {
        const r = _dryRunOneSheet(ss, domain, area, 3);
        lines.push(r ? `${r.sheet} | 対象年度=${r.targetYear} ブロック=${r.blocks} セル=${r.cells} 差分=${r.diffs}` +
          (r.samples.length ? ` (例: ${r.samples.join(' , ')})` : '')
          : `${buildDomainSheetName(domain.type, area)} | スキップ（シートなし）`);
      } catch (e) {
        lines.push(`${buildDomainSheetName(domain.type, area)} | エラー: ${e.message}`);
      }
    }
  }
  AppLogger.info('dryRunDomainAggregation 結果（書き込みはしていません）\n' + lines.join('\n'));
}

/**
 * 【書き込まない】1ドメインシートを計算し、差分を詳細ログへ出す
 * @param {string} domainType 顧客種別（例: '一般住宅'）
 * @param {string} area エリア（'名古屋' or '東京'）
 */
function dryRunDomainAggregationForSheet(domainType, area) {
  const domain = AGG_DOMAINS.find((d) => d.type === domainType);
  if (!domain) throw new Error(`未対応のドメインです: ${domainType}`);
  const r = _dryRunOneSheet(getSpreadsheet(), domain, area, 50);
  if (!r) return;
  AppLogger.info(
    `dryRun ${r.sheet} | 対象年度=${r.targetYear} ブロック=${r.blocks} セル=${r.cells} 差分=${r.diffs}\n` +
    (r.samples.length ? r.samples.join('\n') : '（差分なし: 現在のシート値と完全一致）')
  );
}

/**
 * 1シート分のドライランを実行し、差分サマリーを返す（シートには書き込まない）
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {{ type: string, style: string }} domain
 * @param {string} area
 * @param {number} maxSamples ログに載せる差分例の上限
 * @returns {{ sheet: string, targetYear: string, blocks: number, cells: number, diffs: number, samples: string[] }|null}
 */
function _dryRunOneSheet(ss, domain, area, maxSamples) {
  const listSheetName = buildListSheetName(area, domain.type);
  const listSheet   = ss.getSheetByName(listSheetName);
  const domainSheet = ss.getSheetByName(buildDomainSheetName(domain.type, area));
  if (!listSheet || !domainSheet) return null;

  const grid       = domainSheet.getDataRange().getValues();
  const listData   = listSheet.getDataRange().getValues();
  const targetYear = resolveAggregationYear(grid);
  const writes     = buildAggregationWrites(
    grid, listData, targetYear, domain.style, listSheetName
  );
  const diff       = _diffAggregationWrites(grid, writes, maxSamples);

  return {
    sheet: domainSheet.getName(),
    targetYear,
    blocks: writes.length,
    cells: diff.cells,
    diffs: diff.diffs,
    samples: diff.samples,
  };
}

/**
 * 書き込み指示と現在のグリッド値を比較する（純粋関数）
 * @param {Array<Array<*>>} grid 現在のシート全データ（0始まり）
 * @param {Array<{ row: number, col: number, values: Array<Array<*>> }>} writes
 * @param {number} maxSamples 差分例の上限
 * @returns {{ cells: number, diffs: number, samples: string[] }}
 */
function _diffAggregationWrites(grid, writes, maxSamples) {
  let cells = 0;
  let diffs = 0;
  const samples = [];
  for (const w of writes) {
    for (let r = 0; r < w.values.length; r++) {
      for (let c = 0; c < w.values[r].length; c++) {
        cells++;
        const current = grid[w.row - 1 + r]?.[w.col - 1 + c] ?? '';
        const next    = w.values[r][c];
        if (_aggValuesEqual(current, next)) continue;
        diffs++;
        if (samples.length < maxSamples) {
          samples.push(`${_toA1(w.row + r, w.col + c)}: ${_formatCellForLog(current)} → ${_formatCellForLog(next)}`);
        }
      }
    }
  }
  return { cells, diffs, samples };
}

/**
 * セル値の実質同値判定（数値は誤差許容、空文字と0は別物として扱う）
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function _aggValuesEqual(a, b) {
  const aEmpty = a === '' || a === null || a === undefined;
  const bEmpty = b === '' || b === null || b === undefined;
  if (aEmpty || bEmpty) return aEmpty === bEmpty;
  const an = Number(a);
  const bn = Number(b);
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return Math.abs(an - bn) < 1e-9;
  return String(a) === String(b);
}

/**
 * 行・列番号（1始まり）をA1形式にする
 * @param {number} row
 * @param {number} col
 * @returns {string}
 */
function _toA1(row, col) {
  let letters = '';
  let n = col;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return `${letters}${row}`;
}

/**
 * ログ表示用にセル値を短く整形する（率は小数4桁へ丸め）
 * @param {*} v
 * @returns {string}
 */
function _formatCellForLog(v) {
  if (v === '' || v === null || v === undefined) return '(空)';
  const n = Number(v);
  if (!Number.isNaN(n) && !Number.isInteger(n)) return String(Math.round(n * 10000) / 10000);
  return String(v);
}

// ============================================================
// トリガー管理
// ============================================================

/** 定期実行トリガーが呼ぶ関数名 */
const AGG_TRIGGER_HANDLER = 'runDomainAggregation';

/** 毎日7時の定期実行トリガーを作成する（既存の同種トリガーは事前に削除） */
function createAggregationDailyTrigger() {
  deleteAggregationTriggers();
  ScriptApp.newTrigger(AGG_TRIGGER_HANDLER).timeBased().everyDays(1).atHour(7).create();
  AppLogger.info('createAggregationDailyTrigger: 作成完了', {});
}

/** 毎時の定期実行トリガーを作成する（既存の同種トリガーは事前に削除） */
function createAggregationHourlyTrigger() {
  deleteAggregationTriggers();
  ScriptApp.newTrigger(AGG_TRIGGER_HANDLER).timeBased().everyHours(1).create();
  AppLogger.info('createAggregationHourlyTrigger: 作成完了', {});
}

/** 本集計の定期実行トリガーを全削除する */
function deleteAggregationTriggers() {
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === AGG_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}

// ============================================================
// シート単位の集計フロー
// ============================================================

/**
 * 対象ドメインとエリアを検証し、ドメイン定義を返す。
 * 「遠方」は呼び出し元で「名古屋」へ解決済みであることを前提とする。
 * @param {string} domainType
 * @param {string} area
 * @returns {{ type: string, style: string }}
 */
function _resolveAggregationDomain(domainType, area) {
  if (!AGG_AREAS.includes(area)) {
    throw new Error(`未対応の集計エリアです: ${area}`);
  }
  const domain = AGG_DOMAINS.find((candidate) => candidate.type === domainType);
  if (!domain) {
    throw new Error(`未対応のドメインです: ${domainType}`);
  }
  return domain;
}

/**
 * 呼び出し元が処理段階と対象シートを必ず記録できるよう、Errorへ集計情報を付与する。
 * 既に詳細な段階が付いている場合は上書きしない。
 * @param {*} cause
 * @param {{
 *   stage: string, targetSheet: string, domainType: string, area: string,
 *   durationMs: number
 * }} metadata
 * @returns {Error}
 */
function _annotateAggregationError(cause, metadata) {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  if (!error.stage) error.stage = metadata.stage;
  if (!error.targetSheet) error.targetSheet = metadata.targetSheet;

  const existing = error.aggregationResult || {};
  error.aggregationResult = {
    status: 'FAILED',
    success: false,
    domainType: existing.domainType || metadata.domainType,
    area: existing.area || metadata.area,
    targetSheet: existing.targetSheet || error.targetSheet,
    stage: existing.stage || error.stage,
    durationMs: existing.durationMs ?? metadata.durationMs,
    message: existing.message || error.message,
  };
  return error;
}

/**
 * 1シート分の集計を実行する
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {{ type: string, style: string }} domain
 * @param {string} area
 * @returns {{
 *   status: string, success: boolean, domainType: string, area: string,
 *   listSheetName: string, domainSheetName: string, targetYear: string,
 *   managedYears: string[], sourceRows: number, blocks: number, cells: number,
 *   verifiedCells: number, durationMs: number
 * }}
 */
function _aggregateOneSheet(ss, domain, area) {
  const startedAtMs = Date.now();
  const listSheetName   = buildListSheetName(area, domain.type);
  const domainSheetName = buildDomainSheetName(domain.type, area);
  let stage = 'RESOLVE_SHEETS';

  try {
    const listSheet = ss.getSheetByName(listSheetName);
    if (!listSheet) {
      throw _annotateAggregationError(
        new Error(`一覧シートが見つかりません: ${listSheetName}`),
        {
          stage,
          targetSheet: listSheetName,
          domainType: domain.type,
          area,
          durationMs: Date.now() - startedAtMs,
        }
      );
    }

    const domainSheet = ss.getSheetByName(domainSheetName);
    if (!domainSheet) {
      throw _annotateAggregationError(
        new Error(`集計シートが見つかりません: ${domainSheetName}`),
        {
          stage,
          targetSheet: domainSheetName,
          domainType: domain.type,
          area,
          durationMs: Date.now() - startedAtMs,
        }
      );
    }

    stage = 'READ_LIST_SHEET';
    const listData = listSheet.getDataRange().getValues();
    stage = 'READ_DOMAIN_SHEET';
    const grid = domainSheet.getDataRange().getValues();
    const targetYear = resolveAggregationYear(grid);

    // B1 の対象年度は人が選べる。今年度から取り残されると、今年度の反響が
    // どの列にも入らないまま成功し続けるため、ズレを気付けるよう警告に残す。
    const currentYear = computeCurrentAggregationYear();
    if (targetYear !== currentYear) {
      AppLogger.warn(
        `_aggregateOneSheet: 対象年度が今年度と異なります（B1優先）: ${domainSheetName} ` +
        `対象年度=${targetYear} / 今年度=${currentYear}`
      );
    }

    stage = 'PREFLIGHT';
    const preflight = _validateAggregationPreflight(
      grid, listData, targetYear, domain.style, listSheetName
    );
    stage = 'BUILD_WRITES';
    const plan = _buildAggregationPlan(grid, listData, targetYear, domain.style, preflight);
    const writeStats = _validateAggregationWrites(plan.writes);

    stage = 'WRITE_VALUES';
    // 新しい年度列がシートの右端を越える場合だけ列を足す（既存列には触れない）
    _ensureSheetWidthForWrites(domainSheet, plan.writes);
    if (plan.newYearColumns.length > 0) {
      AppLogger.info(
        `_aggregateOneSheet: ${targetYear}の年度列を新設します: ${domainSheetName} ` +
        plan.newYearColumns.join(' / ')
      );
    }
    _applyAggregationWrites(domainSheet, plan.writes);
    if (typeof SpreadsheetApp !== 'undefined' && typeof SpreadsheetApp.flush === 'function') {
      SpreadsheetApp.flush();
    }

    stage = 'VERIFY_WRITES';
    const writtenGrid = domainSheet.getDataRange().getValues();
    const verification = _diffAggregationWrites(writtenGrid, plan.writes, 10);
    if (verification.diffs > 0) {
      throw new Error(
        `書き込み後の検証で${verification.diffs}セルの不一致を検出しました` +
        (verification.samples.length > 0 ? `: ${verification.samples.join(' / ')}` : '')
      );
    }

    // 年度セルが読めず今年度か判別できなかった行は、黙って落とさず警告に残す。
    if (plan.unreadableRows && plan.unreadableRows.length > 0) {
      AppLogger.warn(
        `_aggregateOneSheet: 年度が読めない行を集計対象外にしました: ${listSheetName} ` +
        plan.unreadableRows
          .slice(0, AGG_INVALID_ROW_SAMPLE_LIMIT)
          .map((r) => `${r.cell}=${r.shown}（${r.customerName}）`)
          .join(' / ')
      );
    }

    const result = {
      status: 'SUCCESS',
      success: true,
      domainType: domain.type,
      area,
      listSheetName,
      domainSheetName,
      targetYear,
      managedYears: plan.managedYears,
      sourceRows: plan.sourceRows,
      skippedOtherYears: plan.skippedOtherYears,
      unreadableRows: (plan.unreadableRows || []).length,
      newYearColumns: plan.newYearColumns,
      blocks: plan.writes.length,
      cells: writeStats.cells,
      verifiedCells: verification.cells,
      durationMs: Date.now() - startedAtMs,
    };

    AppLogger.info('_aggregateOneSheet: 集計・検証完了', result);
    return result;
  } catch (e) {
    throw _annotateAggregationError(e, {
      stage,
      targetSheet: domainSheetName,
      domainType: domain.type,
      area,
      durationMs: Date.now() - startedAtMs,
    });
  }
}

/**
 * 書き込み指示が右端を越える場合に限り、シートへ列を足す。
 * 年度が切り替わって新しい年度列を作るときだけ効く。既存の列構成は変えない。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Array<{ row: number, col: number, values: Array<Array<*>> }>} writes
 */
function _ensureSheetWidthForWrites(sheet, writes) {
  if (typeof sheet.getMaxColumns !== 'function') return;
  let requiredColumns = 0;
  for (const w of writes) {
    requiredColumns = Math.max(requiredColumns, w.col + w.values[0].length - 1);
  }
  const maxColumns = sheet.getMaxColumns();
  if (requiredColumns > maxColumns) {
    sheet.insertColumnsAfter(maxColumns, requiredColumns - maxColumns);
    AppLogger.info('集計シートへ列を追加', {
      sheet: sheet.getName(),
      added: requiredColumns - maxColumns,
    });
  }
}

/**
 * 書き込み指示の配列をシートへ適用する
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Array<{ row: number, col: number, values: Array<Array<*>> }>} writes
 */
function _applyAggregationWrites(sheet, writes) {
  for (const w of writes) {
    sheet.getRange(w.row, w.col, w.values.length, w.values[0].length).setValues(w.values);
  }
}

// ============================================================
// 対象年度の決定
// ============================================================

/**
 * 対象年度を決定する
 * ドメインシート B1 が「20XX年」形式ならそれを使い、無ければ現在日付から
 * 集計年度ルール（12/21以降は翌年）で算出する
 *
 * @param {Array<Array<*>>} grid ドメインシートの全データ（0始まり）
 * @param {Date} [now] テスト用の現在日時
 * @returns {string} 例: '2026年'
 */
function resolveAggregationYear(grid, now) {
  const b1 = String(grid?.[0]?.[1] ?? '').trim();
  if (AGG_YEAR_PATTERN.test(b1)) return b1;
  return computeCurrentAggregationYear(now);
}

/**
 * 現在日付から集計年度を算出する（反響日の年度ルールと同一）
 * @param {Date} [now]
 * @returns {string} 例: '2026年'
 */
function computeCurrentAggregationYear(now) {
  const d = now ?? new Date();
  const dateText = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
  return transformInquiryDate(dateText).year;
}

// ============================================================
// 集計本体（純粋関数: grid + listData → 書き込み指示）
// ============================================================

/**
 * 1シート分の書き込み指示を組み立てる
 * 年度列を持つブロックは、各ヘッダー行に存在する全管理年度を再計算する。
 * 担当者別・詳細ブロックだけは targetYear（B1選択年度）を使う。
 * @param {Array<Array<*>>} grid ドメインシートの全データ（0始まり）
 * @param {Array<Array<*>>} listData 一覧シートの全データ（0始まり、ヘッダー行含む）
 * @param {string} targetYear 詳細ブロックの対象年度（例: '2026年'）
 * @param {string} style 'residential' | 'business'
 * @param {string} [listSheetName] エラーメッセージ用の一覧シート名
 * @returns {Array<{ row: number, col: number, values: Array<Array<*>> }>}
 */
function buildAggregationWrites(grid, listData, targetYear, style, listSheetName) {
  const preflight = _validateAggregationPreflight(grid, listData, targetYear, style, listSheetName);
  const plan = _buildAggregationPlan(grid, listData, targetYear, style, preflight);
  _validateAggregationWrites(plan.writes);
  return plan.writes;
}

/**
 * preflight済みの入力から1シート分の書き込み計画を組み立てる。
 * @param {Array<Array<*>>} grid
 * @param {Array<Array<*>>} listData
 * @param {string} targetYear
 * @param {string} style
 * @param {ReturnType<typeof _validateAggregationPreflight>} [preflight]
 * @returns {{
 *   writes: Array<{ row: number, col: number, values: Array<Array<*>> }>,
 *   targetYear: string, managedYears: string[], sourceRows: number
 * }}
 */
function _buildAggregationPlan(grid, listData, targetYear, style, preflight) {
  const context = preflight || _validateAggregationPreflight(grid, listData, targetYear, style);
  const writes = [];
  const pushRequired = (writeOrWrites, blockName) => {
    if (!writeOrWrites) {
      throw new Error(`必須集計ブロックを生成できませんでした: ${blockName}`);
    }
    const entries = Array.isArray(writeOrWrites) ? writeOrWrites : [writeOrWrites];
    if (entries.length === 0) {
      throw new Error(`必須集計ブロックが空です: ${blockName}`);
    }
    writes.push(...entries);
  };
  const pushOptional = (writeOrWrites) => {
    if (!writeOrWrites) return;
    writes.push(...(Array.isArray(writeOrWrites) ? writeOrWrites : [writeOrWrites]));
  };
  const yearSets = new Map();
  const getYearSet = (year) => {
    if (!yearSets.has(year)) {
      const all = context.rowsByYear.get(year) || [];
      yearSets.set(year, {
        all,
        closed: all.filter(
          (row) => _cellText(row[SALES_LIST_COLS.RANK - 1]) === 'A'
        ),
      });
    }
    return yearSets.get(year);
  };

  // ── 年別列を持つ共通ブロック（対象年度の1列だけ）────────────
  // 過年度の列は現在の値のまま残す。今年度のデータだけを再計算する方針
  // （2026-07-30 決定）。過年度を計算し直したいときは B1 の対象年度を変える。
  const selected = getYearSet(targetYear);
  const sections = context.yearSections;

  // 年度が切り替わって列がまだ無いブロックは、年ヘッダーセルも同じ書き込み計画で作る。
  for (const key of ['funnel', 'monthly', 'mediaAll', 'mediaClosed', 'areaAll', 'areaClosed']) {
    const section = sections[key];
    if (!section.isNewColumn) continue;
    writes.push({
      row: section.headerRow,
      col: section.targetColIndex + 1,
      values: [[targetYear]],
    });
  }

  pushRequired(
    _buildFunnelWrite(grid, selected.all, targetYear, sections.funnel.targetColIndex),
    `年別ファネル/${targetYear}`
  );
  pushRequired(
    _buildMonthlyWrite(grid, selected.all, targetYear, sections.monthly.targetColIndex),
    `月別反響数/${targetYear}`
  );
  pushRequired(
    _buildLabeledYearColumnWrite(
      grid, selected.all, targetYear, AGG_ROWS.MEDIA_ALL_HEADER, _mediaKeyResolver,
      sections.mediaAll.targetColIndex
    ),
    `反響媒体（全体）/${targetYear}`
  );
  pushRequired(
    _buildLabeledYearColumnWrite(
      grid, selected.closed, targetYear, AGG_ROWS.MEDIA_CLOSED_HEADER, _mediaKeyResolver,
      sections.mediaClosed.targetColIndex
    ),
    `反響媒体（成約）/${targetYear}`
  );
  pushRequired(
    _buildLabeledYearColumnWrite(
      grid, selected.all, targetYear, AGG_ROWS.AREA_ALL_HEADER, _areaKeyResolver,
      sections.areaAll.targetColIndex
    ),
    `エリア（全体）/${targetYear}`
  );
  pushRequired(
    _buildLabeledYearColumnWrite(
      grid, selected.closed, targetYear, AGG_ROWS.AREA_CLOSED_HEADER, _areaKeyResolver,
      sections.areaClosed.targetColIndex
    ),
    `エリア（成約）/${targetYear}`
  );

  // ── 詳細ブロック（対象年度のみ・年別列を持たない）─────────
  pushRequired(_buildStaffWrites(grid, selected.all), '担当者別');

  // ── レイアウト別ブロック ──────────────────────────────────
  if (style === 'residential') {
    pushRequired(_buildIncomeAgeWrites(selected.all, selected.closed), '年収×年齢');
    pushRequired(_buildAgeFamilyWrites(selected.all, selected.closed), '家族数×年齢');
    pushRequired(_buildAttrIndustryWrites(selected.all, selected.closed), '属性×業界');
    pushRequired(_buildNeedsWrites(grid, selected.all), '問い合わせニーズ');
    pushRequired(_buildConsiderationWrite(selected.all), '検討レベル');
    pushRequired(_buildLeavingWrite(grid, selected.all), '離脱理由');
    pushOptional(_buildYearLabelWrites(grid, targetYear, AGG_RESIDENTIAL_ROWS.YEAR_LABEL_CELLS));
  } else {
    pushRequired(_buildCrossMatrixWrites(
      grid, selected.all, selected.closed, AGG_BUSINESS_ROWS.INDUSTRY_SCALE_HEADER,
      (row) => _cellText(row[SALES_LIST_COLS.INDUSTRY - 1]),
      (row) => _cellText(row[SALES_LIST_COLS.WORK_PLACE - 1])
    ), '業種×企業規模');
    pushRequired(_buildCrossMatrixWrites(
      grid, selected.all, selected.closed, AGG_BUSINESS_ROWS.JOB_TITLE_HEADER,
      (row) => _cellText(row[BUSINESS_EXTRA_COLS.JOB_TITLE - 1]),
      (row) => _cellText(row[BUSINESS_EXTRA_COLS.CAPITAL_STOCK - 1])
    ), '肩書×企業規模');
    pushRequired(
      _buildTypeNeedsWrite(grid, selected.all, AGG_BUSINESS_ROWS.TYPE_NEEDS_HEADER),
      '業態×業種（全体）'
    );
    pushRequired(
      _buildTypeNeedsWrite(grid, selected.closed, AGG_BUSINESS_ROWS.TYPE_NEEDS_CLOSED_HEADER),
      '業態×業種（成約）'
    );
    pushRequired(_buildEventWrite(grid, selected.all), '集客イベント');
    pushOptional(_buildYearLabelWrites(grid, targetYear, AGG_BUSINESS_ROWS.YEAR_LABEL_CELLS));
  }

  return {
    writes,
    targetYear,
    managedYears: context.managedYears,
    sourceRows: context.sourceRows,
    skippedOtherYears: context.skippedOtherYears,
    unreadableRows: context.unreadableRows,
    newYearColumns: context.newYearColumns,
  };
}

/**
 * 一覧の年度セル（A列）を集計で扱う "YYYY年" 表記へ正規化する。
 *
 * A列には表示形式 `0"年"` が設定されており、数値 2024 を入れても画面上は
 * 「2024年」と表示される。getValues() は生値（数値）を返すため文字列比較では
 * 弾かれるが、シート上の見た目と入力者の意図はどちらも「2024年」なので、
 * 妥当な西暦の範囲に収まる整数だけ文字列表記へ寄せる。
 * 文字列の "2024"（表示も "2024"）は見た目から年度と判別できないため寄せない。
 *
 * @param {*} value
 * @returns {string}
 */
function _normalizeAggregationYearCell(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 2000 && value <= 2099) {
    return `${value}年`;
  }
  return _cellText(value);
}

/**
 * 一覧の反響月セル（B列）を集計で扱う "N月" 表記へ正規化する。
 * 理由は _normalizeAggregationYearCell と同じ（B列の表示形式は `0"月"`）。
 * @param {*} value
 * @returns {string}
 */
function _normalizeAggregationMonthCell(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12) {
    return `${value}月`;
  }
  return _cellText(value);
}

/**
 * 集計不能セルをログ・エラー用に短く表す（空欄と型の違いを潰さない）
 * @param {*} value
 * @returns {string}
 */
function _describeInvalidListCell(value) {
  const text = _cellText(value);
  if (text === '') return '(空)';
  if (typeof value === 'string') return text;
  return `${text}（型: ${value instanceof Date ? 'Date' : typeof value}）`;
}

/**
 * 一覧から対象年度（今年度）の行だけを取り出す。
 *
 * 方針（2026-07-30 決定）: 集計は今年度だけを対象にする。過年度の行は読み飛ばし、
 * 過年度側のデータ不備で今年度の同期を止めない。ただし年度セルが読めない行は
 * 今年度かどうか判別できないため、握りつぶさず unreadableRows として返して
 * 呼び出し側で警告ログに残す。
 *
 * 対象年度の行の不備は従来どおり書き込み前に失敗させる。最初の1件で止めず
 * 全件を集めてから1つのエラーにし、シート名とセル番地で修正先を特定できるようにする。
 *
 * 先頭行がヘッダーと判定できる場合だけ年度形式チェックから除外する。
 *
 * @param {Array<Array<*>>} listData
 * @param {string} targetYear 対象年度（例: '2026年'）
 * @param {string} [listSheetName] エラーメッセージ用の一覧シート名
 * @returns {{
 *   rowsByYear: Map<string, Array<Array<*>>>, years: string[], sourceRows: number,
 *   skippedOtherYears: number,
 *   unreadableRows: Array<{ cell: string, shown: string, customerName: string }>
 * }}
 */
function _partitionAggregationRowsByYear(listData, targetYear, listSheetName) {
  if (!Array.isArray(listData)) {
    throw new Error('一覧シートデータが配列ではありません');
  }
  if (!AGG_YEAR_PATTERN.test(_cellText(targetYear))) {
    throw new Error(`一覧の絞り込みに使う対象年度が不正です: ${targetYear || '(空)'}`);
  }

  const rowsByYear = new Map();
  const invalidRows = [];
  const unreadableRows = [];
  let skippedOtherYears = 0;
  let sourceRows = 0;
  for (let rowIndex = 0; rowIndex < listData.length; rowIndex++) {
    const row = listData[rowIndex];
    if (!Array.isArray(row)) {
      throw new Error(`一覧シート${rowIndex + 1}行目が配列ではありません`);
    }

    const rowNumber = rowIndex + 1;
    const yearCell = row[SALES_LIST_COLS.YEAR - 1];
    const monthCell = row[SALES_LIST_COLS.MONTH - 1];
    const year = _normalizeAggregationYearCell(yearCell);
    const customerName = _cellText(row[SALES_LIST_COLS.CUSTOMER_NAME - 1]);
    const isHeader = rowIndex === 0 && !AGG_YEAR_PATTERN.test(year) && (
      /年|年度/.test(year) || /顧客|お客様/.test(customerName)
    );
    if (isHeader) continue;

    // 一覧には年度・月の見出し、注記、計行があり得る。顧客名（F列）がある行だけを
    // 顧客データとして扱い、レイアウト行の文字や数式を年度不正と誤判定しない。
    if (customerName === '') continue;
    if (!AGG_YEAR_PATTERN.test(year)) {
      unreadableRows.push({
        cell: _toA1(rowNumber, SALES_LIST_COLS.YEAR),
        shown: _describeInvalidListCell(yearCell),
        customerName,
      });
      continue;
    }
    if (year !== targetYear) {
      skippedOtherYears++;
      continue;
    }

    const month = _normalizeAggregationMonthCell(monthCell);
    if (!AGG_MONTH_PATTERN.test(month)) {
      invalidRows.push({
        cell: _toA1(rowNumber, SALES_LIST_COLS.MONTH),
        label: '月',
        shown: _describeInvalidListCell(monthCell),
        customerName,
      });
      continue;
    }

    // 正規化した年度・月で行を差し替える。月別反響数など後続の集計は行から
    // 直接 A/B 列を読み直すため、ここで揃えておかないと数え落としになる。
    const normalizedRow = row.slice();
    normalizedRow[SALES_LIST_COLS.YEAR - 1] = year;
    normalizedRow[SALES_LIST_COLS.MONTH - 1] = month;

    if (!rowsByYear.has(year)) rowsByYear.set(year, []);
    rowsByYear.get(year).push(normalizedRow);
    sourceRows++;
  }

  if (invalidRows.length > 0) {
    throw new Error(_buildInvalidListRowsMessage(invalidRows, listSheetName, targetYear));
  }

  const years = [...rowsByYear.keys()].sort(_compareAggregationYears);
  return { rowsByYear, years, sourceRows, skippedOtherYears, unreadableRows };
}

/**
 * 集計不能行のエラーメッセージを組み立てる
 * @param {Array<{ cell: string, label: string, shown: string, customerName: string }>} invalidRows
 * @param {string} [listSheetName]
 * @param {string} [targetYear]
 * @returns {string}
 */
function _buildInvalidListRowsMessage(invalidRows, listSheetName, targetYear) {
  const sheetLabel = listSheetName ? `一覧シート「${listSheetName}」` : '一覧シート';
  const yearLabel = targetYear ? `${targetYear}に` : '';
  const details = invalidRows
    .slice(0, AGG_INVALID_ROW_SAMPLE_LIMIT)
    .map((r) => `${r.cell}の${r.label}が不正です: ${r.shown}（${r.customerName}）`)
    .join(' / ');
  const omitted = invalidRows.length - Math.min(invalidRows.length, AGG_INVALID_ROW_SAMPLE_LIMIT);
  return (
    `${sheetLabel}${yearLabel}集計できない行が${invalidRows.length}件あります: ` +
    details + (omitted > 0 ? ` ほか${omitted}件` : '')
  );
}

/**
 * 年ヘッダー行から対象年度の列位置を取得する。無ければ作る位置を決める。
 *
 * 書き込むのは対象年度の1列だけなので、必須なのも重複が致命的なのも対象年度だけ。
 * ヘッダー行の右側に別表の年ラベルが同居しているシートがあるため、対象年度以外の
 * 年ラベルは列一覧に集めるだけで、欠落・重複を理由に集計を止めない。
 *
 * 年度が切り替わって対象年度の列がまだ無い場合は、**年ラベルが連続している範囲の
 * 右隣**へ新しい年度列を作る（2026-07-30 決定）。列を作らないと年度切替の日に
 * 18枚すべてが一斉に止まるため。別表の年ラベルを巻き込まないよう、連続範囲の
 * 外にある年ラベルは基準にしない。書き込み先が空でなければ作らずに失敗させる。
 *
 * @param {Array<Array<*>>} grid
 * @param {{ key: string, label: string, headerRow: number }} section
 * @param {string} targetYear
 * @returns {{
 *   key: string, label: string, headerRow: number, targetColIndex: number,
 *   isNewColumn: boolean, columns: Array<{ year: string, colIndex: number }>
 * }}
 */
function _readAggregationYearSection(grid, section, targetYear) {
  const row = grid[section.headerRow - 1];
  if (!Array.isArray(row)) {
    throw new Error(
      `必須年別ヘッダー行が見つかりません: ${section.label}（${section.headerRow}行）`
    );
  }

  const columns = [];
  let targetColIndex = -1;
  let runStart = -1;
  let runEnd = -1;
  for (let colIndex = 1; colIndex < row.length; colIndex++) {
    const year = _cellText(row[colIndex]);
    if (!AGG_YEAR_PATTERN.test(year)) continue;
    if (year === targetYear) {
      if (targetColIndex !== -1) {
        throw new Error(
          `年別ヘッダーが重複しています: ${section.label}/${year}` +
          `（${_toA1(section.headerRow, targetColIndex + 1)} と ` +
          `${_toA1(section.headerRow, colIndex + 1)}）`
        );
      }
      targetColIndex = colIndex;
    }
    // 年ラベルが連続している先頭の範囲だけをこのブロックの年列とみなす。
    // 間が空いたら別表の年ラベルなので、範囲は広げない。
    if (runStart === -1) {
      runStart = colIndex;
      runEnd = colIndex;
    } else if (colIndex === runEnd + 1) {
      runEnd = colIndex;
    }
    columns.push({ year, colIndex });
  }

  if (targetColIndex !== -1) {
    return { ...section, columns, targetColIndex, isNewColumn: false };
  }

  if (runEnd === -1) {
    throw new Error(
      `必須年別ヘッダーが見つかりません: ${section.label}（${section.headerRow}行）`
    );
  }

  const newColIndex = runEnd + 1;
  const occupant = _cellText(row[newColIndex]);
  if (occupant !== '') {
    throw new Error(
      `${section.label}に${targetYear}の列を作れません: ` +
      `${_toA1(section.headerRow, newColIndex + 1)} に「${occupant}」があります`
    );
  }
  return { ...section, columns, targetColIndex: newColIndex, isNewColumn: true };
}

/**
 * 年度文字列を昇順比較する。
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function _compareAggregationYears(a, b) {
  return Number(a.slice(0, 4)) - Number(b.slice(0, 4));
}

/**
 * ラベル参照型の必須セクションが存在し、合計行/列まで揃っていることを検証する。
 * @param {Array<Array<*>>} grid
 * @param {string} style
 */
function _validateRequiredAggregationSections(grid, style) {
  const staff = _scanHeaderLabels(grid, AGG_ROWS.STAFF_HEADER, 1);
  if (staff.labels.length === 0 || !staff.hasTotal) {
    throw new Error(
      `担当者別の必須ヘッダーまたは合計列がありません（${AGG_ROWS.STAFF_HEADER}行）`
    );
  }

  for (const section of [
    { label: '反響媒体（全体）', headerRow: AGG_ROWS.MEDIA_ALL_HEADER },
    { label: '反響媒体（成約）', headerRow: AGG_ROWS.MEDIA_CLOSED_HEADER },
    { label: 'エリア（全体）', headerRow: AGG_ROWS.AREA_ALL_HEADER },
    { label: 'エリア（成約）', headerRow: AGG_ROWS.AREA_CLOSED_HEADER },
  ]) {
    const scanned = _scanLabels(grid, section.headerRow + 1, 0, 120);
    if (scanned.labels.length === 0 || !scanned.hasTotal) {
      throw new Error(
        `${section.label}の必須ラベルまたは合計行がありません（${section.headerRow + 1}行以降）`
      );
    }
  }

  if (style === 'residential') {
    const leaving = _scanLabels(
      grid, AGG_RESIDENTIAL_ROWS.LEAVING_START, 11, 30
    );
    if (leaving.labels.length === 0 || !leaving.hasTotal) {
      throw new Error('離脱理由の必須ラベルまたは合計行がありません');
    }
    return;
  }

  for (const section of [
    { label: '業種×企業規模', headerRow: AGG_BUSINESS_ROWS.INDUSTRY_SCALE_HEADER },
    { label: '肩書×企業規模', headerRow: AGG_BUSINESS_ROWS.JOB_TITLE_HEADER },
  ]) {
    const rowLabels = _scanLabels(grid, section.headerRow + 1, 0, 40);
    const colLabels = _scanHeaderLabels(grid, section.headerRow, 1);
    if (
      rowLabels.labels.length === 0 || !rowLabels.hasTotal ||
      colLabels.labels.length === 0 || !colLabels.hasTotal
    ) {
      throw new Error(`${section.label}の必須行列ヘッダーまたは合計がありません`);
    }
  }

  for (const section of [
    { label: '業態×業種（全体）', headerRow: AGG_BUSINESS_ROWS.TYPE_NEEDS_HEADER },
    { label: '業態×業種（成約）', headerRow: AGG_BUSINESS_ROWS.TYPE_NEEDS_CLOSED_HEADER },
  ]) {
    const rowLabels = _scanLabels(grid, section.headerRow + 1, 0, 40);
    const colLabels = _scanHeaderLabels(grid, section.headerRow, 1);
    if (
      rowLabels.labels.length === 0 || !rowLabels.hasTotal ||
      colLabels.labels.length !== 3 || !colLabels.hasTotal
    ) {
      throw new Error(`${section.label}の必須業種・業態ヘッダーまたは合計がありません`);
    }
  }

  const events = _scanHeaderLabels(grid, AGG_BUSINESS_ROWS.EVENT_HEADER, 12);
  if (events.labels.length === 0 || !events.hasTotal) {
    throw new Error('集客イベントの必須ヘッダーまたは合計列がありません');
  }
}

/**
 * 書き込み前に、年度・必須セクション・一覧行を一括検証する。
 *
 * 検証するのも書き込むのも対象年度（今年度）の1年分だけ。過年度の列は
 * 現在の値のまま凍結し、過年度側のヘッダー欠落・データ不備で今年度の同期を止めない。
 *
 * @param {Array<Array<*>>} grid
 * @param {Array<Array<*>>} listData
 * @param {string} targetYear
 * @param {string} style
 * @param {string} [listSheetName]
 * @returns {{
 *   rowsByYear: Map<string, Array<Array<*>>>, listYears: string[],
 *   managedYears: string[], sourceRows: number,
 *   skippedOtherYears: number,
 *   unreadableRows: Array<{ cell: string, shown: string, customerName: string }>,
 *   yearSections: Object<string, {
 *     key: string, label: string, headerRow: number, targetColIndex: number,
 *     columns: Array<{ year: string, colIndex: number }>
 *   }>
 * }}
 */
function _validateAggregationPreflight(grid, listData, targetYear, style, listSheetName) {
  if (!Array.isArray(grid) || grid.length === 0) {
    throw new Error('集計シートデータが空です');
  }
  if (!AGG_YEAR_PATTERN.test(_cellText(targetYear))) {
    throw new Error(`詳細ブロックの対象年度が不正です: ${targetYear}`);
  }
  if (style !== 'residential' && style !== 'business') {
    throw new Error(`未対応の集計レイアウトです: ${style}`);
  }

  const partitioned = _partitionAggregationRowsByYear(listData, targetYear, listSheetName);
  const yearSections = {};

  for (const definition of AGG_YEARLY_SECTIONS) {
    yearSections[definition.key] = _readAggregationYearSection(grid, definition, targetYear);
  }

  _validateRequiredAggregationSections(grid, style);
  _validateAggregationInputCoverage(grid, partitioned.rowsByYear, style);

  return {
    rowsByYear: partitioned.rowsByYear,
    listYears: partitioned.years,
    managedYears: [targetYear],
    sourceRows: partitioned.sourceRows,
    skippedOtherYears: partitioned.skippedOtherYears,
    unreadableRows: partitioned.unreadableRows,
    newYearColumns: Object.values(yearSections)
      .filter((section) => section.isNewColumn)
      .map((section) => `${section.label}=${_toA1(section.headerRow, section.targetColIndex + 1)}`),
    yearSections,
  };
}

/**
 * ラベル別集計で一覧行が黙って欠落しないことを、書き込み前に検証する。
 *
 * 方針（2026-07-28 決定）: 語彙に無い値は集計を止めず受け皿区分へ寄せる。
 * ランクは成約（A）判定にしか使わず反響数は全行を数えるため、語彙外ランクは
 * 「成約以外」として扱えば欠落しない。検討レベルは「未」へ寄せる。
 * 受け皿ラベルが1つも無く寄せ先が存在しないブロックだけは、黙って欠落
 * させず失敗させる。
 *
 * @param {Array<Array<*>>} grid
 * @param {Map<string, Array<Array<*>>>} rowsByYear
 * @param {string} style
 */
function _validateAggregationInputCoverage(grid, rowsByYear, style) {
  const allRows = [];
  for (const rows of rowsByYear.values()) allRows.push(...rows);
  if (allRows.length === 0) return;

  const closedRows = allRows.filter(
    row => _cellText(row[SALES_LIST_COLS.RANK - 1]) === 'A'
  );

  const labeledSections = [
    {
      label: '反響媒体（全体）',
      headerRow: AGG_ROWS.MEDIA_ALL_HEADER,
      rows: allRows,
      resolver: _mediaKeyResolver,
      fallbackLabels: AGG_UNKNOWN_LABELS,
    },
    {
      label: '反響媒体（成約）',
      headerRow: AGG_ROWS.MEDIA_CLOSED_HEADER,
      rows: closedRows,
      resolver: _mediaKeyResolver,
      fallbackLabels: AGG_UNKNOWN_LABELS,
    },
    {
      label: 'エリア（全体）',
      headerRow: AGG_ROWS.AREA_ALL_HEADER,
      rows: allRows,
      resolver: _areaKeyResolver,
      fallbackLabels: AGG_AREA_UNKNOWN_LABELS,
    },
    {
      label: 'エリア（成約）',
      headerRow: AGG_ROWS.AREA_CLOSED_HEADER,
      rows: closedRows,
      resolver: _areaKeyResolver,
      fallbackLabels: AGG_AREA_UNKNOWN_LABELS,
    },
  ];

  // 媒体別・エリア別は合計行が反響数と一致すべきブロック。受け皿ラベルがあれば
  // そこへ寄せ、1つも無い場合だけ「黙って落ちる」のを避けて失敗させる。
  for (const section of labeledSections) {
    const { labels } = _scanLabels(grid, section.headerRow + 1, 0, 120);
    const unresolved = section.rows.filter(
      row => section.resolver(row, labels) === -1
    ).length;
    if (unresolved > 0) {
      // resolver は受け皿があれば必ずそこへ寄せるため、未解決＝受け皿行が無い。
      throw new Error(
        `${section.label}に「${section.fallbackLabels.join('」「')}」行がなく、` +
        `分類できない一覧行を集計できません: ${unresolved}件`
      );
    }
  }

  // 担当者別は合計列が反響数と一致すべきブロック。受け皿列が無いと差が出る。
  const staff = _scanHeaderLabels(grid, AGG_ROWS.STAFF_HEADER, 1);
  const hasStaffFallback = AGG_UNKNOWN_LABELS.some(
    label => staff.labels.includes(label)
  );
  if (!hasStaffFallback) {
    const unresolvedStaff = allRows.filter(
      row => !staff.labels.includes(_cellText(row[SALES_LIST_COLS.MANAGER - 1]))
    ).length;
    if (unresolvedStaff > 0) {
      throw new Error(
        `担当者別に「${AGG_UNKNOWN_LABELS.join('」「')}」列がなく、` +
        `分類できない一覧行があります: ${unresolvedStaff}件`
      );
    }
  }
}

/**
 * 書き込み指示が非空・矩形・非重複で、有限数値だけを含むことを検証する。
 * @param {Array<{ row: number, col: number, values: Array<Array<*>> }>} writes
 * @returns {{ cells: number }}
 */
function _validateAggregationWrites(writes) {
  if (!Array.isArray(writes) || writes.length === 0) {
    throw new Error('集計書き込み指示が空です');
  }

  const occupied = new Set();
  let cells = 0;
  for (let writeIndex = 0; writeIndex < writes.length; writeIndex++) {
    const write = writes[writeIndex];
    if (
      !write || !Number.isInteger(write.row) || write.row < 1 ||
      !Number.isInteger(write.col) || write.col < 1 ||
      !Array.isArray(write.values) || write.values.length === 0 ||
      !Array.isArray(write.values[0]) || write.values[0].length === 0
    ) {
      throw new Error(`集計書き込み指示${writeIndex + 1}件目の形式が不正です`);
    }

    const width = write.values[0].length;
    for (let rowOffset = 0; rowOffset < write.values.length; rowOffset++) {
      const valueRow = write.values[rowOffset];
      if (!Array.isArray(valueRow) || valueRow.length !== width) {
        throw new Error(`集計書き込み指示${writeIndex + 1}件目が矩形ではありません`);
      }
      for (let colOffset = 0; colOffset < width; colOffset++) {
        const value = valueRow[colOffset];
        if (typeof value === 'number' && !Number.isFinite(value)) {
          throw new Error(
            `集計書き込み指示に有限でない数値があります: ` +
            `${_toA1(write.row + rowOffset, write.col + colOffset)}`
          );
        }
        const cellKey = `${write.row + rowOffset}:${write.col + colOffset}`;
        if (occupied.has(cellKey)) {
          throw new Error(
            `集計書き込み指示が重複しています: ` +
            `${_toA1(write.row + rowOffset, write.col + colOffset)}`
          );
        }
        occupied.add(cellKey);
        cells++;
      }
    }
  }
  return { cells };
}

// ============================================================
// 共通ヘルパー
// ============================================================

/**
 * セル値を文字列化する（null/undefined は空文字）
 * @param {*} v
 * @returns {string}
 */
function _cellText(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

/**
 * セルが空でないか
 * @param {*} v
 * @returns {boolean}
 */
function _hasValue(v) {
  return v !== null && v !== undefined && String(v) !== '';
}

/**
 * ゼロ除算を避けて割合を返す（分母0なら0）
 * @param {number} numerator
 * @param {number} denominator
 * @returns {number}
 */
function _aggRatio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * ヘッダー行から対象年度の列インデックス（0始まり）を探す
 * @param {Array<Array<*>>} grid
 * @param {number} headerRow ヘッダー行番号（1始まり）
 * @param {string} targetYear
 * @returns {number} 見つからなければ -1
 */
function _findYearColumn(grid, headerRow, targetYear) {
  const row = grid[headerRow - 1] ?? [];
  return row.findIndex((v) => _cellText(v) === targetYear);
}

/**
 * ラベル列を上から走査し、合計ラベルの手前までのラベル一覧を返す
 * @param {Array<Array<*>>} grid
 * @param {number} startRow 走査開始行（1始まり）
 * @param {number} colIndex ラベル列（0始まり）
 * @param {number} maxRows 走査上限行数
 * @returns {{ labels: string[], hasTotal: boolean }} hasTotal=ラベル直後に合計行があるか
 */
function _scanLabels(grid, startRow, colIndex, maxRows) {
  const labels = [];
  for (let i = 0; i < maxRows; i++) {
    const label = _cellText(grid[startRow - 1 + i]?.[colIndex]);
    if (AGG_TOTAL_LABELS.includes(label)) return { labels, hasTotal: true };
    if (label === '') break;
    labels.push(label);
  }
  return { labels, hasTotal: false };
}

/**
 * ヘッダー行を右へ走査し、合計ラベルの手前までのラベル一覧を返す
 * @param {Array<Array<*>>} grid
 * @param {number} headerRow ヘッダー行番号（1始まり）
 * @param {number} startColIndex 走査開始列（0始まり）
 * @returns {{ labels: string[], hasTotal: boolean }}
 */
function _scanHeaderLabels(grid, headerRow, startColIndex) {
  const row = grid[headerRow - 1] ?? [];
  const labels = [];
  for (let i = startColIndex; i < row.length; i++) {
    const label = _cellText(row[i]);
    if (AGG_TOTAL_LABELS.includes(label)) return { labels, hasTotal: true };
    if (label === '') break;
    labels.push(label);
  }
  return { labels, hasTotal: false };
}

/**
 * 「20XX年」表記のセルを対象年度へ更新する書き込み指示を作る
 * @param {Array<Array<*>>} grid
 * @param {string} targetYear
 * @param {string[]} cellA1List 候補セル（A1形式）
 * @returns {Array<{ row: number, col: number, values: Array<Array<*>> }>}
 */
function _buildYearLabelWrites(grid, targetYear, cellA1List) {
  const writes = [];
  for (const a1 of cellA1List) {
    const match = /^([A-Z]+)(\d+)$/.exec(a1);
    if (!match) continue;
    const col = match[1].split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
    const row = Number(match[2]);
    const current = _cellText(grid[row - 1]?.[col - 1]);
    if (AGG_YEAR_PATTERN.test(current) && current !== targetYear) {
      writes.push({ row, col, values: [[targetYear]] });
    }
  }
  return writes;
}

// ============================================================
// ① 年別ファネル（行35〜44、対象年度の列のみ）
// ============================================================

/**
 * 進捗カウント（反響/来場/再来/3回目以上/成約）を数える
 * @param {Array<Array<*>>} yearData
 * @returns {{ res: number, vis: number, reVis: number, over: number, close: number }}
 */
function _countFunnel(yearData) {
  const c = { res: 0, vis: 0, reVis: 0, over: 0, close: 0 };
  for (const row of yearData) {
    c.res++;
    if (_hasValue(row[SALES_LIST_COLS.MTG_DAY_1 - 1])) c.vis++;
    if (_hasValue(row[SALES_LIST_COLS.MTG_DAY_2 - 1])) c.reVis++;
    if (_hasValue(row[SALES_LIST_COLS.MTG_DAY_3 - 1])) c.over++;
    if (_cellText(row[SALES_LIST_COLS.RANK - 1]) === 'A') c.close++;
  }
  return c;
}

/**
 * 年別ファネルの書き込み指示を作る
 * @param {Array<Array<*>>} grid
 * @param {Array<Array<*>>} yearData
 * @param {string} targetYear
 * @param {number} [resolvedColIndex] preflightで決めた対象年度列（新設列を含む）
 * @returns {{ row: number, col: number, values: Array<Array<*>> }|null}
 */
function _buildFunnelWrite(grid, yearData, targetYear, resolvedColIndex) {
  const colIndex = resolvedColIndex ?? _findYearColumn(grid, AGG_ROWS.FUNNEL_HEADER, targetYear);
  if (colIndex === -1) {
    throw new Error(`年別ファネルの対象年度列が見つかりません: ${targetYear}`);
  }
  const c = _countFunnel(yearData);
  const values = [
    [c.res], [c.vis], [c.reVis], [c.over], [c.close],
    [_aggRatio(c.vis,   c.res)],    // 反響来場率
    [_aggRatio(c.reVis, c.vis)],    // 再来率
    [_aggRatio(c.over,  c.vis)],    // 再々来場率
    [_aggRatio(c.close, c.vis)],    // 歩留
    [_aggRatio(c.close, c.reVis)],  // 再来歩留
  ];
  return { row: AGG_ROWS.FUNNEL_START, col: colIndex + 1, values };
}

// ============================================================
// ② 月ごとの反響数（行70〜82、対象年度の列のみ）
// ============================================================

/**
 * 月別反響数の書き込み指示を作る
 * @param {Array<Array<*>>} grid
 * @param {Array<Array<*>>} yearData
 * @param {string} targetYear
 * @param {number} [resolvedColIndex] preflightで決めた対象年度列（新設列を含む）
 * @returns {{ row: number, col: number, values: Array<Array<*>> }|null}
 */
function _buildMonthlyWrite(grid, yearData, targetYear, resolvedColIndex) {
  const colIndex = resolvedColIndex ?? _findYearColumn(grid, AGG_ROWS.MONTHLY_HEADER, targetYear);
  if (colIndex === -1) {
    throw new Error(`月別反響数の対象年度列が見つかりません: ${targetYear}`);
  }
  const counts = new Array(12).fill(0);
  for (const row of yearData) {
    const m = /^(\d{1,2})月$/.exec(_cellText(row[SALES_LIST_COLS.MONTH - 1]));
    if (!m) continue;
    const idx = Number(m[1]) - 1;
    if (idx >= 0 && idx < 12) counts[idx]++;
  }
  const total = counts.reduce((s, v) => s + v, 0);
  const values = [...counts.map((v) => [v]), [total]];
  return { row: AGG_ROWS.MONTHLY_START, col: colIndex + 1, values };
}

// ============================================================
// ③ 担当者別スコア（行108〜115）
// ============================================================

/**
 * 担当者別スコアの書き込み指示を作る
 * 担当者名はヘッダー行（107行目B列〜）から動的取得。
 * 'その他' 列はヘッダーに無い担当者の受け皿、'計'/'合計' 列は横計。
 *
 * @param {Array<Array<*>>} grid
 * @param {Array<Array<*>>} yearData
 * @returns {{ row: number, col: number, values: Array<Array<*>> }|null}
 */
function _buildStaffWrites(grid, yearData) {
  const headerRow = grid[AGG_ROWS.STAFF_HEADER - 1] ?? [];
  const columns = [];  // { kind: 'staff'|'other'|'total', name }
  let hasTotal = false;
  for (let i = 1; i < headerRow.length; i++) {
    const label = _cellText(headerRow[i]);
    if (label === '') break;
    if (AGG_TOTAL_LABELS.includes(label)) {
      columns.push({ kind: 'total' });
      hasTotal = true;
      break;
    }
    columns.push(
      AGG_UNKNOWN_LABELS.includes(label)
        ? { kind: 'other' }
        : { kind: 'staff', name: label }
    );
  }
  if (columns.length === 0 || !hasTotal) {
    throw new Error('担当者別の必須ヘッダーまたは合計列が見つかりません');
  }

  const staffNames = columns.filter((c) => c.kind === 'staff').map((c) => c.name);
  const zero = () => ({ res: 0, vis: 0, reVis: 0, over: 0, close: 0 });
  const perStaff = new Map(staffNames.map((n) => [n, zero()]));
  const other = zero();
  const total = zero();

  for (const row of yearData) {
    const manager = _cellText(row[SALES_LIST_COLS.MANAGER - 1]);
    const bucket = perStaff.get(manager) ?? other;
    for (const c of [bucket, total]) {
      c.res++;
      if (_hasValue(row[SALES_LIST_COLS.MTG_DAY_1 - 1])) c.vis++;
      if (_hasValue(row[SALES_LIST_COLS.MTG_DAY_2 - 1])) c.reVis++;
      if (_hasValue(row[SALES_LIST_COLS.MTG_DAY_3 - 1])) c.over++;
      if (_cellText(row[SALES_LIST_COLS.RANK - 1]) === 'A') c.close++;
    }
  }

  const toColumn = (c) => [
    c.res, c.vis, c.reVis, c.over, c.close,
    _aggRatio(c.vis,   c.res),  // 反響来場率
    _aggRatio(c.reVis, c.vis),  // 再アポ率
    _aggRatio(c.close, c.vis),  // 歩留
  ];

  // 列方向に並べて1回で書き込む（8行 × 列数）
  const columnValues = columns.map((col) => {
    if (col.kind === 'total') return toColumn(total);
    if (col.kind === 'other') return toColumn(other);
    return toColumn(perStaff.get(col.name));
  });
  const values = Array.from({ length: 8 }, (_, r) => columnValues.map((cv) => cv[r]));
  return { row: AGG_ROWS.STAFF_START, col: 2, values };
}

// ============================================================
// ④ 媒体別・エリア別（年ヘッダー列方式、対象年度の列のみ）
// ============================================================

/**
 * 反響媒体のキー解決（完全一致。無ければ「その他」へ集約）
 * @param {Array<*>} row
 * @param {string[]} labels
 * @returns {number} ラベルインデックス（-1 なら対象外）
 */
function _mediaKeyResolver(row, labels) {
  const idx = _findLabelIndexIgnoreCase(
    labels, _cellText(row[CUSTOMER_LIST_COLS.INFO_ROUTE - 1])
  );
  return idx !== -1 ? idx : _findUnknownLabelIndex(labels, AGG_UNKNOWN_LABELS);
}

/**
 * ラベルを検索する。完全一致を優先し、無ければ大文字小文字を無視して照合する。
 * 反響媒体は同じ媒体がシート内で「Instagram」「instagram」と揺れており、
 * 完全一致だけだと成約者ブロックで「その他」へ落ちるため。
 * @param {string[]} labels
 * @param {string} value
 * @returns {number} 見つからなければ -1
 */
function _findLabelIndexIgnoreCase(labels, value) {
  if (value === '') return -1;
  const exact = labels.indexOf(value);
  if (exact !== -1) return exact;
  const lowered = value.toLowerCase();
  return labels.findIndex(label => label.toLowerCase() === lowered);
}

/**
 * ラベル一覧から受け皿ラベルのインデックスを返す（無ければ -1）
 * @param {string[]} labels
 * @param {string[]} fallbackLabels 受け皿候補（優先順）
 * @returns {number}
 */
function _findUnknownLabelIndex(labels, fallbackLabels) {
  for (const label of fallbackLabels) {
    const idx = labels.indexOf(label);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * 希望エリアのキー解決（市・区を優先し、無ければ都道府県）
 * @param {Array<*>} row
 * @param {string[]} labels
 * @returns {number}
 */
function _areaKeyResolver(row, labels) {
  const city = _cellText(row[SALES_LIST_COLS.CITY - 1]);
  if (city !== '') {
    const idx = labels.indexOf(city);
    if (idx !== -1) return idx;
  }
  const pref = _cellText(row[SALES_LIST_COLS.PREFECTURE - 1]);
  if (pref !== '') {
    const idx = labels.indexOf(pref);
    if (idx !== -1) return idx;
  }
  return _findUnknownLabelIndex(labels, AGG_AREA_UNKNOWN_LABELS);
}

/**
 * 「A列ラベル × 年ヘッダー列」型ブロックの書き込み指示を作る（媒体別・エリア別共用）
 * @param {Array<Array<*>>} grid
 * @param {Array<Array<*>>} dataSet
 * @param {string} targetYear
 * @param {number} headerRow 年ヘッダー行（1始まり）
 * @param {function(Array<*>, string[]): number} keyResolver 行 → ラベルインデックス
 * @param {number} [resolvedColIndex] preflightで決めた対象年度列（新設列を含む）
 * @returns {{ row: number, col: number, values: Array<Array<*>> }|null}
 */
function _buildLabeledYearColumnWrite(grid, dataSet, targetYear, headerRow, keyResolver, resolvedColIndex) {
  const colIndex = resolvedColIndex ?? _findYearColumn(grid, headerRow, targetYear);
  if (colIndex === -1) {
    throw new Error(
      `ラベル別集計の対象年度列が見つかりません: ${headerRow}行/${targetYear}`
    );
  }
  const { labels, hasTotal } = _scanLabels(grid, headerRow + 1, 0, 120);
  if (labels.length === 0 || !hasTotal) {
    throw new Error(
      `ラベル別集計の必須ラベルまたは合計行が見つかりません: ${headerRow + 1}行以降`
    );
  }

  const counts = new Array(labels.length).fill(0);
  for (const row of dataSet) {
    const idx = keyResolver(row, labels);
    if (idx !== -1) counts[idx]++;
  }
  const total = counts.reduce((s, v) => s + v, 0);

  // ラベル行〜合計行までを1列で書き込む（ラベルと合計行の間に空行は無い前提）
  const values = [...counts.map((v) => [v])];
  if (hasTotal) values.push([total]);
  return { row: headerRow + 1, col: colIndex + 1, values };
}

// ============================================================
// ⑤ 住宅系クロス集計（年収×年齢・家族数×年齢・属性×業界）
// ============================================================

/**
 * 年齢 → 列インデックス（0始まり）。範囲外・不明は末尾（不明列）
 * @param {*} ageValue
 * @returns {number}
 */
function _resolveAgeIndex(ageValue) {
  const age = Number(ageValue);
  if (!age || age <= 0 || Number.isNaN(age)) return AGG_AGE_SECTIONS.length;
  const idx = AGG_AGE_SECTIONS.findIndex((s) => age > s.min && age <= s.max);
  return idx === -1 ? AGG_AGE_SECTIONS.length : idx;
}

/**
 * 年収 → 行インデックス（0始まり）。不明は末尾（不明行）
 * @param {*} incomeValue
 * @returns {number}
 */
function _resolveIncomeIndex(incomeValue) {
  const income = Number(String(incomeValue ?? '').replace(/[,，円]/g, ''));
  if (!income || income <= 0 || Number.isNaN(income)) return AGG_INCOME_SECTIONS.length;
  const idx = AGG_INCOME_SECTIONS.findIndex((s) => income <= s.max);
  return idx === -1 ? AGG_INCOME_SECTIONS.length : idx;
}

/**
 * 家族数 → 行インデックス（0始まり）。1〜6人以外は末尾（不明行）
 * @param {*} famValue
 * @returns {number}
 */
function _resolveFamilyIndex(famValue) {
  const fam = Number(famValue);
  if (fam >= 1 && fam <= AGG_FAMILY_MAX) return fam - 1;
  return AGG_FAMILY_MAX;
}

/**
 * 行区分×列区分のマトリクスを数え、計行・計列込みの2次元配列にする
 * @param {Array<Array<*>>} dataSet
 * @param {number} rowCount 行区分数（不明含む、計は含まない）
 * @param {number} colCount 列区分数（不明含む、計は含まない）
 * @param {function(Array<*>): number} rowResolver
 * @param {function(Array<*>): number} colResolver
 * @returns {Array<Array<number>>} (rowCount+1) × (colCount+1)（末尾が計）
 */
function _countMatrix(dataSet, rowCount, colCount, rowResolver, colResolver) {
  const matrix = Array.from({ length: rowCount + 1 }, () => new Array(colCount + 1).fill(0));
  for (const row of dataSet) {
    const r = rowResolver(row);
    const c = colResolver(row);
    matrix[r][c]++;
    matrix[r][colCount]++;
    matrix[rowCount][c]++;
    matrix[rowCount][colCount]++;
  }
  return matrix;
}

/**
 * 年収×年齢（反響者=B121〜J130 / 契約者=M121〜U130）の書き込み指示を作る
 * @param {Array<Array<*>>} yearData
 * @param {Array<Array<*>>} closedData
 * @returns {Array<{ row: number, col: number, values: Array<Array<*>> }>}
 */
function _buildIncomeAgeWrites(yearData, closedData) {
  const build = (dataSet, col) => ({
    row: AGG_RESIDENTIAL_ROWS.INCOME_AGE_START,
    col,
    values: _countMatrix(
      dataSet, AGG_INCOME_SECTIONS.length + 1, AGG_AGE_SECTIONS.length + 1,
      (row) => _resolveIncomeIndex(row[SALES_LIST_COLS.INCOME - 1]),
      (row) => _resolveAgeIndex(row[CUSTOMER_LIST_COLS.AGE - 1]),
    ),
  });
  return [build(yearData, 2), build(closedData, 13)];
}

/**
 * 家族数×年齢（反響者=B139〜J146 / 契約者=M139〜U146）の書き込み指示を作る
 * @param {Array<Array<*>>} yearData
 * @param {Array<Array<*>>} closedData
 * @returns {Array<{ row: number, col: number, values: Array<Array<*>> }>}
 */
function _buildAgeFamilyWrites(yearData, closedData) {
  const build = (dataSet, col) => ({
    row: AGG_RESIDENTIAL_ROWS.AGE_FAMILY_START,
    col,
    values: _countMatrix(
      dataSet, AGG_FAMILY_MAX + 1, AGG_AGE_SECTIONS.length + 1,
      (row) => _resolveFamilyIndex(row[CUSTOMER_LIST_COLS.FAMILY_MEMBER - 1]),
      (row) => _resolveAgeIndex(row[CUSTOMER_LIST_COLS.AGE - 1]),
    ),
  });
  return [build(yearData, 2), build(closedData, 13)];
}

/**
 * 属性×業界（反響者=B152〜J172 / 契約者=M152〜U172）の書き込み指示を作る
 * 行=業界（20区分＋計）、列=属性（8区分＋計）
 * @param {Array<Array<*>>} yearData
 * @param {Array<Array<*>>} closedData
 * @returns {Array<{ row: number, col: number, values: Array<Array<*>> }>}
 */
function _buildAttrIndustryWrites(yearData, closedData) {
  const build = (dataSet, col) => ({
    row: AGG_RESIDENTIAL_ROWS.ATTR_INDUSTRY_START,
    col,
    values: _countMatrix(
      dataSet, AGG_INDUSTRY_COUNT, AGG_ATTR_COUNT,
      (row) => AGG_INDUSTRY_TO_IDX[_cellText(row[SALES_LIST_COLS.INDUSTRY - 1])] ?? (AGG_INDUSTRY_COUNT - 1),
      (row) => AGG_OCCUPATION_TO_ATTR[_cellText(row[SALES_LIST_COLS.OCCUPATION - 1])] ?? (AGG_ATTR_COUNT - 1),
    ),
  });
  return [build(yearData, 2), build(closedData, 13)];
}

// ============================================================
// ⑥ 住宅系 問い合わせニーズ（一次取得/持家/実家など）
// ============================================================

/**
 * 問い合わせニーズ3ブロックの書き込み指示を作る
 * 各ブロック: 反響/来場/契約/来場率/歩留 の5行 × （種別5列＋計）
 * @param {Array<Array<*>>} yearData
 * @returns {Array<{ row: number, col: number, values: Array<Array<*>> }>}
 */
function _buildNeedsWrites(grid, yearData) {
  return AGG_RESIDENTIAL_ROWS.NEEDS_BLOCKS.map((block) => {
    // 列はヘッダー行（B〜'計'）から動的に読む。「その他」列を足せば、
    // 5種別に無い初回アポイントもコード変更なしでそこへ集計される。
    const { labels, hasTotal } = _scanHeaderLabels(grid, block.startRow - 1, 1);
    if (labels.length === 0 || !hasTotal) {
      throw new Error(
        `問い合わせニーズの必須ヘッダーまたは合計列が見つかりません: ${block.startRow - 1}行`
      );
    }

    const n = labels.length;
    const fallbackIndex = _findUnknownLabelIndex(labels, AGG_UNKNOWN_LABELS);
    const res = new Array(n + 1).fill(0);
    const vis = new Array(n + 1).fill(0);
    const close = new Array(n + 1).fill(0);

    for (const row of yearData) {
      if (!_hasValue(row[block.filterCol - 1])) continue;  // 対象ニーズの顧客のみ
      const matched = labels.indexOf(_cellText(row[CUSTOMER_LIST_COLS.FIRST_APPOINT - 1]));
      const idx = matched !== -1 ? matched : fallbackIndex;
      if (idx === -1) continue;
      for (const i of [idx, n]) {
        res[i]++;
        if (_hasValue(row[SALES_LIST_COLS.MTG_DAY_1 - 1])) vis[i]++;
        if (_cellText(row[SALES_LIST_COLS.RANK - 1]) === 'A') close[i]++;
      }
    }
    const att   = res.map((_, i) => _aggRatio(vis[i], res[i]));
    const yieldRate = res.map((_, i) => _aggRatio(close[i], vis[i]));
    return { row: block.startRow, col: 2, values: [res, vis, close, att, yieldRate] };
  });
}

// ============================================================
// ⑦ 住宅系 検討レベル総数（行178 M〜T）
// ============================================================

/**
 * 検討レベル総数の書き込み指示を作る
 * 一覧シートの見込度列（D列）の値を検討レベル7区分に割り付ける
 * @param {Array<Array<*>>} yearData
 * @returns {{ row: number, col: number, values: Array<Array<*>> }}
 */
function _buildConsiderationWrite(yearData) {
  const counts = new Array(AGG_CONSIDERATION_COUNT + 1).fill(0);
  for (const row of yearData) {
    // 語彙に無い見込度は落とさず「未」（不明）へ寄せ、合計を反響数と一致させる。
    const idx = AGG_CONSIDERATION_MAP[_cellText(row[SALES_LIST_COLS.LIKEHOOD - 1])]
      ?? AGG_CONSIDERATION_UNKNOWN_INDEX;
    counts[idx]++;
    counts[AGG_CONSIDERATION_COUNT]++;
  }
  return { row: AGG_RESIDENTIAL_ROWS.CONSIDERATION_ROW, col: 13, values: [counts] };
}

// ============================================================
// ⑧ 住宅系 離脱理由×担当者（行183〜合計行、L列=理由ラベル）
// ============================================================

/**
 * 離脱理由×担当者の書き込み指示を作る
 * 理由ラベルはL列183行目〜'合計'、担当者はヘッダー行のN列以降から動的取得。
 * M列=理由総数。ヘッダーに無い担当者は理由総数・合計行のみに計上する。
 * @param {Array<Array<*>>} grid
 * @param {Array<Array<*>>} yearData
 * @returns {{ row: number, col: number, values: Array<Array<*>> }|null}
 */
function _buildLeavingWrite(grid, yearData) {
  const { labels: reasons, hasTotal } = _scanLabels(grid, AGG_RESIDENTIAL_ROWS.LEAVING_START, 11, 30);
  const { labels: staffList } = _scanHeaderLabels(grid, AGG_RESIDENTIAL_ROWS.LEAVING_HEADER, 13);
  if (reasons.length === 0 || !hasTotal) {
    throw new Error('離脱理由の必須ラベルまたは合計行が見つかりません');
  }

  // rows: 理由ごと + 合計行 / cols: 理由総数 + 担当者ごと
  const matrix = Array.from({ length: reasons.length + 1 }, () => new Array(staffList.length + 1).fill(0));
  const unknownReasonIndex = _findUnknownLabelIndex(reasons, AGG_LEAVING_UNKNOWN_LABELS);
  for (const row of yearData) {
    const reason = _cellText(row[RESIDENTIAL_EXTRA_COLS.REASON - 1]);
    // 理由が空＝まだ離脱していない行。ここで数えると離脱数が水増しされる。
    if (reason === '') continue;
    const matched = reasons.indexOf(reason);
    const r = matched !== -1 ? matched : unknownReasonIndex;
    if (r === -1) continue;
    const staff = _cellText(row[SALES_LIST_COLS.MANAGER - 1]);
    const s = staffList.indexOf(staff);
    matrix[r][0]++;
    matrix[reasons.length][0]++;
    if (s !== -1) {
      matrix[r][s + 1]++;
      matrix[reasons.length][s + 1]++;
    }
  }

  // 合計行はラベル直後にある場合のみ書く（現行シートは理由15行+合計行）
  const rowCount = hasTotal ? reasons.length + 1 : reasons.length;
  return {
    row: AGG_RESIDENTIAL_ROWS.LEAVING_START,
    col: 13,
    values: matrix.slice(0, rowCount),
  };
}

// ============================================================
// ⑨ 法人系 クロス集計（業種×企業規模・肩書×企業規模）
// ============================================================

/**
 * ラベル参照型クロスマトリクス（反響者=B列〜 / 契約者=M列〜）の書き込み指示を作る
 * 行ラベルはA列（ヘッダー行+1〜'計'）、列ラベルはヘッダー行B列〜'計'から動的取得。
 * ラベルに無い値は「不明」行/列に計上する。
 *
 * @param {Array<Array<*>>} grid
 * @param {Array<Array<*>>} yearData
 * @param {Array<Array<*>>} closedData
 * @param {number} headerRow ヘッダー行（1始まり）
 * @param {function(Array<*>): string} rowValueGetter 行 → 行ラベル値
 * @param {function(Array<*>): string} colValueGetter 行 → 列ラベル値
 * @returns {Array<{ row: number, col: number, values: Array<Array<*>> }>}
 */
function _buildCrossMatrixWrites(grid, yearData, closedData, headerRow, rowValueGetter, colValueGetter) {
  const { labels: rowLabels, hasTotal: hasTotalRow } = _scanLabels(grid, headerRow + 1, 0, 40);
  const { labels: colLabels, hasTotal: hasTotalCol } = _scanHeaderLabels(grid, headerRow, 1);
  if (
    rowLabels.length === 0 || colLabels.length === 0 ||
    !hasTotalRow || !hasTotalCol
  ) {
    throw new Error(
      `クロス集計の必須行列ヘッダーまたは合計が見つかりません: ${headerRow}行`
    );
  }
  const resolve = (value, labels) => {
    const idx = labels.indexOf(value);
    if (idx !== -1) return idx;
    const unknownIdx = labels.indexOf('不明');
    return unknownIdx !== -1 ? unknownIdx : labels.length - 1;
  };
  const build = (dataSet, col) => {
    const matrix = _countMatrix(
      dataSet, rowLabels.length, colLabels.length,
      (row) => resolve(rowValueGetter(row), rowLabels),
      (row) => resolve(colValueGetter(row), colLabels),
    );
    const values = matrix
      .slice(0, rowLabels.length + (hasTotalRow ? 1 : 0))
      .map((r) => r.slice(0, colLabels.length + (hasTotalCol ? 1 : 0)));
    return { row: headerRow + 1, col, values };
  };
  return [build(yearData, 2), build(closedData, 13)];
}

// ============================================================
// ⑩ 法人系 業態×業種（反響者/契約者）
// ============================================================

// AGG_TYPE_NEEDS_FLAG_COLS は BUSINESS_EXTRA_COLS を参照するため config.gs 側に置く
// （GAS のファイル名順評価では config.gs がこのファイルより後になる）。

/**
 * 業態×業種の書き込み指示を作る
 * 行=業種（A列ラベル）、列=業態3区分＋合計
 * @param {Array<Array<*>>} grid
 * @param {Array<Array<*>>} dataSet
 * @param {number} headerRow ヘッダー行（1始まり）
 * @returns {{ row: number, col: number, values: Array<Array<*>> }|null}
 */
function _buildTypeNeedsWrite(grid, dataSet, headerRow) {
  const { labels: typeLabels, hasTotal } = _scanLabels(grid, headerRow + 1, 0, 40);
  const { labels: needLabels, hasTotal: hasNeedsTotal } = _scanHeaderLabels(grid, headerRow, 1);
  if (
    typeLabels.length === 0 || !hasTotal ||
    needLabels.length !== AGG_TYPE_NEEDS_FLAG_COLS.length || !hasNeedsTotal
  ) {
    throw new Error(
      `業態×業種の必須ヘッダーまたは合計が見つかりません: ${headerRow}行`
    );
  }
  const needsCount = AGG_TYPE_NEEDS_FLAG_COLS.length;
  const resolveNeeds = (row) => {
    for (const { col, idx } of AGG_TYPE_NEEDS_FLAG_COLS) {
      if (_hasValue(row[col - 1])) return idx;
    }
    return -1;
  };
  const resolveType = (row) => {
    const idx = typeLabels.indexOf(_cellText(row[SALES_LIST_COLS.INDUSTRY - 1]));
    if (idx !== -1) return idx;
    const unknownIdx = typeLabels.indexOf('不明');
    return unknownIdx !== -1 ? unknownIdx : typeLabels.length - 1;
  };

  const matrix = Array.from({ length: typeLabels.length + 1 }, () => new Array(needsCount + 1).fill(0));
  for (const row of dataSet) {
    const c = resolveNeeds(row);
    if (c === -1) continue;
    const r = resolveType(row);
    matrix[r][c]++;
    matrix[r][needsCount]++;
    matrix[typeLabels.length][c]++;
    matrix[typeLabels.length][needsCount]++;
  }
  return {
    row: headerRow + 1,
    col: 2,
    values: matrix.slice(0, typeLabels.length + (hasTotal ? 1 : 0)),
  };
}

// ============================================================
// ⑪ 法人系 集客イベント（行155〜159、L〜列）
// ============================================================

/**
 * 集客イベントの書き込み指示を作る
 * 列=初回アポイント種別（M154〜'計'）、行=反響/来場/契約/来場率/歩留
 * @param {Array<Array<*>>} grid
 * @param {Array<Array<*>>} yearData
 * @returns {{ row: number, col: number, values: Array<Array<*>> }|null}
 */
function _buildEventWrite(grid, yearData) {
  const { labels: items, hasTotal } = _scanHeaderLabels(grid, AGG_BUSINESS_ROWS.EVENT_HEADER, 12);
  if (items.length === 0 || !hasTotal) {
    throw new Error('集客イベントの必須ヘッダーまたは合計列が見つかりません');
  }
  const n = items.length;
  // ヘッダーに「その他」列を足せば、5種別に無い初回アポイントもそこへ集計される。
  const fallbackIndex = _findUnknownLabelIndex(items, AGG_UNKNOWN_LABELS);
  const res = new Array(n + 1).fill(0);
  const vis = new Array(n + 1).fill(0);
  const close = new Array(n + 1).fill(0);

  for (const row of yearData) {
    const matched = items.indexOf(_cellText(row[CUSTOMER_LIST_COLS.FIRST_APPOINT - 1]));
    const idx = matched !== -1 ? matched : fallbackIndex;
    if (idx === -1) continue;
    for (const i of [idx, n]) {
      res[i]++;
      if (_hasValue(row[SALES_LIST_COLS.MTG_DAY_1 - 1])) vis[i]++;
      if (_cellText(row[SALES_LIST_COLS.RANK - 1]) === 'A') close[i]++;
    }
  }
  const att   = res.map((_, i) => _aggRatio(vis[i], res[i]));
  const yieldRate = res.map((_, i) => _aggRatio(close[i], vis[i]));
  const width = n + (hasTotal ? 1 : 0);
  return {
    row: AGG_BUSINESS_ROWS.EVENT_HEADER + 1,
    col: 13,
    values: [res, vis, close, att, yieldRate].map((r) => r.slice(0, width)),
  };
}
