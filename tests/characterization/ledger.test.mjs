import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from '../harness/loadGas.mjs';
import {
  StatefulSheet,
  StatefulSpreadsheet,
} from '../harness/statefulSpreadsheet.mjs';

const g = loadGas();

test('同期ログ: operationIdはtrigger・時刻・UUIDから再現可能に生成する', () => {
  assert.equal(
    g.generateSyncOperationId(
      'WEBHOOK',
      '2026-07-24T01:02:03.004Z',
      '11111111-2222-4333-8444-555555555555',
    ),
    'webhook-20260724010203004-11111111-2222-4333-8444-555555555555',
  );
});

test('同期ログ: contextを共通ヘッダー順の1行へ変換する', () => {
  const now = new Date('2026-07-24T01:00:00.000Z');
  const context = g.buildSyncLedgerContext({
    operationId: 'op-1',
    triggerType: 'WEBHOOK',
    status: g.SYNC_LEDGER_STATUS.SUCCEEDED,
    stage: 'COMPLETE',
    appId: '20',
    recordId: '1001',
    revision: '7',
    listSheetName: '名古屋-一般住宅',
    domainSheetName: '【一般住宅】名古屋',
    startedAt: '2026-07-24T00:59:59.000Z',
    elapsedMs: 1000,
    changedCells: 42,
    details: { blocks: 12 },
    customerName: '顧客花子',
  }, now);
  const row = g.buildSyncLedgerRow(context);
  const at = (name) => row[g.SYNC_LEDGER_HEADERS.indexOf(name)];

  assert.equal(row.length, g.SYNC_LEDGER_HEADERS.length);
  assert.equal(at('sourceKey'), '20:1001');
  assert.equal(at('status'), 'SUCCEEDED');
  assert.equal(at('elapsedMs'), 1000);
  assert.equal(at('changedCells'), 42);
  assert.equal(at('details'), '{"blocks":12}');
  assert.equal(at('customerName'), '顧客花子');
});

test('同期ログ: 数式として解釈され得る文字列をセルで無害化する', () => {
  const context = g.buildSyncLedgerContext({
    operationId: '=IMPORTXML("bad")',
    status: 'FAILED',
    stage: '+danger',
  }, '2026-07-24T01:00:00.000Z');
  const row = g.buildSyncLedgerRow(context);
  const at = (name) => row[g.SYNC_LEDGER_HEADERS.indexOf(name)];

  assert.equal(at('operationId'), '\'=IMPORTXML("bad")');
  assert.equal(at('stage'), '\'+danger');
});

test('同期ログ: sourceKeyごとの最大SUCCEEDED revisionだけを返す', () => {
  const H = g.SYNC_LEDGER_HEADERS;
  const makeRow = ({ sourceKey, status, revision }) => {
    const row = new Array(H.length).fill('');
    row[H.indexOf('sourceKey')] = sourceKey;
    row[H.indexOf('status')] = status;
    row[H.indexOf('revision')] = revision;
    return row;
  };
  const rows = [
    H,
    makeRow({ sourceKey: '20:1001', status: 'STARTED', revision: '9' }),
    makeRow({ sourceKey: '20:1001', status: 'SUCCEEDED', revision: '7' }),
    makeRow({ sourceKey: '20:1001', status: 'FAILED', revision: '8' }),
    makeRow({ sourceKey: '20:1001', status: 'SUCCEEDED', revision: '10' }),
    makeRow({ sourceKey: '27:1001', status: 'SUCCEEDED', revision: '99' }),
  ];

  assert.equal(g.findLatestSuccessfulRevision(rows, '20:1001'), 10);
  assert.equal(g.findLatestSuccessfulRevision(rows, '20:9999'), null);
});

test('同期ログ: 最新成功revisionのtargetと顧客名を返す', () => {
  const H = g.SYNC_LEDGER_HEADERS;
  const makeRow = ({
    sourceKey,
    status,
    revision,
    customerName,
    listSheetName,
    domainSheetName,
  }) => {
    const row = new Array(H.length).fill('');
    row[H.indexOf('sourceKey')] = sourceKey;
    row[H.indexOf('status')] = status;
    row[H.indexOf('revision')] = revision;
    row[H.indexOf('customerName')] = customerName;
    row[H.indexOf('listSheetName')] = listSheetName;
    row[H.indexOf('domainSheetName')] = domainSheetName;
    return row;
  };
  const rows = [
    H,
    makeRow({
      sourceKey: '20:1001',
      status: 'SUCCEEDED',
      revision: '7',
      customerName: '旧名',
      listSheetName: '名古屋-一般住宅',
      domainSheetName: '【一般住宅】名古屋',
    }),
    makeRow({
      sourceKey: '20:1001',
      status: 'FAILED',
      revision: '9',
      customerName: '失敗名',
      listSheetName: '東京-一般住宅',
      domainSheetName: '【一般住宅】東京',
    }),
    makeRow({
      sourceKey: '20:1001',
      status: 'SUCCEEDED',
      revision: '8',
      customerName: '現名',
      listSheetName: '名古屋-一般住宅',
      domainSheetName: '【一般住宅】名古屋',
    }),
  ];

  assert.deepEqual(g.findLatestSuccessfulEventState(rows, '20:1001'), {
    revision: 8,
    customerName: '現名',
    listSheetName: '名古屋-一般住宅',
    domainSheetName: '【一般住宅】名古屋',
  });
});

test('同期ログ: 循環参照をJSON-safeな値へ変換する', () => {
  const input = { name: 'root' };
  input.self = input;
  assert.deepEqual(g.toSyncLedgerJsonSafe(input), {
    name: 'root',
    self: '[Circular]',
  });
});

test('同期ログ: 旧24列ヘッダーへcustomerNameを末尾追加し既存行を保持する', () => {
  const oldHeaders = g.SYNC_LEDGER_HEADERS.slice(0, -1);
  assert.equal(oldHeaders.length, 24);

  const legacyRow = oldHeaders.map((header) => `legacy-${header}`);
  const sheet = new StatefulSheet(
    '_SYNC_EVENTS',
    [oldHeaders, legacyRow],
    { maxColumns: oldHeaders.length },
  );
  const spreadsheet = new StatefulSpreadsheet([sheet]);

  g.recordSyncEvent({
    operationId: 'op-migration',
    status: g.SYNC_LEDGER_STATUS.SUCCEEDED,
    stage: 'COMPLETE',
    appId: '20',
    recordId: '1001',
    revision: '7',
    customerName: '顧客花子',
  }, spreadsheet);

  assert.deepEqual(
    sheet.grid[0].slice(0, g.SYNC_LEDGER_HEADERS.length),
    g.SYNC_LEDGER_HEADERS,
  );
  assert.deepEqual(sheet.grid[1], legacyRow, '既存ログ行を変更しない');
  assert.equal(sheet.getLastRow(), 3);
  assert.equal(
    sheet.valueAt(3, g.SYNC_LEDGER_HEADERS.indexOf('customerName') + 1),
    '顧客花子',
  );
});
