/**
 * ledger.gs — Webhook・定期集計の永続実行ログ
 *
 * `_SYNC_EVENTS` は Webhook 単位、`_SYNC_JOBS` は定期処理単位の履歴を保持する。
 * 両シートは同じスキーマを使い、1 operation につき STARTED と終了状態を
 * 別行で追記できる。
 *
 * 重要:
 * - recordSyncEvent()/recordSyncJob() の呼び出し元は、一覧更新・集計と同じ
 *   ScriptLock を保持すること。追記行の競合を避けるためである。
 * - 成功経路では strict 版を使い、ログ欠落を成功扱いにしない。
 * - catch 内では Safe 版を使い、ログ障害で元の業務エラーを上書きしない。
 */

// ============================================================
// 定数・スキーマ
// ============================================================

/** @enum {string} */
const SYNC_LEDGER_STATUS = {
  STARTED:             'STARTED',
  SUCCEEDED:           'SUCCEEDED',
  FAILED:              'FAILED',
  PARTIAL_FAILURE:     'PARTIAL_FAILURE',
  SKIPPED_DUPLICATE:   'SKIPPED_DUPLICATE',
  REJECTED_STALE:      'REJECTED_STALE',
};

/** @enum {string} */
const SYNC_LEDGER_KIND = {
  EVENT: 'EVENT',
  JOB:   'JOB',
};

/** @type {string} */
const SYNC_EVENTS_SHEET_NAME = '_SYNC_EVENTS';

/** @type {string} */
const SYNC_JOBS_SHEET_NAME = '_SYNC_JOBS';

/**
 * EVENTS/JOBS 共通ヘッダー。
 * 既存列の意味を変えず、将来は末尾への列追加だけで拡張する。
 * @type {string[]}
 */
const SYNC_LEDGER_HEADERS = [
  'loggedAt',
  'operationId',
  'sourceKey',
  'status',
  'stage',
  'triggerType',
  'appId',
  'recordId',
  'revision',
  'eventType',
  'oldTarget',
  'newTarget',
  'listSheetName',
  'domainSheetName',
  'startedAt',
  'finishedAt',
  'elapsedMs',
  'changedCells',
  'targetCount',
  'processedCount',
  'succeededCount',
  'failedCount',
  'error',
  'details',
  'customerName',
];

/** Google Sheets の1セル上限より余裕を持たせた文字数 */
const SYNC_LEDGER_MAX_CELL_CHARS = 49000;

/** 最新成功状態を後方から探す際の1回あたり読込行数 */
const SYNC_LEDGER_LOOKUP_CHUNK_SIZE = 500;

// ============================================================
// operation/context 生成
// ============================================================

/**
 * appId と recordId から、Webhook の安定した識別キーを作る。
 * @param {*} appId
 * @param {*} recordId
 * @returns {string}
 */
function buildSyncSourceKey(appId, recordId) {
  const normalizedAppId    = _syncLedgerString(appId);
  const normalizedRecordId = _syncLedgerString(recordId);
  if (!normalizedAppId || !normalizedRecordId) return '';
  return `${normalizedAppId}:${normalizedRecordId}`;
}

/**
 * operationId を生成する。
 * 第2・第3引数を渡せば、乱数・現在時刻に依存せずテストできる。
 *
 * @param {string} triggerType
 * @param {Date|string|number} [now]
 * @param {string} [uuid]
 * @returns {string}
 */
function generateSyncOperationId(triggerType, now, uuid) {
  const generatedAt = now === undefined ? new Date() : new Date(now);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error('operationId生成日時が不正です');
  }

  const rawPrefix = _syncLedgerString(triggerType).toLowerCase();
  const prefix    = rawPrefix.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'sync';
  const timestamp = generatedAt.toISOString().replace(/[-:.TZ]/g, '');
  const uniquePart = _syncLedgerString(uuid)
    || Utilities.getUuid().replace(/-/g, '');

  return `${prefix}-${timestamp}-${uniquePart}`;
}

/**
 * 新しい operation の context を生成する便利関数。
 * operationId・開始日時以外の初期値は initial から引き継ぐ。
 *
 * @param {string} triggerType
 * @param {Object} [initial]
 * @returns {Object}
 */
function createSyncOperationContext(triggerType, initial = {}) {
  const now = new Date();
  const input = {
    ...initial,
    triggerType: _syncLedgerString(triggerType),
    operationId: initial.operationId || generateSyncOperationId(triggerType, now),
    status:      initial.status || SYNC_LEDGER_STATUS.STARTED,
    startedAt:   initial.startedAt || now,
  };
  return buildSyncLedgerContext(input, now);
}

/**
 * ログ用 context を正規化する純粋関数。
 * now を明示的に受け取るため、同じ引数から常に同じ結果を返す。
 *
 * @param {Object} input
 * @param {Date|string|number} now
 * @returns {Object}
 */
function buildSyncLedgerContext(input, now) {
  const source = input && typeof input === 'object' ? input : {};
  const nowIso = _syncLedgerIso(now);
  if (!nowIso) throw new Error('ログcontext生成日時が不正です');

  const status = source.status || SYNC_LEDGER_STATUS.STARTED;
  _assertSyncLedgerStatus(status);

  const appId     = _syncLedgerString(source.appId);
  const recordId  = _syncLedgerString(source.recordId);
  const sourceKey = _syncLedgerString(source.sourceKey) || buildSyncSourceKey(appId, recordId);
  const oldTarget = toSyncLedgerJsonSafe(source.oldTarget);
  const newTarget = toSyncLedgerJsonSafe(source.newTarget);

  const startedAt = _syncLedgerIso(source.startedAt) || nowIso;
  const isTerminal = status !== SYNC_LEDGER_STATUS.STARTED;
  const finishedAt = _syncLedgerIso(source.finishedAt) || (isTerminal ? nowIso : '');

  let elapsedMs = _syncLedgerNonNegativeNumber(source.elapsedMs);
  if (elapsedMs === null && finishedAt) {
    const startMs  = new Date(startedAt).getTime();
    const finishMs = new Date(finishedAt).getTime();
    if (Number.isFinite(startMs) && Number.isFinite(finishMs)) {
      elapsedMs = Math.max(0, finishMs - startMs);
    }
  }

  return {
    loggedAt:       _syncLedgerIso(source.loggedAt) || nowIso,
    operationId:    _syncLedgerString(source.operationId),
    sourceKey,
    status,
    stage:           _syncLedgerString(source.stage),
    triggerType:     _syncLedgerString(source.triggerType),
    appId,
    recordId,
    revision:        _syncLedgerScalar(source.revision),
    eventType:       _syncLedgerString(source.eventType),
    oldTarget,
    newTarget,
    listSheetName:   _syncLedgerString(source.listSheetName)
      || _syncLedgerTargetName(newTarget, 'listSheetName'),
    domainSheetName: _syncLedgerString(source.domainSheetName)
      || _syncLedgerTargetName(newTarget, 'domainSheetName'),
    startedAt,
    finishedAt,
    elapsedMs,
    changedCells:    _syncLedgerNonNegativeNumber(source.changedCells),
    targetCount:     _syncLedgerNonNegativeNumber(source.targetCount),
    processedCount:  _syncLedgerNonNegativeNumber(source.processedCount),
    succeededCount:  _syncLedgerNonNegativeNumber(source.succeededCount),
    failedCount:     _syncLedgerNonNegativeNumber(source.failedCount),
    error:            normalizeSyncLedgerError(source.error),
    details:          toSyncLedgerJsonSafe(source.details),
    customerName:     _syncLedgerString(source.customerName),
  };
}

/**
 * context を1行のセル配列にする純粋関数。
 * 複合値は JSON として保存し、先頭 "=" 等による数式化も防ぐ。
 *
 * @param {Object} context
 * @returns {Array<*>}
 */
function buildSyncLedgerRow(context) {
  const source = context && typeof context === 'object' ? context : {};
  _assertSyncLedgerStatus(source.status || SYNC_LEDGER_STATUS.STARTED);

  const cells = {
    loggedAt:       _syncLedgerTextCell(source.loggedAt),
    operationId:    _syncLedgerTextCell(source.operationId),
    sourceKey:      _syncLedgerTextCell(source.sourceKey),
    status:         _syncLedgerTextCell(source.status || SYNC_LEDGER_STATUS.STARTED),
    stage:          _syncLedgerTextCell(source.stage),
    triggerType:    _syncLedgerTextCell(source.triggerType),
    appId:          _syncLedgerTextCell(source.appId),
    recordId:       _syncLedgerTextCell(source.recordId),
    revision:        _syncLedgerScalarCell(source.revision),
    eventType:       _syncLedgerTextCell(source.eventType),
    oldTarget:       _syncLedgerJsonCell(source.oldTarget),
    newTarget:       _syncLedgerJsonCell(source.newTarget),
    listSheetName:   _syncLedgerTextCell(source.listSheetName),
    domainSheetName: _syncLedgerTextCell(source.domainSheetName),
    startedAt:       _syncLedgerTextCell(source.startedAt),
    finishedAt:      _syncLedgerTextCell(source.finishedAt),
    elapsedMs:       _syncLedgerScalarCell(source.elapsedMs),
    changedCells:    _syncLedgerScalarCell(source.changedCells),
    targetCount:     _syncLedgerScalarCell(source.targetCount),
    processedCount:  _syncLedgerScalarCell(source.processedCount),
    succeededCount:  _syncLedgerScalarCell(source.succeededCount),
    failedCount:     _syncLedgerScalarCell(source.failedCount),
    error:           _syncLedgerJsonCell(source.error),
    details:         _syncLedgerJsonCell(source.details),
    customerName:    _syncLedgerTextCell(source.customerName),
  };

  return SYNC_LEDGER_HEADERS.map(header => cells[header]);
}

// ============================================================
// strict 書き込み（成功経路用）
// ============================================================

/**
 * Webhookイベントを `_SYNC_EVENTS` へ追記する。
 * @param {Object} context
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [spreadsheet]
 * @returns {{ sheetName: string, rowIndex: number, operationId: string }}
 * @throws {Error} ログシート作成・検証・書き込みに失敗した場合
 */
function recordSyncEvent(context, spreadsheet) {
  return _recordSyncLedger(SYNC_LEDGER_KIND.EVENT, context, spreadsheet);
}

/**
 * 定期処理ジョブを `_SYNC_JOBS` へ追記する。
 * @param {Object} context
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [spreadsheet]
 * @returns {{ sheetName: string, rowIndex: number, operationId: string }}
 * @throws {Error} ログシート作成・検証・書き込みに失敗した場合
 */
function recordSyncJob(context, spreadsheet) {
  return _recordSyncLedger(SYNC_LEDGER_KIND.JOB, context, spreadsheet);
}

/**
 * 2つのログシートを必要に応じて作成し、安全にヘッダーを初期化する。
 * 呼び出し元は ScriptLock を保持すること。
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [spreadsheet]
 * @returns {{ events: GoogleAppsScript.Spreadsheet.Sheet, jobs: GoogleAppsScript.Spreadsheet.Sheet }}
 */
function ensureSyncLedgerSheets(spreadsheet) {
  const ss = _syncLedgerSpreadsheet(spreadsheet);
  return {
    events: _ensureSyncLedgerSheet(ss, SYNC_EVENTS_SHEET_NAME),
    jobs:   _ensureSyncLedgerSheet(ss, SYNC_JOBS_SHEET_NAME),
  };
}

/**
 * @param {string} kind
 * @param {Object} context
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [spreadsheet]
 * @returns {{ sheetName: string, rowIndex: number, operationId: string }}
 * @private
 */
function _recordSyncLedger(kind, context, spreadsheet) {
  const sheetName = _syncLedgerSheetName(kind);
  const ss        = _syncLedgerSpreadsheet(spreadsheet);
  const sheet     = _ensureSyncLedgerSheet(ss, sheetName);
  const now       = new Date();
  const normalized = buildSyncLedgerContext(
    { ...(context || {}), loggedAt: now },
    now,
  );

  if (!normalized.operationId) {
    throw new Error(`${sheetName} への記録には operationId が必要です`);
  }

  const row      = buildSyncLedgerRow(normalized);
  const rowIndex = Math.max(sheet.getLastRow(), 1) + 1;

  // appendRow は使わず、追記する1行を1回の setValues で確定する。
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);

  return {
    sheetName,
    rowIndex,
    operationId: normalized.operationId,
  };
}

// ============================================================
// best-effort 書き込み（catch 内専用）
// ============================================================

/**
 * Webhookイベントをbest-effortで記録する。
 * 失敗しても例外を投げず、consoleへフォールバックする。
 *
 * @param {Object} context
 * @param {*} [primaryError] - 元の業務エラー（ログエラーで上書きしない）
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [spreadsheet]
 * @returns {boolean} 永続ログへ書けた場合 true
 */
function recordSyncEventSafe(context, primaryError, spreadsheet) {
  return _recordSyncLedgerSafe(
    SYNC_LEDGER_KIND.EVENT,
    context,
    primaryError,
    spreadsheet,
  );
}

/**
 * 定期処理ジョブをbest-effortで記録する。
 * 失敗しても例外を投げず、consoleへフォールバックする。
 *
 * @param {Object} context
 * @param {*} [primaryError] - 元の業務エラー（ログエラーで上書きしない）
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [spreadsheet]
 * @returns {boolean} 永続ログへ書けた場合 true
 */
function recordSyncJobSafe(context, primaryError, spreadsheet) {
  return _recordSyncLedgerSafe(
    SYNC_LEDGER_KIND.JOB,
    context,
    primaryError,
    spreadsheet,
  );
}

/**
 * @private
 */
function _recordSyncLedgerSafe(kind, context, primaryError, spreadsheet) {
  try {
    _recordSyncLedger(kind, context, spreadsheet);
    return true;
  } catch (ledgerError) {
    try {
      _syncLedgerConsoleFallback(kind, context, primaryError, ledgerError);
    } catch (fallbackError) {
      // best-effort API は、フォールバック自身の障害も元処理へ伝播させない。
    }
    return false;
  }
}

/**
 * 永続ログ自体が使えない場合の最終フォールバック。
 * console/Logger の失敗も外へ出さない。
 *
 * @private
 */
function _syncLedgerConsoleFallback(kind, context, primaryError, ledgerError) {
  const fallback = {
    message:      '永続同期ログの記録に失敗しました',
    kind,
    operationId: _syncLedgerString(context?.operationId),
    status:       _syncLedgerString(context?.status),
    stage:        _syncLedgerString(context?.stage),
    primaryError: normalizeSyncLedgerError(primaryError || context?.error),
    ledgerError:  normalizeSyncLedgerError(ledgerError),
  };
  const message = _syncLedgerJsonCell(fallback);

  try {
    console.error(message);
    return;
  } catch (consoleError) {
    // Apps Script の console が利用できない環境だけ Logger へ退避する。
  }

  try {
    Logger.log(message);
  } catch (loggerError) {
    // 元の業務エラーを守るため、ここでは何も投げない。
  }
}

// ============================================================
// 成功済みrevision参照
// ============================================================

/**
 * `_SYNC_EVENTS` から sourceKey の最大 SUCCEEDED revision を返す。
 * 数値として厳密に解釈できる非負整数だけを比較対象とする。
 *
 * @param {string} sourceKey
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [spreadsheet]
 * @returns {number|null}
 */
function getLatestSuccessfulRevision(sourceKey, spreadsheet) {
  const normalizedSourceKey = _syncLedgerString(sourceKey);
  if (!normalizedSourceKey) return null;

  const ss    = _syncLedgerSpreadsheet(spreadsheet);
  const sheet = ss.getSheetByName(SYNC_EVENTS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return null;

  // 判定に必要なのは eventType までの先頭10列だけ。
  const width  = SYNC_LEDGER_HEADERS.indexOf('eventType') + 1;
  const values = sheet.getRange(1, 1, sheet.getLastRow(), width).getValues();
  return findLatestSuccessfulRevision(values, normalizedSourceKey);
}

/**
 * appId/recordId指定の薄いラッパー。
 * @param {*} appId
 * @param {*} recordId
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [spreadsheet]
 * @returns {number|null}
 */
function getLatestSuccessfulRevisionForRecord(appId, recordId, spreadsheet) {
  return getLatestSuccessfulRevision(
    buildSyncSourceKey(appId, recordId),
    spreadsheet,
  );
}

/**
 * `_SYNC_EVENTS` から sourceKey の最新成功状態を返す。
 * 最大revisionを優先し、同revisionが複数あれば後ろの行を採用する。
 * customerNameは新スキーマで保存済みの場合だけ返す。
 *
 * @param {string} sourceKey
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [spreadsheet]
 * @returns {{
 *   revision: number,
 *   customerName: string,
 *   listSheetName: string,
 *   domainSheetName: string
 * }|null}
 */
function getLatestSuccessfulEventState(sourceKey, spreadsheet) {
  const normalizedSourceKey = _syncLedgerString(sourceKey);
  if (!normalizedSourceKey) return null;

  const ss = _syncLedgerSpreadsheet(spreadsheet);
  const sheet = ss.getSheetByName(SYNC_EVENTS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return null;

  const width = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, width).getValues()[0];
  let endRow = sheet.getLastRow();

  // 同じsourceKeyの成功revisionはWebhookのScriptLock下で単調増加するため、
  // 末尾側で最初に見つかった成功状態が最新。台帳全体の一括読込を避ける。
  while (endRow >= 2) {
    const startRow = Math.max(
      2,
      endRow - SYNC_LEDGER_LOOKUP_CHUNK_SIZE + 1
    );
    const rows = sheet
      .getRange(startRow, 1, endRow - startRow + 1, width)
      .getValues();
    const latest = findLatestSuccessfulEventState(
      [headers, ...rows],
      normalizedSourceKey
    );
    if (latest) return latest;
    endRow = startRow - 1;
  }
  return null;
}

/**
 * シート値からsourceKeyの最新成功状態を求める純粋関数。
 * @param {Array<Array<*>>} rows
 * @param {string} sourceKey
 * @returns {{
 *   revision: number,
 *   customerName: string,
 *   listSheetName: string,
 *   domainSheetName: string
 * }|null}
 */
function findLatestSuccessfulEventState(rows, sourceKey) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const normalizedSourceKey = _syncLedgerString(sourceKey);
  if (!normalizedSourceKey) return null;

  const headers = rows[0].map(value => _syncLedgerString(value));
  const sourceKeyCol = headers.indexOf('sourceKey');
  const statusCol = headers.indexOf('status');
  const revisionCol = headers.indexOf('revision');
  const customerNameCol = headers.indexOf('customerName');
  const listSheetNameCol = headers.indexOf('listSheetName');
  const domainSheetNameCol = headers.indexOf('domainSheetName');

  if (sourceKeyCol < 0 || statusCol < 0 || revisionCol < 0) {
    throw new Error(
      '_SYNC_EVENTS の sourceKey/status/revision ヘッダーが見つかりません'
    );
  }

  let latest = null;
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    if (_syncLedgerString(row[sourceKeyCol]) !== normalizedSourceKey) continue;
    if (_syncLedgerString(row[statusCol]) !== SYNC_LEDGER_STATUS.SUCCEEDED) continue;

    const revision = _syncLedgerRevisionNumber(row[revisionCol]);
    if (revision === null) continue;
    if (latest && revision < latest.revision) continue;

    latest = {
      revision,
      customerName: customerNameCol >= 0
        ? _syncLedgerString(row[customerNameCol])
        : '',
      listSheetName: listSheetNameCol >= 0
        ? _syncLedgerString(row[listSheetNameCol])
        : '',
      domainSheetName: domainSheetNameCol >= 0
        ? _syncLedgerString(row[domainSheetNameCol])
        : '',
    };
  }
  return latest;
}

/**
 * シート値から最大 SUCCEEDED revision を求める純粋関数。
 * rows[0] は SYNC_LEDGER_HEADERS と同じヘッダー行を想定する。
 *
 * @param {Array<Array<*>>} rows
 * @param {string} sourceKey
 * @returns {number|null}
 */
function findLatestSuccessfulRevision(rows, sourceKey) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const normalizedSourceKey = _syncLedgerString(sourceKey);
  if (!normalizedSourceKey) return null;

  const headers       = rows[0].map(value => _syncLedgerString(value));
  const sourceKeyCol  = headers.indexOf('sourceKey');
  const statusCol     = headers.indexOf('status');
  const revisionCol   = headers.indexOf('revision');
  const appIdCol      = headers.indexOf('appId');
  const recordIdCol   = headers.indexOf('recordId');

  if (statusCol < 0 || revisionCol < 0) {
    throw new Error('_SYNC_EVENTS の status/revision ヘッダーが見つかりません');
  }
  if (sourceKeyCol < 0 && (appIdCol < 0 || recordIdCol < 0)) {
    throw new Error('_SYNC_EVENTS の sourceKey または appId/recordId ヘッダーが見つかりません');
  }

  let latest = null;
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    if (_syncLedgerString(row[statusCol]) !== SYNC_LEDGER_STATUS.SUCCEEDED) continue;

    let rowSourceKey = sourceKeyCol >= 0
      ? _syncLedgerString(row[sourceKeyCol])
      : '';
    if (!rowSourceKey && appIdCol >= 0 && recordIdCol >= 0) {
      rowSourceKey = buildSyncSourceKey(row[appIdCol], row[recordIdCol]);
    }
    if (rowSourceKey !== normalizedSourceKey) continue;

    const revision = _syncLedgerRevisionNumber(row[revisionCol]);
    if (revision === null) continue;
    if (latest === null || revision > latest) latest = revision;
  }

  return latest;
}

// ============================================================
// シート作成・ヘッダー初期化
// ============================================================

/**
 * ログシートを取得または作成し、既存内容を壊さずヘッダーを整える。
 * 空の1行目は全ヘッダーを書き込み、正しい既存prefixには不足分だけを追加する。
 * 異なる既存ヘッダーは上書きせず、明示的に失敗させる。
 *
 * @private
 */
function _ensureSyncLedgerSheet(spreadsheet, sheetName) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);

  const requiredColumns = SYNC_LEDGER_HEADERS.length;
  const maxColumns      = sheet.getMaxColumns();
  if (maxColumns < requiredColumns) {
    sheet.insertColumnsAfter(maxColumns, requiredColumns - maxColumns);
  }

  const headerWidth = Math.max(sheet.getLastColumn(), requiredColumns);
  const existing    = sheet.getRange(1, 1, 1, headerWidth).getValues()[0];
  let lastNonEmpty  = -1;
  for (let i = 0; i < existing.length; i++) {
    if (_syncLedgerString(existing[i]) !== '') lastNonEmpty = i;
  }

  if (lastNonEmpty < 0) {
    sheet.getRange(1, 1, 1, requiredColumns).setValues([SYNC_LEDGER_HEADERS.slice()]);
    return sheet;
  }

  if (lastNonEmpty >= requiredColumns) {
    throw new Error(`${sheetName} のヘッダー末尾に未定義列があります`);
  }

  for (let i = 0; i <= lastNonEmpty; i++) {
    if (_syncLedgerString(existing[i]) !== SYNC_LEDGER_HEADERS[i]) {
      throw new Error(
        `${sheetName} のヘッダーが不一致です: column=${i + 1}, `
        + `expected=${SYNC_LEDGER_HEADERS[i]}, actual=${_syncLedgerString(existing[i])}`,
      );
    }
  }

  if (lastNonEmpty < requiredColumns - 1) {
    const missing = SYNC_LEDGER_HEADERS.slice(lastNonEmpty + 1);
    sheet.getRange(1, lastNonEmpty + 2, 1, missing.length).setValues([missing]);
  }

  return sheet;
}

/**
 * @private
 */
function _syncLedgerSpreadsheet(spreadsheet) {
  return spreadsheet || getSpreadsheet();
}

/**
 * @private
 */
function _syncLedgerSheetName(kind) {
  if (kind === SYNC_LEDGER_KIND.EVENT) return SYNC_EVENTS_SHEET_NAME;
  if (kind === SYNC_LEDGER_KIND.JOB) return SYNC_JOBS_SHEET_NAME;
  throw new Error(`未対応の同期ログ種別です: ${kind}`);
}

// ============================================================
// JSON-safe変換・値正規化
// ============================================================

/**
 * Error、Date、循環参照を含む値を JSON.stringify 可能な値へ変換する。
 * 入力値は変更しない。
 *
 * @param {*} value
 * @returns {*}
 */
function toSyncLedgerJsonSafe(value) {
  return _syncLedgerJsonSafeVisit(value, [], 0);
}

/**
 * @private
 */
function _syncLedgerJsonSafeVisit(value, ancestors, depth) {
  if (value === null) return null;
  if (value === undefined) return null;

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') return value;
  if (valueType === 'number') return Number.isFinite(value) ? value : null;
  if (valueType === 'bigint') return String(value);
  if (valueType === 'function') return `[Function${value.name ? `: ${value.name}` : ''}]`;
  if (valueType === 'symbol') return String(value);

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  }

  if (depth >= 12) return '[MaxDepth]';
  if (ancestors.indexOf(value) >= 0) return '[Circular]';

  const nextAncestors = ancestors.concat([value]);
  if (Array.isArray(value)) {
    return value.map(item => _syncLedgerJsonSafeVisit(item, nextAncestors, depth + 1));
  }

  const tag = Object.prototype.toString.call(value);
  const isError = value instanceof Error || /\[object .*Error\]/.test(tag);
  const output = {};

  if (isError) {
    output.name    = _syncLedgerString(value.name) || 'Error';
    output.message = _syncLedgerString(value.message);
    if (value.stack !== undefined) output.stack = _syncLedgerString(value.stack);
    if (value.cause !== undefined) {
      output.cause = _syncLedgerJsonSafeVisit(value.cause, nextAncestors, depth + 1);
    }
  }

  const keys = Object.keys(value).sort();
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(output, key)) continue;
    try {
      output[key] = _syncLedgerJsonSafeVisit(value[key], nextAncestors, depth + 1);
    } catch (propertyError) {
      output[key] = `[Unreadable: ${_syncLedgerString(propertyError?.message) || 'unknown error'}]`;
    }
  }

  return output;
}

/**
 * Error情報を必ずJSON-safeなオブジェクトへする。
 * @param {*} error
 * @returns {Object|null}
 */
function normalizeSyncLedgerError(error) {
  if (error === null || error === undefined || error === '') return null;
  if (typeof error === 'string') return { name: 'Error', message: error };

  const safe = toSyncLedgerJsonSafe(error);
  if (safe && typeof safe === 'object' && !Array.isArray(safe)) {
    if (!safe.name) safe.name = 'Error';
    if (!safe.message) safe.message = _syncLedgerString(error?.message) || _syncLedgerString(error);
    return safe;
  }

  return {
    name:    'Error',
    message: _syncLedgerString(safe),
  };
}

/**
 * @private
 */
function _assertSyncLedgerStatus(status) {
  const allowed = Object.keys(SYNC_LEDGER_STATUS)
    .map(key => SYNC_LEDGER_STATUS[key]);
  if (allowed.indexOf(status) < 0) {
    throw new Error(`未対応の同期ログstatusです: ${status}`);
  }
}

/**
 * @private
 */
function _syncLedgerString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * @private
 */
function _syncLedgerScalar(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (typeof value === 'boolean') return value;
  return _syncLedgerString(value);
}

/**
 * @private
 */
function _syncLedgerNonNegativeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

/**
 * Kintone revisionとして比較可能な非負の安全な整数だけを返す。
 * @private
 */
function _syncLedgerRevisionNumber(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  const text = _syncLedgerString(value);
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
}

/**
 * @private
 */
function _syncLedgerIso(value) {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

/**
 * @private
 */
function _syncLedgerTargetName(target, key) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return '';
  return _syncLedgerString(target[key]);
}

/**
 * 数式として解釈され得る文字列には先頭アポストロフィを付ける。
 * @private
 */
function _syncLedgerTextCell(value) {
  if (value === null || value === undefined || value === '') return '';
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return text.length <= SYNC_LEDGER_MAX_CELL_CHARS
    ? text
    : text.slice(0, SYNC_LEDGER_MAX_CELL_CHARS);
}

/**
 * @private
 */
function _syncLedgerScalarCell(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return _syncLedgerTextCell(value);
}

/**
 * JSON妥当性を壊さず、セル上限内の文字列にする。
 * @private
 */
function _syncLedgerJsonCell(value) {
  if (value === null || value === undefined || value === '') return '';

  let json;
  try {
    json = JSON.stringify(toSyncLedgerJsonSafe(value));
  } catch (error) {
    json = JSON.stringify({
      serializationError: _syncLedgerString(error?.message) || 'unknown error',
    });
  }

  if (json.length <= SYNC_LEDGER_MAX_CELL_CHARS) return _syncLedgerTextCell(json);

  let previewLength = Math.min(json.length, 12000);
  let truncated;
  do {
    truncated = JSON.stringify({
      truncated:      true,
      originalLength: json.length,
      preview:        json.slice(0, previewLength),
    });
    previewLength = Math.floor(previewLength / 2);
  } while (truncated.length > SYNC_LEDGER_MAX_CELL_CHARS && previewLength > 0);

  return _syncLedgerTextCell(truncated);
}
