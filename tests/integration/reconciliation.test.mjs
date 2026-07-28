import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from '../harness/loadGas.mjs';
import {
  StatefulSheet,
  StatefulSpreadsheet,
  makeStatefulGasPlatform,
} from '../harness/statefulSpreadsheet.mjs';

const LEGACY_DIFF_HEADERS = [
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
];

function makeEnvironment(diffGrid) {
  const events = [];
  const names = loadGas();
  const listSheets = [];
  for (const area of names.AGG_AREAS) {
    for (const domain of names.AGG_DOMAINS) {
      listSheets.push(new StatefulSheet(
        names.buildListSheetName(area, domain.type),
        [['反響年', '反響月', '', '', '', 'お客様名']],
        { events },
      ));
    }
  }
  if (diffGrid !== undefined) {
    listSheets.push(new StatefulSheet(
      '_SYNC_DIFFS',
      diffGrid,
      { events },
    ));
  }
  const spreadsheet = new StatefulSpreadsheet(listSheets, { events });
  const platform = makeStatefulGasPlatform(spreadsheet, { events });
  const fetchCalls = [];
  const gas = loadGas({
    scriptProps: {
      KINTONE_BASE_URL: 'https://example.cybozu.com',
      KINTONE_CUSTOMER_API_TOKEN: 'CUSTOMER_SECRET',
      KINTONE_SALES_API_TOKEN: 'SALES_SECRET',
    },
    platformOverrides: {
      ...platform.platformOverrides,
      UrlFetchApp: {
        fetch(url, options) {
          fetchCalls.push({ url, options });
          return {
            getResponseCode: () => 200,
            getContentText: () => JSON.stringify({ records: [] }),
          };
        },
      },
    },
  });

  return { events, fetchCalls, gas, listSheets, spreadsheet };
}

test('Kintone照合統合: 18一覧を読み、修復せず_SYNC_DIFFSへ結果を一括記録する', () => {
  const {
    events,
    fetchCalls,
    gas,
    listSheets,
    spreadsheet,
  } = makeEnvironment();
  const before = new Map(
    listSheets.map((sheet) => [sheet.getName(), structuredClone(sheet.grid)]),
  );

  const result = gas.runKintoneReconciliationDryRun();

  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.dryRun, true);
  assert.equal(result.sourceRecords, 0);
  assert.equal(result.listSheets, 18);
  assert.equal(result.findings, 0);
  assert.equal(result.deleteCandidatesEmitted, 0);
  assert.equal(fetchCalls.length, 2);
  assert.deepEqual(
    fetchCalls.map(({ url }) => new URL(url).searchParams.get('app')),
    ['20', '27'],
  );
  assert.equal(
    fetchCalls.some(({ url }) => /CUSTOMER_SECRET|SALES_SECRET/.test(url)),
    false,
    'APIトークンをURLへ含めない',
  );

  for (const sheet of listSheets) {
    assert.deepEqual(sheet.grid, before.get(sheet.getName()), '一覧を修復しない');
  }

  assert.ok(events.includes('lock-released'));
  const diffSheet = spreadsheet.getSheetByName('_SYNC_DIFFS');
  assert.ok(diffSheet);
  assert.deepEqual(
    diffSheet.grid[0].slice(0, gas.RECON_DIFF_HEADERS.length),
    gas.RECON_DIFF_HEADERS,
  );
  assert.equal(diffSheet.valueAt(2, 3), 'RUN_SUMMARY');
});

test('Kintone照合統合: 旧11列_SYNC_DIFFSを末尾拡張し、旧行を保持して新行を追記する', () => {
  const legacyRow = [
    'legacy-run',
    '2026-07-23 10:00:00',
    'STALE_FIELDS',
    '20:123',
    '20',
    '123',
    '4',
    '名古屋-一般住宅',
    '8',
    '3,11',
    '旧形式の記録',
  ];
  const { gas, spreadsheet } = makeEnvironment([
    LEGACY_DIFF_HEADERS,
    legacyRow,
  ]);
  const diffSheet = spreadsheet.getSheetByName('_SYNC_DIFFS');
  const beforeLegacyRow = structuredClone(diffSheet.grid[1]);

  const result = gas.runKintoneReconciliationDryRun();

  assert.equal(result.status, 'SUCCESS');
  assert.deepEqual(
    gas.RECON_DIFF_HEADERS,
    [...LEGACY_DIFF_HEADERS, 'actualLocations'],
    '旧11列の順序を維持して新列を末尾へ追加する',
  );
  assert.deepEqual(
    diffSheet.grid[0].slice(0, 12),
    gas.RECON_DIFF_HEADERS,
  );
  assert.deepEqual(
    diffSheet.grid[1].slice(0, 11),
    beforeLegacyRow,
    '旧データ行を書き換えない',
  );
  assert.equal(diffSheet.valueAt(2, 12), '');
  assert.equal(diffSheet.valueAt(3, 3), 'RUN_SUMMARY');
  assert.match(diffSheet.valueAt(3, 11), /"dryRun":true/);
  assert.equal(diffSheet.valueAt(3, 12), '');
});

test('Kintone照合統合: _SYNC_DIFFSのヘッダー不一致と未知の余分列は追記せず失敗する', () => {
  const invalidCases = [
    {
      label: 'ヘッダー不一致',
      grid: [[
        ...LEGACY_DIFF_HEADERS.slice(0, 9),
        'unexpectedHeader',
        'note',
      ]],
      expected: /ヘッダーが想定と一致しない/,
    },
    {
      label: '未知の余分列',
      grid: [[
        ...LEGACY_DIFF_HEADERS,
        'actualLocations',
        'unknownColumn',
      ]],
      expected: /ヘッダーが想定と一致しない/,
    },
  ];

  for (const { label, grid, expected } of invalidCases) {
    const { gas, spreadsheet } = makeEnvironment(grid);
    const diffSheet = spreadsheet.getSheetByName('_SYNC_DIFFS');
    const before = structuredClone(diffSheet.grid);

    assert.throws(
      () => gas.runKintoneReconciliationDryRun(),
      expected,
      label,
    );
    assert.deepEqual(diffSheet.grid, before, `${label}では追記しない`);
  }
});
