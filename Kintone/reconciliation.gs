/**
 * reconciliation.gs — Kintone原本と18枚の一覧シートのdry-run照合
 *
 * このファイルが行うのは差異検出と `_SYNC_DIFFS` への記録だけである。
 * 一覧シートの修復、行の移動・削除、Kintoneへの書き戻しは一切行わない。
 *
 * 現行一覧には sourceKey（appId:recordId）列がないため、行照合は現行処理と
 * 同じく顧客名で行う。ただし期待targetだけでなく18一覧を横断し、0件は
 * MISSING_IN_SHEET、複数件は AMBIGUOUS_LEGACY_MATCH、別targetの1件は
 * WRONG_TARGET、期待targetの1件はアプリ所有列を比較して STALE_FIELDS とする。
 *
 * Kintone原本のどのレコードにも対応しない一覧行は UNEXPECTED_SHEET_ROW として
 * 記録するが、安全な同一性を確定できないため削除候補にはせず、自動修復もしない。
 */

// ============================================================
// 設定・定数
// ============================================================

const RECON_DIFF_SHEET_NAME = '_SYNC_DIFFS';
const RECON_PAGE_SIZE = 500;
const RECON_EXPECTED_LIST_SHEET_COUNT = 18;
const RECON_LOCK_TIMEOUT_MS = 30000;

const RECON_PROPERTY_KEYS = {
  BASE_URL:       'KINTONE_BASE_URL',
  CUSTOMER_TOKEN: 'KINTONE_CUSTOMER_API_TOKEN',
  SALES_TOKEN:    'KINTONE_SALES_API_TOKEN',
};

const RECON_DIFF_TYPES = {
  MISSING:      'MISSING_IN_SHEET',
  AMBIGUOUS:    'AMBIGUOUS_LEGACY_MATCH',
  WRONG_TARGET: 'WRONG_TARGET',
  STALE:        'STALE_FIELDS',
  UNEXPECTED:   'UNEXPECTED_SHEET_ROW',
};

const RECON_DIFF_HEADERS = [
  'runId',
  'checkedAt',
  'category',
  'sourceKey',
  'appId',
  'recordId',
  'revision',
  'listSheetName',
  'matchedRows',
  'differingColumns',
  'note',
  'actualLocations',
];

// ============================================================
// 公開エントリポイント
// ============================================================

/**
 * Kintoneの2アプリを全件取得し、18枚の一覧シートとdry-run照合する。
 *
 * Script Properties:
 *   - KINTONE_BASE_URL
 *   - KINTONE_CUSTOMER_API_TOKEN
 *   - KINTONE_SALES_API_TOKEN
 *
 * @returns {{
 *   status: string,
 *   dryRun: boolean,
 *   runId: string,
 *   sourceRecords: number,
 *   customerRecords: number,
 *   salesRecords: number,
 *   listSheets: number,
 *   accurate: number,
 *   missingInSheet: number,
 *   ambiguousLegacyMatch: number,
 *   wrongTarget: number,
 *   staleFields: number,
 *   unexpectedSheetRows: number,
 *   findings: number,
 *   sourceKeyColumnPresent: boolean,
 *   deleteCandidatesEmitted: number,
 *   elapsedMs: number
 * }}
 * @throws {Error} 設定、HTTP、JSON、レコード、シート、出力のいずれかが不正な場合
 */
function runKintoneReconciliationDryRun() {
  const startedAtMs = Date.now();
  const runId = Utilities.getUuid();
  const checkedAt = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd HH:mm:ss'
  );
  let stage = 'LOAD_CONFIG';
  let activeAppId = '';
  let lock = null;
  let lockAcquired = false;

  try {
    const config = _reconLoadConfig();

    stage = 'FETCH_CUSTOMER';
    activeAppId = CUSTOMER_APP_ID;
    const customerRecords = _reconFetchAllRecords(
      config.baseUrl,
      CUSTOMER_APP_ID,
      config.customerToken
    );

    stage = 'FETCH_SALES';
    activeAppId = SALES_APP_ID;
    const salesRecords = _reconFetchAllRecords(
      config.baseUrl,
      SALES_APP_ID,
      config.salesToken
    );

    stage = 'BUILD_EXPECTED';
    activeAppId = '';
    const expectedRecords = [
      ..._reconBuildExpectedRecords(CUSTOMER_APP_ID, customerRecords),
      ..._reconBuildExpectedRecords(SALES_APP_ID, salesRecords),
    ];

    // 一覧の読み取り中にWebhookが行挿入・更新しないよう、Sheets I/Oだけを
    // ScriptLock内で行う。Kintone HTTP取得中はWebhookを塞がない。
    stage = 'LOCK';
    lock = LockService.getScriptLock();
    lock.waitLock(RECON_LOCK_TIMEOUT_MS);
    lockAcquired = true;

    stage = 'READ_LIST_SHEETS';
    const listSnapshots = _reconReadAllListSheets(getSpreadsheet());

    stage = 'COMPUTE_DIFFS';
    const diffResult = computeKintoneListDiffs(expectedRecords, listSnapshots);

    const summary = {
      status: 'SUCCESS',
      dryRun: true,
      runId,
      sourceRecords: expectedRecords.length,
      customerRecords: customerRecords.length,
      salesRecords: salesRecords.length,
      listSheets: Object.keys(listSnapshots).length,
      accurate: diffResult.counts.accurate,
      missingInSheet: diffResult.counts.missingInSheet,
      ambiguousLegacyMatch: diffResult.counts.ambiguousLegacyMatch,
      wrongTarget: diffResult.counts.wrongTarget,
      staleFields: diffResult.counts.staleFields,
      unexpectedSheetRows: diffResult.counts.unexpectedSheetRows,
      findings: diffResult.findings.length,
      sourceKeyColumnPresent: false,
      deleteCandidatesEmitted: 0,
      elapsedMs: 0,
    };

    stage = 'WRITE_DIFFS';
    summary.elapsedMs = Date.now() - startedAtMs;
    _reconWriteDiffResults(
      getSpreadsheet(),
      runId,
      checkedAt,
      summary,
      diffResult.findings
    );

    summary.elapsedMs = Date.now() - startedAtMs;
    AppLogger.info('Kintone原本とのdry-run照合が完了しました', {
      runId,
      sourceRecords: summary.sourceRecords,
      listSheets: summary.listSheets,
      accurate: summary.accurate,
      missingInSheet: summary.missingInSheet,
      ambiguousLegacyMatch: summary.ambiguousLegacyMatch,
      wrongTarget: summary.wrongTarget,
      staleFields: summary.staleFields,
      unexpectedSheetRows: summary.unexpectedSheetRows,
      findings: summary.findings,
      sourceKeyColumnPresent: false,
      deleteCandidatesEmitted: 0,
      elapsedMs: summary.elapsedMs,
    });

    return summary;

  } catch (cause) {
    const error = _reconSafeError(cause, stage, activeAppId);
    AppLogger.error('Kintone原本とのdry-run照合に失敗しました', error, {
      functionName: 'runKintoneReconciliationDryRun',
      stage,
      appId: activeAppId,
      elapsedMs: Date.now() - startedAtMs,
    });
    throw error;

  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

/**
 * runKintoneReconciliationDryRun の短い別名。
 * @returns {ReturnType<typeof runKintoneReconciliationDryRun>}
 */
function dryRunKintoneReconciliation() {
  return runKintoneReconciliationDryRun();
}

// ============================================================
// 純粋な差分計算
// ============================================================

/**
 * 正規化済み期待レコードと、読み取り済み一覧スナップショットを比較する。
 * Sheet/API/Loggerへアクセスせず、入力も変更しない純粋関数。
 *
 * listSnapshots のセルは、Dateだけ事前に _reconCanonicalizeGrid で
 * `{ __reconDate: true, iso: string, monthDay: string }` へ変換済みとする。
 *
 * @param {Array<{
 *   sourceKey: string,
 *   appId: string,
 *   recordId: string,
 *   revision: string,
 *   customerName: string,
 *   listSheetName: string,
 *   ownedCells: Array<{col: number, value: *}>
 * }>} expectedRecords
 * @param {Object<string, Array<Array<*>>>} listSnapshots
 * @returns {{
 *   findings: Array<Object>,
 *   counts: {
 *     accurate: number,
 *     missingInSheet: number,
 *     ambiguousLegacyMatch: number,
 *     wrongTarget: number,
 *     staleFields: number,
 *     unexpectedSheetRows: number
 *   }
 * }}
 */
function computeKintoneListDiffs(expectedRecords, listSnapshots) {
  if (!Array.isArray(expectedRecords)) {
    throw new Error('expectedRecords は配列である必要があります');
  }
  if (!listSnapshots || typeof listSnapshots !== 'object' || Array.isArray(listSnapshots)) {
    throw new Error('listSnapshots はシート名をキーとするオブジェクトである必要があります');
  }

  const findings = [];
  const counts = {
    accurate: 0,
    missingInSheet: 0,
    ambiguousLegacyMatch: 0,
    wrongTarget: 0,
    staleFields: 0,
    unexpectedSheetRows: 0,
  };
  const seenSourceKeys = new Set();
  const sourceNameCounts = new Map();
  const occurrencesByCustomerName = new Map();
  const referencedLocations = new Set();

  for (const [sheetName, grid] of Object.entries(listSnapshots)) {
    if (!Array.isArray(grid)) {
      throw new Error(`一覧スナップショットの形式が不正です: ${sheetName}`);
    }
    // 1行目はヘッダー。F列に顧客名がある2行目以降だけを顧客行として扱う。
    for (let rowIndex = 1; rowIndex < grid.length; rowIndex++) {
      const row = Array.isArray(grid[rowIndex]) ? grid[rowIndex] : [];
      const customerName = row[LIST_COL_INDEX.CUSTOMER_NAME];
      if (typeof customerName !== 'string' || customerName === '') continue;
      const occurrence = {
        sheetName,
        rowNumber: rowIndex + 1,
        row,
      };
      const existing = occurrencesByCustomerName.get(customerName) || [];
      existing.push(occurrence);
      occurrencesByCustomerName.set(customerName, existing);
    }
  }

  // 同じ顧客名の1行を2アプリが補完する現行設計は許容するが、
  // 同一アプリ内に同名レコードが複数あればsource側だけでも一意に対応付けられない。
  for (const expected of expectedRecords) {
    _reconValidateExpectedRecord(expected);
    if (seenSourceKeys.has(expected.sourceKey)) {
      throw new Error(`Kintone原本にsourceKeyの重複があります: ${expected.sourceKey}`);
    }
    seenSourceKeys.add(expected.sourceKey);

    if (!Array.isArray(listSnapshots[expected.listSheetName])) {
      throw new Error(`照合対象の一覧スナップショットがありません: ${expected.listSheetName}`);
    }

    const sourceNameKey = _reconSourceNameKey(
      expected.appId,
      expected.customerName
    );
    sourceNameCounts.set(
      sourceNameKey,
      (sourceNameCounts.get(sourceNameKey) || 0) + 1
    );
  }

  for (const expected of expectedRecords) {
    // 顧客名の完全一致を18一覧横断で探し、旧target残存も見逃さない。
    const occurrences = occurrencesByCustomerName.get(expected.customerName) || [];
    for (const occurrence of occurrences) {
      referencedLocations.add(_reconLocationKey(
        occurrence.sheetName,
        occurrence.rowNumber
      ));
    }
    const matchedRows = occurrences.map(occurrence => occurrence.rowNumber);
    const actualLocations = occurrences.map(occurrence => ({
      sheetName: occurrence.sheetName,
      rowNumber: occurrence.rowNumber,
    }));

    if (
      sourceNameCounts.get(
        _reconSourceNameKey(expected.appId, expected.customerName)
      ) > 1
    ) {
      counts.ambiguousLegacyMatch++;
      findings.push(_reconFinding(
        expected,
        RECON_DIFF_TYPES.AMBIGUOUS,
        matchedRows,
        actualLocations,
        [],
        '同一Kintoneアプリに同名レコードが複数あり一覧行を一意に対応付けられません'
      ));
      continue;
    }

    if (occurrences.length === 0) {
      counts.missingInSheet++;
      findings.push(_reconFinding(
        expected,
        RECON_DIFF_TYPES.MISSING,
        [],
        [],
        [],
        '18一覧の顧客名照合で一致する行がありません'
      ));
      continue;
    }

    if (occurrences.length > 1) {
      counts.ambiguousLegacyMatch++;
      findings.push(_reconFinding(
        expected,
        RECON_DIFF_TYPES.AMBIGUOUS,
        matchedRows,
        actualLocations,
        [],
        '18一覧に同名行が複数あるため自動修復対象を決定できません'
      ));
      continue;
    }

    const occurrence = occurrences[0];
    if (occurrence.sheetName !== expected.listSheetName) {
      counts.wrongTarget++;
      findings.push(_reconFinding(
        expected,
        RECON_DIFF_TYPES.WRONG_TARGET,
        matchedRows,
        actualLocations,
        [],
        'Kintone原本から決まる期待targetとは別の一覧にあります'
      ));
      continue;
    }

    const actualRow = occurrence.row;
    const differingColumns = _reconDifferingOwnedColumns(
      actualRow,
      expected.ownedCells
    );

    if (differingColumns.length > 0) {
      counts.staleFields++;
      findings.push(_reconFinding(
        expected,
        RECON_DIFF_TYPES.STALE,
        matchedRows,
        actualLocations,
        differingColumns,
        'アプリ所有列に不一致があります'
      ));
    } else {
      counts.accurate++;
    }
  }

  // 期待レコードの候補に一度もならなかった顧客行は、削除せず差分として残す。
  for (const occurrences of occurrencesByCustomerName.values()) {
    for (const occurrence of occurrences) {
      const locationKey = _reconLocationKey(
        occurrence.sheetName,
        occurrence.rowNumber
      );
      if (referencedLocations.has(locationKey)) continue;
      counts.unexpectedSheetRows++;
      findings.push({
        category: RECON_DIFF_TYPES.UNEXPECTED,
        sourceKey: '',
        appId: '',
        recordId: '',
        revision: '',
        listSheetName: occurrence.sheetName,
        matchedRows: [occurrence.rowNumber],
        actualLocations: [{
          sheetName: occurrence.sheetName,
          rowNumber: occurrence.rowNumber,
        }],
        differingColumns: [],
        note: 'Kintone原本の顧客名と一致しない一覧行です。自動削除はしません',
      });
    }
  }

  return { findings, counts };
}

/**
 * 一覧位置の内部比較キーを作る。
 * @param {string} sheetName
 * @param {number} rowNumber
 * @returns {string}
 */
function _reconLocationKey(sheetName, rowNumber) {
  return `${sheetName}\u0000${rowNumber}`;
}

/**
 * 顧客名自体をログや例外へ出さず、同一アプリ内の重複判定キーを作る。
 * @param {string} appId
 * @param {string} customerName
 * @returns {string}
 */
function _reconSourceNameKey(appId, customerName) {
  return `${appId}\u0000${customerName}`;
}

/**
 * 期待レコードの形を検証する。
 * 顧客名は照合にだけ使用し、例外メッセージには含めない。
 * @param {Object} expected
 */
function _reconValidateExpectedRecord(expected) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
    throw new Error('期待レコードの形式が不正です');
  }
  for (const key of ['sourceKey', 'appId', 'recordId', 'customerName', 'listSheetName']) {
    if (typeof expected[key] !== 'string' || expected[key] === '') {
      throw new Error(`期待レコードの${key}が不正です`);
    }
  }
  if (!Array.isArray(expected.ownedCells)) {
    throw new Error(`期待レコードのownedCellsが不正です: ${expected.sourceKey}`);
  }
}

/**
 * アプリ所有列だけを比較し、不一致列番号を昇順で返す。
 * 同じ列が複数回現れる場合は、実際の書き込みと同じく後勝ち。
 * @param {Array<*>} actualRow
 * @param {Array<{col: number, value: *}>} ownedCells
 * @returns {number[]}
 */
function _reconDifferingOwnedColumns(actualRow, ownedCells) {
  const expectedByColumn = new Map();
  for (const cell of ownedCells) {
    if (!cell || !Number.isInteger(cell.col) || cell.col < 1) {
      throw new Error('ownedCells に不正な列番号があります');
    }
    expectedByColumn.set(cell.col, cell.value ?? '');
  }

  const differing = [];
  const columns = [...expectedByColumn.keys()].sort((a, b) => a - b);
  for (const col of columns) {
    const actual = actualRow[col - 1];
    const expected = expectedByColumn.get(col);
    if (!_reconValuesEqual(actual, expected)) differing.push(col);
  }
  return differing;
}

/**
 * Sheet由来の値と期待値を、表示上同値か比較する。
 * 数値と同じ数値文字列は同値とし、DateはISO日付またはM月D日で照合する。
 * @param {*} actual
 * @param {*} expected
 * @returns {boolean}
 */
function _reconValuesEqual(actual, expected) {
  if (actual && typeof actual === 'object' && actual.__reconDate === true) {
    const expectedText = _reconScalarText(expected);
    return expectedText === actual.iso || expectedText === actual.monthDay;
  }
  return _reconScalarText(actual) === _reconScalarText(expected);
}

/**
 * セル比較用の安定した文字列表現へ変換する。
 * @param {*} value
 * @returns {string}
 */
function _reconScalarText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  const monthDay = text.match(/^0?(\d{1,2})月0?(\d{1,2})日$/);
  if (monthDay) {
    return `${Number(monthDay[1])}月${Number(monthDay[2])}日`;
  }
  return text;
}

/**
 * 差分オブジェクトを組み立てる。顧客名・実値・期待値は保持しない。
 * @param {Object} expected
 * @param {string} category
 * @param {number[]} matchedRows
 * @param {Array<{sheetName: string, rowNumber: number}>} actualLocations
 * @param {number[]} differingColumns
 * @param {string} note
 * @returns {Object}
 */
function _reconFinding(
  expected,
  category,
  matchedRows,
  actualLocations,
  differingColumns,
  note
) {
  return {
    category,
    sourceKey: expected.sourceKey,
    appId: expected.appId,
    recordId: expected.recordId,
    revision: expected.revision ?? '',
    listSheetName: expected.listSheetName,
    matchedRows: matchedRows.slice(),
    actualLocations: actualLocations.map(location => ({ ...location })),
    differingColumns: differingColumns.slice(),
    note,
  };
}

// ============================================================
// Kintone取得・期待値生成
// ============================================================

/**
 * Script Propertiesを読み、必要値を検証する。
 * @returns {{
 *   baseUrl: string,
 *   customerToken: string,
 *   salesToken: string
 * }}
 */
function _reconLoadConfig() {
  const properties = PropertiesService.getScriptProperties();
  const rawBaseUrl = _reconRequiredProperty(properties, RECON_PROPERTY_KEYS.BASE_URL);
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');

  // API endpointの取り違えや平文通信を防ぐため、origin形式のHTTPS URLだけを許可する。
  if (!/^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?$/.test(baseUrl)) {
    throw new Error('KINTONE_BASE_URL はパス・クエリを含まないHTTPS URLである必要があります');
  }

  return {
    baseUrl,
    customerToken: _reconRequiredProperty(
      properties,
      RECON_PROPERTY_KEYS.CUSTOMER_TOKEN
    ),
    salesToken: _reconRequiredProperty(
      properties,
      RECON_PROPERTY_KEYS.SALES_TOKEN
    ),
  };
}

/**
 * 必須Script Propertyを取得する。値そのものは例外やログに含めない。
 * @param {GoogleAppsScript.Properties.Properties} properties
 * @param {string} key
 * @returns {string}
 */
function _reconRequiredProperty(properties, key) {
  const value = properties.getProperty(key);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`必須Script Propertyが未設定です: ${key}`);
  }
  return value.trim();
}

/**
 * IDページングで1アプリの全レコードを取得する。
 * offsetは使用せず、必ず `$id > lastRecordId order by $id asc limit 500` とする。
 *
 * @param {string} baseUrl
 * @param {string} appId
 * @param {string} apiToken
 * @returns {Object[]}
 */
function _reconFetchAllRecords(baseUrl, appId, apiToken) {
  const records = [];
  let lastRecordId = 0;

  while (true) {
    const page = _reconFetchRecordPage(baseUrl, appId, apiToken, lastRecordId);
    if (page.length === 0) break;

    let pageLastId = lastRecordId;
    for (const record of page) {
      const recordId = _reconStrictRecordId(record, appId);
      if (recordId <= pageLastId) {
        throw new Error(
          `Kintone APIの$id順序が不正です: appId=${appId}, afterId=${lastRecordId}`
        );
      }
      pageLastId = recordId;
      records.push(record);
    }

    if (pageLastId <= lastRecordId) {
      throw new Error(`Kintone APIのページングが進みません: appId=${appId}`);
    }
    lastRecordId = pageLastId;

    if (page.length < RECON_PAGE_SIZE) break;
  }

  return records;
}

/**
 * Kintone REST APIから最大500件を取得する。
 * トークンはヘッダーだけに設定し、URL・ログ・例外には含めない。
 *
 * @param {string} baseUrl
 * @param {string} appId
 * @param {string} apiToken
 * @param {number} lastRecordId
 * @returns {Object[]}
 */
function _reconFetchRecordPage(baseUrl, appId, apiToken, lastRecordId) {
  const query =
    `$id > ${lastRecordId} order by $id asc limit ${RECON_PAGE_SIZE}`;
  const url =
    `${baseUrl}/k/v1/records.json?app=${encodeURIComponent(appId)}` +
    `&query=${encodeURIComponent(query)}`;

  let response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'X-Cybozu-API-Token': apiToken,
      },
      muteHttpExceptions: true,
    });
  } catch (cause) {
    // UrlFetchApp由来の文面を引き継がず、ヘッダー値がログへ混ざる余地をなくす。
    throw new Error(
      `Kintone APIへの接続に失敗しました: appId=${appId}, afterId=${lastRecordId}`
    );
  }

  if (
    !response ||
    typeof response.getResponseCode !== 'function' ||
    typeof response.getContentText !== 'function'
  ) {
    throw new Error(`Kintone APIレスポンスの形式が不正です: appId=${appId}`);
  }

  const statusCode = response.getResponseCode();
  if (statusCode !== 200) {
    // レスポンス本文は個人情報を含み得るため、例外・ログへ含めない。
    throw new Error(
      `Kintone APIがHTTP ${statusCode}を返しました: appId=${appId}, afterId=${lastRecordId}`
    );
  }

  const body = response.getContentText();
  if (typeof body !== 'string' || body.trim() === '') {
    throw new Error(`Kintone APIレスポンス本文が空です: appId=${appId}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (cause) {
    throw new Error(`Kintone APIレスポンスのJSON解析に失敗しました: appId=${appId}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Kintone APIレスポンスがオブジェクトではありません: appId=${appId}`);
  }
  if (!Array.isArray(parsed.records)) {
    throw new Error(`Kintone APIレスポンスにrecords配列がありません: appId=${appId}`);
  }
  if (parsed.records.length > RECON_PAGE_SIZE) {
    throw new Error(`Kintone APIレスポンス件数が上限を超えています: appId=${appId}`);
  }
  for (const record of parsed.records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error(`Kintone APIのrecords要素が不正です: appId=${appId}`);
    }
  }

  return parsed.records;
}

/**
 * `$id`を安全な正整数として検証する。
 * @param {Object} record
 * @param {string} appId
 * @returns {number}
 */
function _reconStrictRecordId(record, appId) {
  const idText = String(record?.$id?.value ?? '');
  if (!/^[1-9]\d*$/.test(idText)) {
    throw new Error(`Kintoneレコードの$idが不正です: appId=${appId}`);
  }
  const id = Number(idText);
  if (!Number.isSafeInteger(id)) {
    throw new Error(`Kintoneレコードの$idが安全な整数範囲外です: appId=${appId}`);
  }
  return id;
}

/**
 * Kintoneレコード群を一覧シート比較用の期待レコードへ変換する。
 * @param {string} appId
 * @param {Object[]} records
 * @returns {Object[]}
 */
function _reconBuildExpectedRecords(appId, records) {
  if (!Array.isArray(records)) {
    throw new Error(`Kintoneレコード群が配列ではありません: appId=${appId}`);
  }
  return records.map((record) => _reconBuildExpectedRecord(appId, record));
}

/**
 * 既存の検証・正規化・行生成関数だけを使って1件の期待列を作る。
 * @param {string} appId
 * @param {Object} record
 * @returns {Object}
 */
function _reconBuildExpectedRecord(appId, record) {
  let recordId = '';
  try {
    recordId = String(record?.$id?.value ?? '');
    _reconStrictRecordId(record, appId);
    _validateRecordByApp(appId, record);

    const model = buildNormalizedRecord(appId, record, 'RECONCILIATION_DRY_RUN');
    let ownedCells;

    if (appId === CUSTOMER_APP_ID) {
      ownedCells = buildCustomerRowData(model.customerFields);
    } else if (appId === SALES_APP_ID) {
      const fields = model.salesFields;
      const negotiation = parseLatestNegotiation(fields.dealHistory);
      const meetingData = parseMeetingData(fields.dealHistory);
      ownedCells = buildSalesRowData(fields, negotiation, meetingData);
    } else {
      throw new Error('未対応のアプリIDです');
    }

    return {
      sourceKey: model.sourceKey,
      appId: model.appId,
      recordId: model.recordId,
      revision: model.revision ?? '',
      customerName: model.customerName,
      listSheetName: model.listSheetName,
      ownedCells: ownedCells.map((cell) => ({ col: cell.col, value: cell.value })),
    };

  } catch (cause) {
    // 既存検証関数のメッセージに顧客名等が含まれる可能性があるため、安全な文面へ包む。
    const safeId = /^[1-9]\d*$/.test(recordId) ? recordId : 'UNKNOWN';
    throw new Error(
      `Kintoneレコードの検証・正規化に失敗しました: appId=${appId}, recordId=${safeId}`
    );
  }
}

// ============================================================
// 一覧シート読取・差分出力
// ============================================================

/**
 * 9ドメイン×2エリアの一覧シートを各1回だけ全範囲読み取りする。
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @returns {Object<string, Array<Array<*>>>}
 */
function _reconReadAllListSheets(spreadsheet) {
  const names = [];
  for (const area of AGG_AREAS) {
    for (const domain of AGG_DOMAINS) {
      names.push(buildListSheetName(area, domain.type));
    }
  }

  if (names.length !== RECON_EXPECTED_LIST_SHEET_COUNT) {
    throw new Error(
      `照合対象一覧が18枚ではありません: actual=${names.length}`
    );
  }

  const snapshots = {};
  const timeZone = Session.getScriptTimeZone();
  for (const sheetName of names) {
    if (Object.prototype.hasOwnProperty.call(snapshots, sheetName)) {
      throw new Error(`照合対象一覧名が重複しています: ${sheetName}`);
    }

    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error(`照合対象の一覧シートが見つかりません: ${sheetName}`);
    }

    const values = sheet.getDataRange().getValues();
    if (!Array.isArray(values) || values.some((row) => !Array.isArray(row))) {
      throw new Error(`一覧シートの読取結果が不正です: ${sheetName}`);
    }
    snapshots[sheetName] = _reconCanonicalizeGrid(values, timeZone);
  }

  return snapshots;
}

/**
 * Dateセルだけを純粋比較用の値へ変換し、それ以外は保持する。
 * 入力配列は変更しない。
 * @param {Array<Array<*>>} values
 * @param {string} timeZone
 * @returns {Array<Array<*>>}
 */
function _reconCanonicalizeGrid(values, timeZone) {
  return values.map((row) => row.map((value) => {
    if (!(value instanceof Date)) return value;
    return {
      __reconDate: true,
      iso: Utilities.formatDate(value, timeZone, 'yyyy-MM-dd'),
      monthDay: Utilities.formatDate(value, timeZone, 'M月d日'),
    };
  }));
}

/**
 * 今回のsummaryと差分を `_SYNC_DIFFS` へ履歴追記する。
 * appendRowは使わず、1回のsetValuesで今回分を一括書き込みする。
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet
 * @param {string} runId
 * @param {string} checkedAt
 * @param {Object} summary
 * @param {Object[]} findings
 */
function _reconWriteDiffResults(spreadsheet, runId, checkedAt, summary, findings) {
  let sheet = spreadsheet.getSheetByName(RECON_DIFF_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(RECON_DIFF_SHEET_NAME);

  const summaryNote = JSON.stringify({
    dryRun: true,
    sourceRecords: summary.sourceRecords,
    customerRecords: summary.customerRecords,
    salesRecords: summary.salesRecords,
    listSheets: summary.listSheets,
    accurate: summary.accurate,
    missingInSheet: summary.missingInSheet,
    ambiguousLegacyMatch: summary.ambiguousLegacyMatch,
    wrongTarget: summary.wrongTarget,
    staleFields: summary.staleFields,
    unexpectedSheetRows: summary.unexpectedSheetRows,
    findings: summary.findings,
    sourceKeyColumnPresent: false,
    deleteCandidatesEmitted: 0,
  });

  const rows = [[
    runId,
    checkedAt,
    'RUN_SUMMARY',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    summaryNote,
    '',
  ]];

  for (const finding of findings) {
    rows.push([
      runId,
      checkedAt,
      finding.category,
      finding.sourceKey,
      finding.appId,
      finding.recordId,
      finding.revision,
      finding.listSheetName,
      finding.matchedRows.join(','),
      finding.differingColumns.join(','),
      finding.note,
      finding.actualLocations
        .map(location => `${location.sheetName}!${location.rowNumber}`)
        .join(','),
    ]);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    const values = [RECON_DIFF_HEADERS, ...rows];
    _reconEnsureSheetCapacity(
      sheet,
      values.length,
      RECON_DIFF_HEADERS.length
    );
    sheet.getRange(1, 1, values.length, RECON_DIFF_HEADERS.length).setValues(values);
    return;
  }

  _reconEnsureDiffHeaders(sheet, lastRow);

  _reconEnsureSheetCapacity(
    sheet,
    lastRow + rows.length,
    RECON_DIFF_HEADERS.length
  );
  sheet
    .getRange(lastRow + 1, 1, rows.length, RECON_DIFF_HEADERS.length)
    .setValues(rows);
}

/**
 * `_SYNC_DIFFS` の既存ヘッダーを検証し、正しいprefixに限って不足分を末尾へ追加する。
 * 旧11列スキーマはそのまま保持し、actualLocationsだけを12列目へ追加する。
 * ヘッダーのない既存データ、未知の余分列、欠落列に既存値がある場合は移行しない。
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} lastRow
 */
function _reconEnsureDiffHeaders(sheet, lastRow) {
  const expectedColumnCount = RECON_DIFF_HEADERS.length;
  const lastColumn = sheet.getLastColumn();
  if (!Number.isInteger(lastColumn) || lastColumn < 1) {
    throw new Error(
      `${RECON_DIFF_SHEET_NAME} のヘッダーがないため追記できません`
    );
  }

  const currentHeaders = sheet
    .getRange(1, 1, 1, lastColumn)
    .getValues()[0];
  let existingHeaderCount = 0;
  for (let index = currentHeaders.length - 1; index >= 0; index--) {
    if (String(currentHeaders[index] ?? '') !== '') {
      existingHeaderCount = index + 1;
      break;
    }
  }

  if (
    existingHeaderCount === 0 ||
    existingHeaderCount > expectedColumnCount ||
    !_reconHeadersEqual(
      currentHeaders.slice(0, existingHeaderCount),
      RECON_DIFF_HEADERS.slice(0, existingHeaderCount)
    )
  ) {
    throw new Error(
      `${RECON_DIFF_SHEET_NAME} のヘッダーが想定と一致しないため追記できません`
    );
  }

  // ヘッダー外または不足ヘッダー配下に既存値があれば、列の意味を推測せず停止する。
  if (lastRow > 1 && lastColumn > existingHeaderCount) {
    const uncheckedValues = sheet
      .getRange(
        2,
        existingHeaderCount + 1,
        lastRow - 1,
        lastColumn - existingHeaderCount
      )
      .getValues();
    const hasUnknownValue = uncheckedValues.some(
      row => row.some(value => String(value ?? '') !== '')
    );
    if (hasUnknownValue) {
      throw new Error(
        `${RECON_DIFF_SHEET_NAME} にヘッダー未定義の既存値があるため追記できません`
      );
    }
  }

  if (lastColumn > expectedColumnCount) {
    throw new Error(
      `${RECON_DIFF_SHEET_NAME} に未知の余分列があるため追記できません`
    );
  }

  if (existingHeaderCount === expectedColumnCount) return;

  _reconEnsureSheetCapacity(sheet, lastRow, expectedColumnCount);
  const missingHeaders = RECON_DIFF_HEADERS.slice(existingHeaderCount);
  sheet
    .getRange(
      1,
      existingHeaderCount + 1,
      1,
      missingHeaders.length
    )
    .setValues([missingHeaders]);
}

/**
 * 一括書き込み先の行・列容量を確保する。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} requiredRows
 * @param {number} requiredColumns
 */
function _reconEnsureSheetCapacity(sheet, requiredRows, requiredColumns) {
  const maxRows = sheet.getMaxRows();
  if (maxRows < requiredRows) {
    sheet.insertRowsAfter(maxRows, requiredRows - maxRows);
  }

  const maxColumns = sheet.getMaxColumns();
  if (maxColumns < requiredColumns) {
    sheet.insertColumnsAfter(maxColumns, requiredColumns - maxColumns);
  }
}

/**
 * ヘッダー配列の厳格比較。
 * @param {Array<*>} actual
 * @param {Array<string>} expected
 * @returns {boolean}
 */
function _reconHeadersEqual(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (String(actual[i] ?? '') !== expected[i]) return false;
  }
  return true;
}

// ============================================================
// エラーの安全化
// ============================================================

/**
 * ログへ顧客名・APIトークン・レスポンス本文を出さないため、
 * この処理系が生成した安全なErrorだけをそのまま使い、その他は一般化する。
 *
 * @param {*} cause
 * @param {string} stage
 * @param {string} appId
 * @returns {Error}
 */
function _reconSafeError(cause, stage, appId) {
  const message = cause instanceof Error ? cause.message : '';
  const safePrefixes = [
    '必須Script Property',
    'KINTONE_BASE_URL',
    'Kintone API',
    'Kintoneレコード',
    'Kintone原本',
    'expectedRecords',
    'listSnapshots',
    '期待レコード',
    'ownedCells',
    '照合対象',
    RECON_DIFF_SHEET_NAME,
  ];
  const isSafe = safePrefixes.some((prefix) => message.startsWith(prefix));
  const error = new Error(
    isSafe
      ? message
      : `dry-run照合処理に失敗しました: stage=${stage}, appId=${appId || 'N/A'}`
  );
  error.name = 'KintoneReconciliationError';
  error.stage = stage;
  error.appId = appId || '';
  return error;
}
