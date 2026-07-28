import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from '../harness/loadGas.mjs';
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

function makeEmptyListGrid() {
  const header = Array.from({ length: 37 }, (_, index) => `列${index + 1}`);
  header[0] = '反響年';
  header[1] = '反響月';
  header[5] = 'お客様名';
  return [header];
}

function makeEnvironment({
  missingDomainSheet = '',
  failSetValues,
} = {}) {
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

  const spreadsheet = new StatefulSpreadsheet(sheets, {
    events,
    failSetValues,
  });
  if (missingDomainSheet) spreadsheet.sheets.delete(missingDomainSheet);

  const platform = makeStatefulGasPlatform(spreadsheet, { events });
  const gas = loadGas({ platformOverrides: platform.platformOverrides });
  return { events, spreadsheet, gas };
}

function ledgerStatus(values) {
  return values?.[0]?.[3];
}

test('個別全面再集計: 公開関数は1組の読込・書込・検証をScriptLock内で行う', () => {
  const env = makeEnvironment();
  const result = env.gas.runDomainAggregationForSheet('一般住宅', '名古屋');

  assert.equal(result.success, true);
  assert.equal(result.listSheetName, '名古屋-一般住宅');
  assert.equal(result.domainSheetName, '【一般住宅】名古屋');
  assert.equal(
    env.events.filter((event) => event === 'lock-acquired').length,
    1,
  );
  assert.equal(
    env.events.filter((event) => event === 'lock-released').length,
    1,
  );
});

test('定期集計ログ障害: STARTEDログ失敗なら18組を開始せずLOG_STARTでthrowする', () => {
  const env = makeEnvironment({
    failSetValues: ({ sheetName, values }) =>
      sheetName === '_SYNC_JOBS' && ledgerStatus(values) === 'STARTED',
  });

  let thrown;
  try {
    env.gas.runDomainAggregation();
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, 'STARTEDログ障害を成功扱いにしない');
  assert.equal(thrown.stage, 'LOG_START');
  assert.equal(
    env.events.some((event) => event.startsWith('read:名古屋-一般住宅:')),
    false,
    '1組目の一覧読込にも進まない',
  );
  assert.equal(
    env.events.filter((event) => event === 'spreadsheet-flush').length,
    0,
  );

  const jobs = env.spreadsheet.getSheetByName('_SYNC_JOBS');
  const statusCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('status') + 1;
  const stageCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('stage') + 1;
  assert.equal(jobs.valueAt(jobs.getLastRow(), statusCol), 'FAILED');
  assert.equal(jobs.valueAt(jobs.getLastRow(), stageCol), 'LOG_START');
});

test('定期集計ログ障害: 全18組成功後の終了ログ失敗はLOG_COMPLETEでthrowする', () => {
  const env = makeEnvironment({
    failSetValues: ({ sheetName, values }) =>
      sheetName === '_SYNC_JOBS' && ledgerStatus(values) === 'SUCCEEDED',
  });

  let thrown;
  try {
    env.gas.runDomainAggregation();
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, '終了ログ障害を成功結果として返さない');
  assert.equal(thrown.stage, 'LOG_COMPLETE');
  assert.equal(
    env.events.filter((event) => event === 'spreadsheet-flush').length,
    18,
    '18組の集計・検証完了後に終了ログで失敗する',
  );

  const jobs = env.spreadsheet.getSheetByName('_SYNC_JOBS');
  const statusCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('status') + 1;
  const stageCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('stage') + 1;
  assert.equal(jobs.valueAt(jobs.getLastRow(), statusCol), 'FAILED');
  assert.equal(jobs.valueAt(jobs.getLastRow(), stageCol), 'LOG_COMPLETE');
});

test('定期集計ログ障害: 集計失敗と終了ログ失敗が重なってもBatchErrorを保持する', () => {
  let terminalLogFailed = false;
  const env = makeEnvironment({
    missingDomainSheet: '【一般住宅】名古屋',
    failSetValues: ({ sheetName, values }) => {
      if (
        !terminalLogFailed
        && sheetName === '_SYNC_JOBS'
        && ledgerStatus(values) === 'PARTIAL_FAILURE'
      ) {
        terminalLogFailed = true;
        return true;
      }
      return false;
    },
  });

  let thrown;
  try {
    env.gas.runDomainAggregation();
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown);
  assert.equal(terminalLogFailed, true, '終了ログ障害を注入した');
  assert.equal(thrown.name, 'DomainAggregationBatchError');
  assert.equal(thrown.stage, 'BATCH_COMPLETE');
  assert.equal(thrown.aggregationSummary.failed, 1);
  assert.equal(thrown.ledgerError?.stage, 'LOG_COMPLETE');
  assert.match(thrown.ledgerError?.message ?? '', /forced setValues failure/);

  const jobs = env.spreadsheet.getSheetByName('_SYNC_JOBS');
  const statusCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('status') + 1;
  const stageCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('stage') + 1;
  const errorCol = env.gas.SYNC_LEDGER_HEADERS.indexOf('error') + 1;
  assert.equal(jobs.valueAt(jobs.getLastRow(), statusCol), 'PARTIAL_FAILURE');
  assert.equal(jobs.valueAt(jobs.getLastRow(), stageCol), 'LOG_COMPLETE');
  assert.match(
    jobs.valueAt(jobs.getLastRow(), errorCol),
    /DomainAggregationBatchError/,
  );
});
