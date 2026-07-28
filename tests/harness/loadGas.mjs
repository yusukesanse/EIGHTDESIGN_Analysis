// ============================================================
// loadGas.mjs — GAS(.gs) コードを Node.js 上で評価するテストハーネス
// ------------------------------------------------------------
// 目的: 現行の .gs コードを一切改変せずに読み込み、純粋関数・集計関数の
//       「現在の出力」を特性テスト（characterization test）で固定する。
//
// 制約遵守:
//   - 外部 npm パッケージ不使用（node:fs / node:vm / node:path / node:url のみ）
//   - GAS V8 と同様、全 .gs は単一グローバルスコープで評価する
//   - GAS プラットフォーム API はテスト用スタブで代替（実 API へは接続しない）
//   - .gs ファイルの内容は読み取るだけで書き換えない
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..', '..');

/**
 * 系統1（Kintone Webhook → 一覧シート書き込み）に必要な .gs ファイル群。
 * GAS 実行時と同じく単一スコープへ連結して評価する。
 * グラフ集計（旧 graph/ 一式）は廃止（集計はスプレッドシートの数式で行う方針）。
 */
export const CORE_FILES = [
  'Kintone/config.gs',       // 定数・フィールドコード・シート列定義
  'Kintone/utils.gs',        // ロガー・入力検証
  'Kintone/parser.gs',       // Kintone構造の抽出・パース
  'Kintone/transformer.gs',  // 正規化・行データ生成・モデル
  'Kintone/sheets.gs',       // シート取得・書き込み
  'Kintone/ledger.gs',       // Webhook・定期集計の永続実行ログ
  'Kintone/aggregation.gs',  // ドメインシート集計（全面再計算）
  'Kintone/reconciliation.gs', // Kintone原本と18一覧のdry-run照合
  'Kintone/main.gs',         // エントリ・Webhook制御・振り分け
];

/** テストから参照できるよう globalThis へ公開するシンボル名 */
const EXPOSED = [
  // 定数
  'CUSTOMER_APP_ID', 'SALES_APP_ID', 'RANK_MAP', 'CUSTOMER_TYPES', 'AREAS',
  'CUSTOMER_LIST_COLS', 'SALES_LIST_COLS', 'LIST_COL_INDEX',
  'RESIDENTIAL_EXTRA_COLS', 'BUSINESS_EXTRA_COLS',
  // 変換・正規化
  'transformInquiryDate', 'normalizeCustomerType', 'normalizePromotionArea',
  'transformRank', 'transformNegotiationStatus', 'transformIncome', 'extractEventDetail',
  // Kintone パーサ
  'getUserFieldName', 'getSubtableRows', 'parseLatestNegotiation',
  'parseMeetingData', 'parseInquiryContent',
  // 行データ生成
  'buildCustomerRowData', 'buildSalesRowData',
  // 正規化済みモデル
  'buildNormalizedRecord',
  // 検証・ディスパッチ・パース
  'validateWebhookPayload', 'validateCustomerRecord', 'validateSalesRecord',
  '_validateRecordByApp', '_extractFieldsByApp', 'extractCustomerFields', 'extractSalesFields',
  'parseWebhookBody', 'handleWebhook', '_dispatchWrite',
  '_assertSupportedWebhookEventType', '_recordWebhookFailure',
  // シート名
  'buildListSheetName', 'buildDomainSheetName',
  // 行探索・書き込み計画
  'planRowWrite', 'applyRowWrite', 'updateRowData',
  'findCustomerOccurrencesAcrossLists',
  // ドメインシート集計（全面再計算）
  'buildAggregationWrites', 'resolveAggregationYear', 'computeCurrentAggregationYear',
  'runDomainAggregation', 'runDomainAggregationForSheet',
  'AGG_ROWS', 'AGG_RESIDENTIAL_ROWS', 'AGG_BUSINESS_ROWS', 'AGG_DOMAINS', 'AGG_AREAS',
  'AGG_UNKNOWN_LABELS', 'AGG_AREA_UNKNOWN_LABELS',
  '_mediaKeyResolver', '_areaKeyResolver', '_findLabelIndexIgnoreCase',
  // 永続実行ログ
  'SYNC_LEDGER_HEADERS', 'SYNC_LEDGER_STATUS',
  'buildSyncSourceKey', 'generateSyncOperationId', 'createSyncOperationContext',
  'buildSyncLedgerContext', 'buildSyncLedgerRow', 'findLatestSuccessfulRevision',
  'findLatestSuccessfulEventState',
  'toSyncLedgerJsonSafe',
  'recordSyncEvent', 'recordSyncJob', 'recordSyncEventSafe', 'recordSyncJobSafe',
  'getLatestSuccessfulRevision', 'getLatestSuccessfulEventState',
  // Kintone原本とのdry-run照合
  'RECON_DIFF_TYPES', 'RECON_DIFF_HEADERS', 'RECON_PAGE_SIZE',
  'runKintoneReconciliationDryRun', 'dryRunKintoneReconciliation',
  'computeKintoneListDiffs', '_reconFetchAllRecords',
];

/**
 * GAS プラットフォーム API のテスト用スタブを構築する。
 * 実 API・実データ・秘密情報へは一切アクセスしない。
 * @param {Object<string,string>} scriptProps スクリプトプロパティの疑似値
 * @param {Object<string,*>} platformOverrides GAS APIスタブの差し替え
 */
function buildGasStubs(scriptProps, platformOverrides = {}) {
  const props = {
    SPREADSHEET_ID: 'TEST_SPREADSHEET_ID',
    SLACK_WEBHOOK_URL: '',   // 空 → Slack 通知はスキップされる
    DEBUG_MODE: 'false',
    ...scriptProps,
  };

  const defaults = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
      }),
    },
    Session: {
      getScriptTimeZone: () => 'Asia/Tokyo',
    },
    Utilities: {
      // 'yyyy-MM-dd' 系の書式のみ簡易実装（Asia/Tokyo 固定 +9h）。他書式は ISO 風で返す。
      formatDate: (date, tz, fmt) => {
        if (!(date instanceof Date)) return String(date);
        const offsetMs = tz === 'Asia/Tokyo' ? 9 * 3600 * 1000 : 0;
        const d = new Date(date.getTime() + offsetMs);
        const pad = (n) => String(n).padStart(2, '0');
        const parts = {
          yyyy: d.getUTCFullYear(),
          MM: pad(d.getUTCMonth() + 1),
          M: d.getUTCMonth() + 1,
          dd: pad(d.getUTCDate()),
          d: d.getUTCDate(),
          HH: pad(d.getUTCHours()),
          mm: pad(d.getUTCMinutes()),
          ss: pad(d.getUTCSeconds()),
        };
        if (typeof fmt === 'string' && /yyyy/.test(fmt)) {
          return fmt.replace(/yyyy|MM|dd|HH|mm|ss|M|d/g, (m) => parts[m]);
        }
        return date.toISOString();
      },
      getUuid: () => '00000000-0000-4000-8000-000000000001',
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({
        _text: text,
        setMimeType() { return this; },
        getContent() { return this._text; },
      }),
    },
    // 以下は本ハーネスのテストでは呼ばない想定。誤使用を検知できるよう明示的に投げる。
    SpreadsheetApp: {
      openById: () => { throw new Error('SpreadsheetApp.openById はテストで使用しない'); },
      flush: () => {},
    },
    UrlFetchApp: {
      fetch: () => { throw new Error('UrlFetchApp.fetch はテストで使用しない（実 API 禁止）'); },
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {},
        releaseLock: () => {},
      }),
    },
    ScriptApp: {
      getProjectTriggers: () => [],
      deleteTrigger: () => {},
      newTrigger: () => { throw new Error('ScriptApp.newTrigger はテストで使用しない'); },
    },
    Logger: { log: () => {} },
  };

  return { ...defaults, ...platformOverrides };
}

/**
 * .gs 群を単一スコープで評価し、公開シンボルを返す。
 *
 * 実装メモ: node:vm の別レルムだと生成される配列/オブジェクトの prototype が
 * ホストと異なり deepStrictEqual が誤検知するため、ホストレルム上の
 * `new Function` ファクトリで評価する（GAS プラットフォーム API は引数で注入）。
 *
 * @param {{
 *   files?: string[],
 *   scriptProps?: Object<string,string>,
 *   platformOverrides?: Object<string,*>,
 *   quiet?: boolean,
 * }} [opts]
 * @returns {Object} 公開された関数・定数のマップ
 */
export function loadGas(opts = {}) {
  const files = opts.files ?? CORE_FILES;
  const quiet = opts.quiet ?? true;

  const sources = files.map((rel) => {
    const abs = join(REPO_ROOT, rel);
    return `\n// ===== ${rel} =====\n` + readFileSync(abs, 'utf8');
  });

  // 末尾で公開シンボルをローカルの __out へ集約して return する。
  // 未定義シンボルがあっても落とさないよう typeof ガードで拾う。
  const epilogue =
    '\n;var __out = {};\n' +
    EXPOSED.map(
      (name) =>
        `try { if (typeof ${name} !== 'undefined') __out.${name} = ${name}; } catch (e) {}`,
    ).join('\n') +
    '\nreturn __out;';

  const stubs = buildGasStubs(opts.scriptProps ?? {}, opts.platformOverrides ?? {});
  const consoleStub = quiet
    ? { log() {}, info() {}, warn() {}, error() {}, debug() {} }
    : console;

  const paramNames = [
    'PropertiesService', 'Session', 'Utilities', 'ContentService',
    'SpreadsheetApp', 'UrlFetchApp', 'LockService', 'ScriptApp', 'Logger', 'console',
  ];
  // eslint-disable-next-line no-new-func
  const factory = new Function(...paramNames, sources.join('\n') + epilogue);
  return factory(
    stubs.PropertiesService, stubs.Session, stubs.Utilities, stubs.ContentService,
    stubs.SpreadsheetApp, stubs.UrlFetchApp, stubs.LockService, stubs.ScriptApp,
    stubs.Logger, consoleStub,
  );
}

/**
 * setValues/setValue の呼び出しを記録するフェイクの Sheet を生成する。
 * @returns {{ sheet: Object, writes: Array, singleSets: Array, inserts: Array }}
 */
export function makeFakeSheet(lastColumn = 60) {
  const writes = [];       // { row, col, numRows, numCols, values }
  const singleSets = [];   // { row, col, value }
  const inserts = [];      // afterRow
  const sheet = {
    getName: () => 'FAKE_SHEET',
    getLastColumn: () => lastColumn,
    insertRowAfter: (afterRow) => { inserts.push(afterRow); },
    getRange: (row, col, numRows = 1, numCols = 1) => ({
      setValues: (values) => { writes.push({ row, col, numRows, numCols, values }); },
      setValue: (value) => { singleSets.push({ row, col, value }); },
      getValues: () => Array.from({ length: numRows }, () => new Array(numCols).fill('')),
    }),
  };
  return { sheet, writes, singleSets, inserts };
}

/**
 * 指定サイズの空グラフデータ（0 始まりのダミー行を先頭に含む二次元配列）を作る。
 * getFormattedSheetData と同様、index=行番号 になるようにしておく。
 */
export function makeGraphData(rows = 520, cols = 12) {
  return Array.from({ length: rows }, () => new Array(cols).fill(''));
}
