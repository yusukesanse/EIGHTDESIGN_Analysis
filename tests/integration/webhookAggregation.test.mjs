import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas, CORE_FILES, MANUAL_RUNNER_FILES } from '../harness/loadGas.mjs';
import {
  StatefulSheet,
  StatefulSpreadsheet,
  makeStatefulGasPlatform,
} from '../harness/statefulSpreadsheet.mjs';

function makeGrid(rows = 520, cols = 30) {
  return Array.from({ length: rows }, () => new Array(cols).fill(''));
}

function setCell(grid, row, col, value) {
  grid[row - 1][col - 1] = value;
}

function makeResidentialDomainGrid() {
  const grid = makeGrid();
  setCell(grid, 1, 2, '2026年');
  for (const headerRow of [34, 69, 229, 285, 341, 471]) {
    setCell(grid, headerRow, 2, '2025年');
    setCell(grid, headerRow, 3, '2026年');
  }
  setCell(grid, 107, 1, '2026年');
  setCell(grid, 107, 2, '田中');
  setCell(grid, 107, 3, 'その他');
  setCell(grid, 107, 4, '合計');

  setCell(grid, 182, 12, '2026年');
  setCell(grid, 182, 13, '理由総数');
  setCell(grid, 182, 14, '田中');
  setCell(grid, 183, 12, '他社');
  setCell(grid, 184, 12, '予算乖離');
  setCell(grid, 185, 12, '合計');

  for (const headerRow of [229, 285]) {
    setCell(grid, headerRow + 1, 1, '検索');
    setCell(grid, headerRow + 2, 1, 'その他');
    setCell(grid, headerRow + 3, 1, '合計');
  }
  for (const headerRow of [341, 471]) {
    setCell(grid, headerRow + 1, 1, '名古屋市中区');
    setCell(grid, headerRow + 2, 1, '愛知県');
    setCell(grid, headerRow + 3, 1, '合計');
  }
  // 問い合わせニーズ（実シートどおり 177/185/193 がヘッダー、B〜が種別、末尾が計）
  for (const [needsHeaderRow, needsLabel] of [[177, '一次取得'], [185, '持家'], [193, '実家など']]) {
    setCell(grid, needsHeaderRow, 1, needsLabel);
    ['相談会', '個別相談', '外部相談会', '見学会', '資料請求', '計']
      .forEach((name, index) => setCell(grid, needsHeaderRow, 2 + index, name));
  }
  return grid;
}

function makeBusinessDomainGrid() {
  const grid = makeGrid();
  setCell(grid, 1, 2, '2026年');
  for (const headerRow of [34, 69, 229, 285, 341, 471]) {
    setCell(grid, headerRow, 2, '2026年');
  }
  setCell(grid, 107, 1, '2026年');
  setCell(grid, 107, 2, '田中');
  setCell(grid, 107, 3, '計');

  setCell(grid, 120, 1, '2026年');
  setCell(grid, 120, 2, '零細企業');
  setCell(grid, 120, 3, '不明');
  setCell(grid, 120, 4, '計');
  setCell(grid, 121, 1, '飲食');
  setCell(grid, 122, 1, '不明');
  setCell(grid, 123, 1, '計');

  setCell(grid, 144, 1, '2026年');
  setCell(grid, 144, 2, '零細企業');
  setCell(grid, 144, 3, '不明');
  setCell(grid, 144, 4, '計');
  setCell(grid, 145, 1, '代表者');
  setCell(grid, 146, 1, '不明');
  setCell(grid, 147, 1, '計');

  setCell(grid, 154, 1, '2026年');
  setCell(grid, 154, 2, '独立');
  setCell(grid, 154, 3, '既存店舗');
  setCell(grid, 154, 4, '新店舗');
  setCell(grid, 154, 5, '合計');
  setCell(grid, 155, 1, '飲食');
  setCell(grid, 156, 1, '不明');
  setCell(grid, 157, 1, '計');
  setCell(grid, 154, 12, '集客イベント');
  setCell(grid, 154, 13, '相談会');
  setCell(grid, 154, 14, '計');

  setCell(grid, 176, 1, '2026年');
  setCell(grid, 176, 2, '独立');
  setCell(grid, 176, 3, '既存店舗');
  setCell(grid, 176, 4, '新店舗');
  setCell(grid, 176, 5, '合計');
  setCell(grid, 177, 1, '飲食');
  setCell(grid, 178, 1, '不明');
  setCell(grid, 179, 1, '計');

  for (const headerRow of [229, 285]) {
    setCell(grid, headerRow + 1, 1, '検索');
    setCell(grid, headerRow + 2, 1, '合計');
  }
  for (const headerRow of [341, 471]) {
    setCell(grid, headerRow + 1, 1, '名古屋市中区');
    setCell(grid, headerRow + 2, 1, '合計');
  }
  return grid;
}

function makeListGrid() {
  const header = Array.from({ length: 37 }, (_, index) => `列${index + 1}`);
  header[0] = '反響年';
  header[1] = '反響月';
  header[5] = 'お客様名';

  const row = new Array(37).fill('');
  row[0] = '2026年';
  row[1] = '1月';
  row[2] = 'C';
  row[3] = '長期追客';
  row[5] = '顧客花子';
  row[8] = '検索';
  row[10] = '田中';
  row[17] = '愛知県';
  row[18] = '名古屋市中区';
  return [header, row];
}

function makeEmptyListGrid() {
  return [makeListGrid()[0]];
}

function customerWebhook(
  type = 'UPDATE_RECORD',
  revision = '7',
  recordOverrides = {},
) {
  if (type === 'DELETE_RECORD') {
    return {
      postData: {
        contents: JSON.stringify({
          app: { id: 20 },
          type,
          recordId: '1001',
        }),
      },
    };
  }
  return {
    postData: {
      contents: JSON.stringify({
        app: { id: 20 },
        type,
        record: {
          $id: { value: '1001' },
          $revision: { value: revision },
          customer_type: { value: '注文住宅' },
          customer_name: { value: '顧客花子' },
          promotion_area: { value: '名古屋店' },
          inquiry_date: { value: '2026-01-10' },
          likehood_now: { value: '成約' },
          first_appoint: { value: '相談会' },
          information_route: { value: '検索' },
          manager: { value: [{ name: '田中' }] },
          age: { value: '30' },
          current_residence: { value: '賃貸' },
          family_member: { value: '3' },
          ...recordOverrides,
        },
      }),
    },
  };
}

function makeEnvironment({ includeDomain = true } = {}) {
  const events = [];
  const initialGas = loadGas();
  const targetListName = '名古屋-一般住宅';
  const listSheets = new Map();
  const sheets = [];
  for (const area of initialGas.AGG_AREAS) {
    for (const domain of initialGas.AGG_DOMAINS) {
      const listSheetName = initialGas.buildListSheetName(area, domain.type);
      const listSheet = new StatefulSheet(
        listSheetName,
        listSheetName === targetListName ? makeListGrid() : makeEmptyListGrid(),
        { events, maxColumns: 37 },
      );
      listSheets.set(listSheetName, listSheet);
      sheets.push(listSheet);
    }
  }
  const list = listSheets.get(targetListName);
  let domain = null;
  if (includeDomain) {
    domain = new StatefulSheet('【一般住宅】名古屋', makeResidentialDomainGrid(), {
      events,
      maxColumns: 30,
    });
    sheets.push(domain);
  }
  const spreadsheet = new StatefulSpreadsheet(sheets, { events });
  const platform = makeStatefulGasPlatform(spreadsheet, { events });
  const gas = loadGas({ platformOverrides: platform.platformOverrides });
  return { gas, events, spreadsheet, listSheets, list, domain };
}

test('Webhook統合: 一覧更新後に同じ1組を再読込・全面再集計してから成功を返す', () => {
  const env = makeEnvironment();
  const response = env.gas.handleWebhook(customerWebhook());
  const body = JSON.parse(response.getContent());

  assert.equal(body.result, 'success');
  assert.equal(body.listSheet, '名古屋-一般住宅');
  assert.equal(body.domainSheet, '【一般住宅】名古屋');
  assert.equal(env.list.valueAt(2, 3), 'A', '一覧のランクを先に更新');
  assert.equal(env.domain.valueAt(39, 3), 1, '更新後一覧から2026年の成約数を再計算');

  const firstFlush = env.events.indexOf('spreadsheet-flush');
  const listReads = env.events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.startsWith('read:名古屋-一般住宅:'));
  const listWrite = env.events.findIndex(
    (event) => event.startsWith('write:名古屋-一般住宅:')
  );
  assert.ok(
    listReads.some(({ index }) => index < listWrite),
    'identity確認・更新計画用の一覧読込後に書き込む'
  );
  assert.ok(listWrite < firstFlush, '一覧書込後にflushする');
  assert.ok(
    listReads.some(({ index }) => index > firstFlush),
    'flush後に集計用一覧を再読込する'
  );
  assert.equal(env.events.at(-1), 'lock-released');

  const ledger = env.spreadsheet.getSheetByName('_SYNC_EVENTS');
  const statusCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('status') + 1;
  const domainCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('domainSheetName') + 1;
  assert.equal(ledger.valueAt(2, statusCol), 'STARTED');
  assert.equal(ledger.valueAt(3, statusCol), 'SUCCEEDED');
  assert.equal(ledger.valueAt(3, domainCol), '【一般住宅】名古屋');
});

test('Webhook統合: 同じ成功revisionの再送は一覧・集計を書き換えない', () => {
  const env = makeEnvironment();
  env.gas.handleWebhook(customerWebhook());
  const domainWritesBefore = env.events.filter(
    (event) => event.startsWith('write:【一般住宅】名古屋:')
  ).length;

  const response = env.gas.handleWebhook(customerWebhook());
  const body = JSON.parse(response.getContent());
  const domainWritesAfter = env.events.filter(
    (event) => event.startsWith('write:【一般住宅】名古屋:')
  ).length;

  assert.equal(body.result, 'success');
  assert.equal(body.duplicate, true);
  assert.equal(domainWritesAfter, domainWritesBefore);
  const ledger = env.spreadsheet.getSheetByName('_SYNC_EVENTS');
  const statusCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('status') + 1;
  assert.equal(ledger.valueAt(ledger.getLastRow(), statusCol), 'SKIPPED_DUPLICATE');
});

test('Webhook統合: 安定ID移行前のtarget変更は二重登録せずFAILEDにする', () => {
  const env = makeEnvironment();
  env.gas.handleWebhook(customerWebhook());
  const before = env.list.grid.map((row) => row.slice());

  assert.throws(
    () => env.gas.handleWebhook(customerWebhook(
      'UPDATE_RECORD',
      '8',
      { promotion_area: { value: '東京' } },
    )),
    /安定ID未導入/
  );
  assert.deepEqual(env.list.grid, before, '旧一覧も新一覧も変更しない');

  const ledger = env.spreadsheet.getSheetByName('_SYNC_EVENTS');
  const statusCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('status') + 1;
  const stageCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('stage') + 1;
  assert.equal(ledger.valueAt(ledger.getLastRow(), statusCol), 'FAILED');
  assert.equal(ledger.valueAt(ledger.getLastRow(), stageCol), 'IDENTITY_CHECK');
});

test('Webhook統合: 同じtarget内に同名行が複数ある場合はIDENTITY_CHECKでFAILEDにして一覧を変更しない', () => {
  const env = makeEnvironment();
  env.list.grid.push(env.list.grid[1].slice());
  const before = env.list.grid.map((row) => row.slice());

  assert.throws(
    () => env.gas.handleWebhook(customerWebhook()),
    /同名行が複数/
  );
  assert.deepEqual(env.list.grid, before, '同名複数行を更新しない');

  const ledger = env.spreadsheet.getSheetByName('_SYNC_EVENTS');
  const statusCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('status') + 1;
  const stageCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('stage') + 1;
  assert.equal(ledger.valueAt(ledger.getLastRow(), statusCol), 'FAILED');
  assert.equal(ledger.valueAt(ledger.getLastRow(), stageCol), 'IDENTITY_CHECK');
});

test('Webhook統合: 初回sourceKeyでも別targetに同名行がある場合はIDENTITY_CHECKでFAILEDにして一覧を変更しない', () => {
  const env = makeEnvironment();
  const customerRow = env.list.grid[1].slice();
  env.list.grid.splice(1, 1);
  const wrongTarget = env.listSheets.get('東京-一般住宅');
  wrongTarget.grid.push(customerRow);
  const targetBefore = env.list.grid.map((row) => row.slice());
  const wrongTargetBefore = wrongTarget.grid.map((row) => row.slice());

  assert.throws(
    () => env.gas.handleWebhook(customerWebhook()),
    /targetとは別の一覧に同名行/
  );
  assert.deepEqual(env.list.grid, targetBefore, '期待targetへ行を追加しない');
  assert.deepEqual(wrongTarget.grid, wrongTargetBefore, '誤配置行も変更しない');

  const ledger = env.spreadsheet.getSheetByName('_SYNC_EVENTS');
  const statusCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('status') + 1;
  const stageCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('stage') + 1;
  assert.equal(ledger.valueAt(ledger.getLastRow(), statusCol), 'FAILED');
  assert.equal(ledger.valueAt(ledger.getLastRow(), stageCol), 'IDENTITY_CHECK');
});

test('Webhook統合: 旧成功ログのcustomerNameが空なら同一targetに1件あってもIDENTITY_CHECKでFAILEDにする', () => {
  const env = makeEnvironment();
  env.gas.handleWebhook(customerWebhook());
  const ledger = env.spreadsheet.getSheetByName('_SYNC_EVENTS');
  const customerNameCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('customerName') + 1;
  const statusCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('status') + 1;
  const succeededRow = Array.from(
    { length: ledger.getLastRow() },
    (_, index) => index + 1,
  ).find(
    (row) => ledger.valueAt(row, statusCol) === 'SUCCEEDED'
  );
  assert.ok(succeededRow, '事前条件として成功ログがある');
  ledger.setValueAt(succeededRow, customerNameCol, '');
  const before = env.list.grid.map((row) => row.slice());

  assert.throws(
    () => env.gas.handleWebhook(customerWebhook('UPDATE_RECORD', '8')),
    /旧同期ログに顧客名がなく/
  );
  assert.deepEqual(env.list.grid, before, '旧ログを安全に識別できないため更新しない');

  const stageCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('stage') + 1;
  assert.equal(ledger.valueAt(ledger.getLastRow(), statusCol), 'FAILED');
  assert.equal(ledger.valueAt(ledger.getLastRow(), stageCol), 'IDENTITY_CHECK');
});

test('Webhook統合: 集計シート欠落時はFAILEDを記録して例外を再送出する', () => {
  const env = makeEnvironment({ includeDomain: false });

  assert.throws(
    () => env.gas.handleWebhook(customerWebhook()),
    /集計シートが見つかりません/
  );
  assert.equal(env.events.at(-1), 'lock-released');

  const ledger = env.spreadsheet.getSheetByName('_SYNC_EVENTS');
  const statusCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('status') + 1;
  const stageCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('stage') + 1;
  assert.equal(ledger.valueAt(ledger.getLastRow(), statusCol), 'FAILED');
  assert.equal(ledger.valueAt(ledger.getLastRow(), stageCol), 'AGGREGATE');
});

test('Webhook統合: DELETE_RECORDは一覧を変更せずFAILEDにする', () => {
  const env = makeEnvironment();
  const before = env.list.grid.map((row) => row.slice());

  assert.throws(
    () => env.gas.handleWebhook(customerWebhook('DELETE_RECORD')),
    /削除Webhookは安全な行識別子が未導入/
  );
  assert.deepEqual(env.list.grid, before);
  assert.ok(env.events.includes('lock-acquired'), 'FAILEDログ追記だけをロックする');
  assert.equal(env.events.at(-1), 'lock-released');

  const ledger = env.spreadsheet.getSheetByName('_SYNC_EVENTS');
  const statusCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('status') + 1;
  const sourceKeyCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('sourceKey') + 1;
  const stageCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('stage') + 1;
  assert.equal(ledger.valueAt(ledger.getLastRow(), statusCol), 'FAILED');
  assert.equal(ledger.valueAt(ledger.getLastRow(), sourceKeyCol), '20:1001');
  assert.equal(ledger.valueAt(ledger.getLastRow(), stageCol), 'IDENTITY_CHECK');
});

function makeFullAggregationEnvironment({ missingDomainSheet = '', extraFiles = [] } = {}) {
  const events = [];
  const initialGas = loadGas();
  const sheets = [];
  for (const area of initialGas.AGG_AREAS) {
    for (const domain of initialGas.AGG_DOMAINS) {
      sheets.push(new StatefulSheet(
        initialGas.buildListSheetName(area, domain.type),
        makeEmptyListGrid(),
        { events, maxColumns: 37 },
      ));
      sheets.push(new StatefulSheet(
        initialGas.buildDomainSheetName(domain.type, area),
        domain.style === 'residential'
          ? makeResidentialDomainGrid()
          : makeBusinessDomainGrid(),
        { events, maxColumns: 30 },
      ));
    }
  }

  const spreadsheet = new StatefulSpreadsheet(sheets, { events });
  if (missingDomainSheet) spreadsheet.sheets.delete(missingDomainSheet);
  const platform = makeStatefulGasPlatform(spreadsheet, { events });
  const gas = loadGas({
    platformOverrides: platform.platformOverrides,
    files: extraFiles.length > 0 ? [...CORE_FILES, ...extraFiles] : undefined,
  });
  return { events, spreadsheet, gas };
}

test('定期集計統合: 18組すべてを同じ厳格経路で再計算しジョブ結果を記録する', () => {
  const { events, spreadsheet, gas } = makeFullAggregationEnvironment();
  const summary = gas.runDomainAggregation();

  assert.equal(summary.success, true);
  assert.equal(summary.total, 18);
  assert.equal(summary.succeeded, 18);
  assert.equal(summary.failed, 0);
  assert.equal(summary.results.every((result) => result.verifiedCells === result.cells), true);

  const jobs = spreadsheet.getSheetByName('_SYNC_JOBS');
  const statusCol = gas.SYNC_LEDGER_HEADERS.indexOf('status') + 1;
  assert.equal(jobs.valueAt(2, statusCol), 'STARTED');
  assert.equal(jobs.valueAt(3, statusCol), 'SUCCEEDED');
  assert.equal(events.filter((event) => event === 'lock-acquired').length, 20);
  assert.equal(events.filter((event) => event === 'lock-released').length, 20);
});

// ------------------------------------------------------------
// 全18枚集計テスト.gs（GASエディタから手で動かす確認用スクリプト）
// ------------------------------------------------------------

function makeManualRunnerEnvironment(options = {}) {
  return makeFullAggregationEnvironment({ ...options, extraFiles: MANUAL_RUNNER_FILES });
}

test('18枚点検: 書き込まずに18組すべてを点検して通る枚数を返す', () => {
  const { events, gas } = makeManualRunnerEnvironment();

  const report = gas.test18_check();

  assert.equal(report.total, 18);
  assert.equal(report.ok, 18);
  assert.equal(report.ng, 0);
  assert.equal(report.lines.length, 18);
  assert.equal(report.lines.every((line) => line.startsWith('✔')), true);
  assert.equal(
    events.some((event) => event.startsWith('write:')), false,
    '点検はシートへ一切書き込まない',
  );
});

test('18枚点検: 集計シートが無い組は✖として数え、他の組は点検を続ける', () => {
  const { events, gas } = makeManualRunnerEnvironment({
    missingDomainSheet: '【一般住宅】名古屋',
  });

  const report = gas.test18_check();

  assert.equal(report.ok, 17);
  assert.equal(report.ng, 1);
  const failure = report.lines.find((line) => line.startsWith('✖'));
  assert.match(failure, /【一般住宅】名古屋/);
  assert.match(failure, /シートが見つかりません/);
  assert.equal(events.some((event) => event.startsWith('write:')), false);
});

test('18枚再計算: 本番経路を通して18枚を書き込みサマリーを返す', () => {
  const { spreadsheet, gas } = makeManualRunnerEnvironment();

  const summary = gas.test18_run();

  assert.equal(summary.success, true);
  assert.equal(summary.total, 18);
  assert.equal(summary.succeeded, 18);
  assert.equal(summary.results.every((r) => r.verifiedCells === r.cells), true);

  const jobs = spreadsheet.getSheetByName('_SYNC_JOBS');
  const statusCol = gas.SYNC_LEDGER_HEADERS.indexOf('status') + 1;
  assert.equal(jobs.valueAt(jobs.getLastRow(), statusCol), 'SUCCEEDED');
});

test('18枚再計算: 1組失敗しても残りは書き込み、レポート後に例外を再送出する', () => {
  const { gas } = makeManualRunnerEnvironment({
    missingDomainSheet: '【一般住宅】名古屋',
  });

  let thrown;
  try {
    gas.test18_run();
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, '失敗を握りつぶさず再送出する');
  assert.equal(thrown.name, 'DomainAggregationBatchError');
  assert.equal(thrown.aggregationSummary.succeeded, 17);
  assert.equal(thrown.aggregationSummary.failed, 1);
});

test('定期集計統合: 1組失敗時は成功扱いにせず対象・段階をジョブログへ残す', () => {
  const missingDomainSheet = '【一般住宅】名古屋';
  const { spreadsheet, gas } = makeFullAggregationEnvironment({
    missingDomainSheet,
  });

  let thrown;
  try {
    gas.runDomainAggregation();
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown);
  assert.equal(thrown.name, 'DomainAggregationBatchError');
  assert.equal(thrown.aggregationSummary.success, false);
  assert.equal(thrown.aggregationSummary.failed, 1);
  const failure = thrown.aggregationSummary.results.find(result => !result.success);
  assert.equal(failure.targetSheet, missingDomainSheet);
  assert.equal(failure.stage, 'RESOLVE_SHEETS');

  const jobs = spreadsheet.getSheetByName('_SYNC_JOBS');
  const statusCol = gas.SYNC_LEDGER_HEADERS.indexOf('status') + 1;
  const detailsCol = gas.SYNC_LEDGER_HEADERS.indexOf('details') + 1;
  assert.equal(jobs.valueAt(jobs.getLastRow(), statusCol), 'PARTIAL_FAILURE');
  assert.match(jobs.valueAt(jobs.getLastRow(), detailsCol), /【一般住宅】名古屋/);
  assert.match(jobs.valueAt(jobs.getLastRow(), detailsCol), /RESOLVE_SHEETS/);
});
