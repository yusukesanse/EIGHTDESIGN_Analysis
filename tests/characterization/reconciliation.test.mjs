import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from '../harness/loadGas.mjs';

const g = loadGas();

function row(customerName, valuesByColumn = {}) {
  const values = new Array(12).fill('');
  values[5] = customerName;
  for (const [column, value] of Object.entries(valuesByColumn)) {
    values[Number(column) - 1] = value;
  }
  return values;
}

function expected(recordId, customerName, ownedCells) {
  return {
    sourceKey: `20:${recordId}`,
    appId: '20',
    recordId: String(recordId),
    revision: '1',
    customerName,
    listSheetName: '名古屋-一般住宅',
    ownedCells,
  };
}

test('Kintone照合: 18一覧横断で正常・欠落・同名複数・誤配置・所有列不一致・余剰を区別する', () => {
  const expectedRecords = [
    expected(1, '一致顧客', [{ col: 3, value: 'A' }]),
    expected(2, '欠落顧客', [{ col: 3, value: 'B-A' }]),
    expected(3, '同名顧客', [{ col: 3, value: 'C' }]),
    expected(4, '更新待ち顧客', [
      { col: 3, value: 'A' },
      { col: 11, value: '新担当' },
    ]),
    expected(5, '誤配置顧客', [{ col: 3, value: 'B-B' }]),
  ];
  const listSnapshots = {
    '名古屋-一般住宅': [
      row('お客様名'),
      row('一致顧客', { 3: 'A' }),
      row('同名顧客', { 3: 'C' }),
      row('更新待ち顧客', { 3: 'B', 11: '旧担当' }),
      row('一覧だけの顧客', { 3: 'D' }),
    ],
    '東京-一般住宅': [
      row('お客様名'),
      row('同名顧客', { 3: 'C' }),
      row('誤配置顧客', { 3: 'B-B' }),
    ],
  };
  const before = structuredClone(listSnapshots);

  const result = g.computeKintoneListDiffs(expectedRecords, listSnapshots);

  assert.deepEqual(result.counts, {
    accurate: 1,
    missingInSheet: 1,
    ambiguousLegacyMatch: 1,
    wrongTarget: 1,
    staleFields: 1,
    unexpectedSheetRows: 1,
  });
  assert.deepEqual(
    result.findings.map((finding) => finding.category),
    [
      g.RECON_DIFF_TYPES.MISSING,
      g.RECON_DIFF_TYPES.AMBIGUOUS,
      g.RECON_DIFF_TYPES.STALE,
      g.RECON_DIFF_TYPES.WRONG_TARGET,
      g.RECON_DIFF_TYPES.UNEXPECTED,
    ],
  );
  assert.deepEqual(result.findings[1].actualLocations, [
    { sheetName: '名古屋-一般住宅', rowNumber: 3 },
    { sheetName: '東京-一般住宅', rowNumber: 2 },
  ]);
  assert.deepEqual(result.findings[2].differingColumns, [3, 11]);
  assert.deepEqual(result.findings[3].actualLocations, [
    { sheetName: '東京-一般住宅', rowNumber: 3 },
  ]);
  assert.equal(result.findings[4].sourceKey, '');
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.findings[2], 'customerName'),
    false,
    '差分台帳へ顧客名を保持しない',
  );
  assert.deepEqual(listSnapshots, before, '入力スナップショットを変更しない');
});

test('Kintone照合: sourceKey重複と対象シート欠落は判定を継続せず例外にする', () => {
  const duplicate = expected(10, '顧客A', []);
  assert.throws(
    () => g.computeKintoneListDiffs(
      [duplicate, { ...duplicate, customerName: '顧客B' }],
      { '名古屋-一般住宅': [] },
    ),
    /sourceKeyの重複/,
  );

  assert.throws(
    () => g.computeKintoneListDiffs(
      [expected(11, '顧客C', [])],
      {},
    ),
    /一覧スナップショットがありません/,
  );
});

test('Kintone照合: 同一アプリ内の同名原本は一覧が1行でも正確扱いにしない', () => {
  const listSnapshots = {
    '名古屋-一般住宅': [
      row('お客様名'),
      row('原本重複顧客', { 3: 'A' }),
    ],
  };
  const result = g.computeKintoneListDiffs([
    expected(21, '原本重複顧客', [{ col: 3, value: 'A' }]),
    expected(22, '原本重複顧客', [{ col: 3, value: 'A' }]),
  ], listSnapshots);

  assert.deepEqual(result.counts, {
    accurate: 0,
    missingInSheet: 0,
    ambiguousLegacyMatch: 2,
    wrongTarget: 0,
    staleFields: 0,
    unexpectedSheetRows: 0,
  });
  assert.equal(
    result.findings.every(
      finding => finding.category === g.RECON_DIFF_TYPES.AMBIGUOUS
    ),
    true,
  );
  assert.match(result.findings[0].note, /同一Kintoneアプリに同名レコード/);
});

test('Kintone照合: 2アプリ各1件の同名原本は同じ一覧行の補完として照合する', () => {
  const customer = expected(
    31,
    'アプリ補完顧客',
    [{ col: 3, value: 'A' }],
  );
  const sales = {
    ...expected(
      41,
      'アプリ補完顧客',
      [{ col: 11, value: '田中' }],
    ),
    sourceKey: '27:41',
    appId: '27',
  };
  const result = g.computeKintoneListDiffs(
    [customer, sales],
    {
      '名古屋-一般住宅': [
        row('お客様名'),
        row('アプリ補完顧客', { 3: 'A', 11: '田中' }),
      ],
    },
  );

  assert.equal(result.counts.accurate, 2);
  assert.equal(result.counts.ambiguousLegacyMatch, 0);
  assert.deepEqual(result.findings, []);
});

test('Kintone取得: 500件境界をIDページングし、offsetを使わない', () => {
  const calls = [];
  const firstPage = Array.from({ length: 500 }, (_, index) => ({
    $id: { value: String(index + 1) },
  }));
  const gas = loadGas({
    platformOverrides: {
      UrlFetchApp: {
        fetch(url) {
          calls.push(url);
          const query = new URL(url).searchParams.get('query');
          const afterId = Number(query.match(/\$id > (\d+)/)[1]);
          const records = afterId === 0
            ? firstPage
            : (afterId === 500 ? [{ $id: { value: '501' } }] : []);
          return {
            getResponseCode: () => 200,
            getContentText: () => JSON.stringify({ records }),
          };
        },
      },
    },
  });

  const records = gas._reconFetchAllRecords(
    'https://example.cybozu.com',
    '20',
    'SECRET_NOT_LOGGED',
  );

  assert.equal(records.length, 501);
  assert.equal(calls.length, 2);
  for (const url of calls) {
    const query = new URL(url).searchParams.get('query');
    assert.match(query, /^\$id > \d+ order by \$id asc limit 500$/);
    assert.doesNotMatch(query, /offset/i);
    assert.doesNotMatch(url, /SECRET_NOT_LOGGED/);
  }
});
