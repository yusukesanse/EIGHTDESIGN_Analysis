/**
 * main.gs — エントリ・Webhook制御・書き込み振り分け（旧 main.gs + webhookHandler.gs）
 */

/** Webhook処理の排他ロック待機上限 */
const WEBHOOK_LOCK_TIMEOUT_MS = 30000;
const WEBHOOK_SUPPORTED_EVENT_TYPES = [
  'ADD_RECORD',
  'UPDATE_RECORD',
  'DELETE_RECORD',
];

// ============================================================
// エントリポイント doPost
// ============================================================

/**
 * kintoneからのWebhookを受信するエントリポイント
 * すべての処理は handleWebhook() に委譲する
 *
 * @param {Object} e - Google Apps Script POSTイベントオブジェクト
 * @returns {ContentService.TextOutput}
 */
function doPost(e) {
  return handleWebhook(e);
}

// ============================================================
// Webhookハンドラ
// ============================================================

/**
 * kintoneからのWebhookを受信し、サービス層・シート層に処理を委譲する
 *
 * @param {Object} e - Google Apps Script POSTイベントオブジェクト
 * @returns {ContentService.TextOutput} JSON形式のレスポンス
 */
function handleWebhook(e) {
  const startedAtMs = Date.now();
  const context = createSyncOperationContext('WEBHOOK', {
    stage: 'RECEIVE',
    status: 'STARTED',
  });
  let lock = null;
  let lockAcquired = false;

  try {
    // ── 1. リクエストパース & バリデーション ──────────────────
    context.stage = 'PARSE_VALIDATE';
    const { appId, record, recordId, type } = parseWebhookBody(
      e?.postData?.contents
    );

    _assertSupportedWebhookEventType(type);

    // Kintoneの削除通知にはrecord本体・revisionが無い。安定ID列と2アプリ間の
    // 削除ポリシーが未導入のため、recordIdを監査ログへ残して明示的に停止する。
    if (type === 'DELETE_RECORD') {
      Object.assign(context, {
        appId,
        recordId,
        eventType: type,
        sourceKey: buildSyncSourceKey(appId, recordId),
        targetSheet: '',
      });
      // record本体が無くても、通知元アプリは通常更新と同じ許可リストで検証する。
      _appHandler(appId);
      context.stage = 'IDENTITY_CHECK';
      throw new Error(
        `削除Webhookは安全な行識別子が未導入のため自動処理できません: ` +
        `${context.sourceKey}`
      );
    }

    _validateRecordByApp(appId, record);

    // ── 2. 正規化済みモデルの構築（抽出・正規化はここに集約）──
    context.stage = 'NORMALIZE';
    const model = buildNormalizedRecord(appId, record, type);

    const domainSheetName = buildDomainSheetName(model.customerType, model.sheetArea);
    Object.assign(context, {
      appId:          model.appId,
      recordId:       model.recordId,
      revision:       model.revision,
      eventType:      model.eventType,
      sourceKey:      model.sourceKey,
      customerName:   model.customerName,
      customerType:   model.customerType,
      sheetArea:      model.sheetArea,
      newTarget: {
        listSheetName: model.listSheetName,
        domainSheetName,
      },
      listSheetName:   model.listSheetName,
      domainSheetName,
      targetSheet:    domainSheetName,
    });

    AppLogger.info('Webhook受信', {
      appId,
      recordId:     model.recordId,
      revision:     model.revision,
      customerName:  model.customerName,
      customerType:  model.customerType,
      promotionArea: model.promotionArea,
    });

    // ── 3. 同時実行・逆順Webhookから一覧と集計を保護 ──────────
    context.stage = 'LOCK';
    lock = LockService.getScriptLock();
    lock.waitLock(WEBHOOK_LOCK_TIMEOUT_MS);
    lockAcquired = true;

    context.stage = 'REVISION_CHECK';
    const latestState = getLatestSuccessfulEventState(model.sourceKey);
    const latestRevision = latestState?.revision ?? null;
    const incomingRevision = Number(model.revision);
    const latestRevisionNumber = Number(latestRevision);
    if (
      latestRevision !== null &&
      latestRevision !== '' &&
      Number.isFinite(incomingRevision) &&
      Number.isFinite(latestRevisionNumber)
    ) {
      if (incomingRevision < latestRevisionNumber) {
        context.status = 'REJECTED_STALE';
        throw new Error(
          `古いrevisionのWebhookを拒否しました: sourceKey=${model.sourceKey}, ` +
          `incoming=${incomingRevision}, latest=${latestRevisionNumber}`
        );
      }
      if (incomingRevision === latestRevisionNumber) {
        context.status = 'SKIPPED_DUPLICATE';
        context.stage = 'COMPLETE';
        context.elapsedMs = Date.now() - startedAtMs;
        recordSyncEvent(context);
        return _jsonResponse({
          result: 'success',
          duplicate: true,
          operationId: context.operationId,
        });
      }
    }

    // sourceKeyを一覧行へ保持していない現行レイアウトでは、target/氏名変更時に
    // 旧行を一意に移動できない。新旧へ二重登録して成功扱いにせず、照合・ID移行
    // が完了するまで明示的に停止する。
    context.stage = 'IDENTITY_CHECK';
    if (latestState) {
      context.oldTarget = {
        listSheetName: latestState.listSheetName,
        domainSheetName: latestState.domainSheetName,
      };
      const targetChanged =
        latestState.listSheetName !== '' &&
        latestState.listSheetName !== model.listSheetName;
      const nameChanged =
        latestState.customerName !== '' &&
        latestState.customerName !== model.customerName;
      if (targetChanged || nameChanged) {
        throw new Error(
          `安定ID未導入のためtargetまたは顧客名の変更を自動移動できません: ` +
          `sourceKey=${model.sourceKey}`
        );
      }
    }

    const occurrences = findCustomerOccurrencesAcrossLists(
      model.customerName,
      getSpreadsheet()
    );
    if (occurrences.length > 1) {
      throw new Error(
        `安定ID未導入の一覧に同名行が複数あります: ` +
        `sourceKey=${model.sourceKey}, occurrences=${occurrences.length}`
      );
    }
    if (
      occurrences.length === 1 &&
      occurrences[0].listSheetName !== model.listSheetName
    ) {
      throw new Error(
        `Kintone原本のtargetとは別の一覧に同名行があります: ` +
        `sourceKey=${model.sourceKey}, actual=${occurrences[0].listSheetName}, ` +
        `expected=${model.listSheetName}`
      );
    }
    if (latestState && latestState.customerName === '') {
      throw new Error(
        `旧同期ログに顧客名がなく一覧行との同一性を安全に確認できません: ` +
        `sourceKey=${model.sourceKey}`
      );
    }

    recordSyncEvent(context);

    // ── 4. 対象シートの取得 ──────────────────────────────────
    context.stage = 'RESOLVE_LIST';
    const listSheet = getSheetByName(model.listSheetName);

    if (!listSheet) {
      throw new Error(`一覧シートが見つかりません: customerType=${model.customerType}, area=${model.promotionArea}`);
    }

    // ── 5. シートデータ取得（行追加・更新計画用）─────────────
    context.stage = 'READ_LIST';
    const listData = getFormattedSheetData(listSheet);

    // ── 6. アプリ種別ごとの一覧書き込み ─────────────────────
    context.stage = 'WRITE_LIST';
    const writePlan = _dispatchWrite(model, listData, listSheet);
    context.rowIndex = writePlan?.rowIndex ?? '';

    // 同じ実行内の集計が更新後一覧を必ず読み直すよう、保留中の書き込みを確定する。
    context.stage = 'FLUSH_LIST';
    SpreadsheetApp.flush();

    // ── 7. 更新後一覧を正として、対応する1組を全面再集計 ─────
    context.stage = 'AGGREGATE';
    // Webhook全体で同じScriptLockを保持しているため、内部共通経路を直接呼ぶ。
    const aggregation = _runDomainAggregationForSheet(
      model.customerType,
      model.sheetArea
    );

    context.status = 'SUCCEEDED';
    context.stage = 'COMPLETE';
    context.elapsedMs = Date.now() - startedAtMs;
    context.changedCells = aggregation.cells ?? '';
    context.details = { aggregationResult: aggregation, rowIndex: context.rowIndex };
    recordSyncEvent(context);

    AppLogger.info('Webhook処理完了', {
      operationId: context.operationId,
      sourceKey: model.sourceKey,
      listSheet: model.listSheetName,
      domainSheet: aggregation.domainSheetName,
      elapsedMs: context.elapsedMs,
    });

    return _jsonResponse({
      result: 'success',
      operationId: context.operationId,
      listSheet: model.listSheetName,
      domainSheet: aggregation.domainSheetName,
    });

  } catch (err) {
    if (context.status !== 'REJECTED_STALE') context.status = 'FAILED';
    context.elapsedMs = Date.now() - startedAtMs;
    context.errorName = err?.name ?? 'Error';
    context.errorMessage = err?.message ?? String(err);
    context.errorStack = err?.stack ?? '';
    context.error = err;
    _recordWebhookFailure(context, err, lockAcquired);

    AppLogger.error('Webhook処理エラー', err, {
      functionName: 'handleWebhook',
      operationId: context.operationId,
      stage: context.stage,
      appId: context.appId,
      recordId: context.recordId,
      customerName: context.customerName,
      customerType: context.customerType,
      targetSheet: context.targetSheet,
    });

    // ContentServiceでエラーJSONを正常返却するとWebhook側から成功に見えるため、
    // ログ保存後に再throwし、実行自体を失敗として残す。
    throw err;
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

/**
 * 失敗ログもScriptLock下で追記する。業務処理のロックを既に持つ場合は再取得しない。
 * ロック取得や永続ログ自体の失敗は、元のWebhook例外を上書きしない。
 * @param {Object} context
 * @param {*} primaryError
 * @param {boolean} lockAlreadyHeld
 * @returns {boolean}
 */
function _recordWebhookFailure(context, primaryError, lockAlreadyHeld) {
  if (lockAlreadyHeld) {
    return recordSyncEventSafe(context, primaryError);
  }

  let logLock = null;
  let acquired = false;
  try {
    logLock = LockService.getScriptLock();
    logLock.waitLock(WEBHOOK_LOCK_TIMEOUT_MS);
    acquired = true;
    return recordSyncEventSafe(context, primaryError);
  } catch (logError) {
    try {
      console.error(JSON.stringify({
        message: 'Webhook失敗ログ用のScriptLockを取得できませんでした',
        operationId: context?.operationId ?? '',
        stage: context?.stage ?? '',
        errorName: logError?.name ?? 'Error',
      }));
    } catch (fallbackError) {
      // 元のWebhook例外を守るため何も投げない。
    }
    return false;
  } finally {
    if (acquired) logLock.releaseLock();
  }
}

/**
 * 書き込みとして扱えるWebhookイベントだけを許可する。
 * 未知イベントやtype欠落を通常更新として処理しない。
 * @param {*} eventType
 */
function _assertSupportedWebhookEventType(eventType) {
  if (!WEBHOOK_SUPPORTED_EVENT_TYPES.includes(eventType)) {
    throw new Error(`未対応のWebhookイベント種別です: ${String(eventType || '(空)')}`);
  }
}

// ============================================================
// アプリ種別ごとの処理レジストリ
// ============================================================

/**
 * アプリID → その種別の処理（検証・抽出・書き込み）を返す。
 * 対応アプリを増やすときは、この表に1エントリ追加するだけでよい。
 * 「未対応のアプリID」判定もここ1箇所に集約する。
 * （GAS のロード順に依存しないよう、定数・関数の参照は呼び出し時に解決する）
 *
 * @param {string} appId
 * @returns {{ validate: Function, extract: Function, write: Function }}
 * @throws {Error} 未対応アプリIDの場合
 */
function _appHandler(appId) {
  const handlers = {
    [CUSTOMER_APP_ID]: {
      validate: validateCustomerRecord,
      extract:  extractCustomerFields,
      write:    _writeCustomerRow,
    },
    [SALES_APP_ID]: {
      validate: validateSalesRecord,
      extract:  extractSalesFields,
      write:    _writeSalesRow,
    },
  };

  const handler = handlers[appId];
  if (!handler) throw new Error(`未対応のアプリID: ${appId}`);
  return handler;
}

/**
 * アプリIDに応じたレコードバリデーションを実行する
 * @param {string} appId
 * @param {Object} record
 */
function _validateRecordByApp(appId, record) {
  _appHandler(appId).validate(record);
}

/**
 * アプリIDに応じたフィールド抽出を実行する
 * @param {string} appId
 * @param {Object} record
 * @returns {Object} 抽出済みフィールドデータ
 */
function _extractFieldsByApp(appId, record) {
  return _appHandler(appId).extract(record);
}

/**
 * 正規化済みモデルに応じたシート書き込みを実行する
 * @param {Object} model - buildNormalizedRecord() の戻り値
 * @param {Array} sheetData
 * @param {GoogleAppsScript.Spreadsheet.Sheet} listSheet
 */
function _dispatchWrite(model, sheetData, listSheet) {
  return _appHandler(model.appId).write(model, sheetData, listSheet);
}

/**
 * 顧客情報アプリの行データを生成して一覧シートへ書き込む
 * @param {Object} model
 * @param {Array} sheetData
 * @param {GoogleAppsScript.Spreadsheet.Sheet} listSheet
 */
function _writeCustomerRow(model, sheetData, listSheet) {
  const rowData = buildCustomerRowData(model.customerFields);
  return writeCustomerRecord(
    listSheet, sheetData, rowData,
    model.customerName, model.aggregationYear, model.aggregationMonth,
  );
}

/**
 * 営業・商談管理アプリの行データを生成して一覧シートへ書き込む
 * @param {Object} model
 * @param {Array} sheetData
 * @param {GoogleAppsScript.Spreadsheet.Sheet} listSheet
 */
function _writeSalesRow(model, sheetData, listSheet) {
  const fields      = model.salesFields;
  const negotiation = parseLatestNegotiation(fields.dealHistory);
  const meetingData = parseMeetingData(fields.dealHistory);
  const rowData     = buildSalesRowData(fields, negotiation, meetingData);
  return writeSalesRecord(
    listSheet, sheetData, rowData,
    model.customerName, model.aggregationYear, model.aggregationMonth,
  );
}

/**
 * JSON形式のContentService出力を生成する
 * @param {Object} body - レスポンスボディ
 * @param {boolean} [isError=false] - エラーレスポンスかどうか
 * @returns {ContentService.TextOutput}
 */
function _jsonResponse(body, isError = false) {
  if (isError) {
    AppLogger.warn('エラーレスポンスを返します', body);
  }
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
