// ============================================================
// realFixtureWebhook.test.mjs — GASエディタ用テストペイロードの統合テスト
// ------------------------------------------------------------
// 顧客管理テスト.gs / 営業進捗テスト.gs は、GASエディタから doPost() を
// 手動実行するための実データ由来のペイロード。この2ファイルを「そのまま」
// 読み込んで handleWebhook に流し、一覧書き込みからドメイン集計への反映
// までが通ることを固定する。
//
// 固定する不具合（2026-07-28）:
//   - likehood_now「面識なし」が RANK_MAP 未定義でランクが空になり、
//     一覧だけ書けて集計が「集計可能なランクではない」で失敗していた
//   - ペイロードに type が無く、対応イベント種別の検証で弾かれていた
//   - inquiry_date がゼロ埋めされておらず日付検証で弾かれていた
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadGas, REPO_ROOT } from '../harness/loadGas.mjs';
import {
  StatefulSheet,
  StatefulSpreadsheet,
  makeStatefulGasPlatform,
} from '../harness/statefulSpreadsheet.mjs';

/**
 * `JSON.stringify({...})` 形式のGASテストファイルから、ペイロードを取り出す。
 * 波括弧の対応を数えて範囲を決め、JS 側で許される末尾カンマだけ落として読む。
 * @param {string} relPath リポジトリ直下からの相対パス
 * @returns {Object}
 */
function extractFixturePayload(relPath) {
  const source = readFileSync(join(REPO_ROOT, relPath), 'utf8');
  const stringifyAt = source.indexOf('JSON.stringify(');
  assert.notEqual(stringifyAt, -1, `${relPath}: JSON.stringify が見つからない`);

  const start = source.indexOf('{', stringifyAt);
  let depth = 0;
  let end = -1;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) { end = index; break; }
  }
  assert.notEqual(end, -1, `${relPath}: オブジェクトの終端が見つからない`);

  return JSON.parse(source.slice(start, end + 1).replace(/,(\s*[}\]])/g, '$1'));
}

function makeGrid(rows = 520, cols = 30) {
  return Array.from({ length: rows }, () => new Array(cols).fill(''));
}

function setCell(grid, row, col, value) {
  grid[row - 1][col - 1] = value;
}

/** 実シートと同じ骨格（受け皿ラベル「その他」を含む）の住宅系ドメインシート */
function makeResidentialDomainGrid(year) {
  const grid = makeGrid();
  setCell(grid, 1, 2, year);
  for (const headerRow of [34, 69, 229, 285, 341, 471]) {
    setCell(grid, headerRow, 2, year);
  }
  setCell(grid, 107, 1, year);
  setCell(grid, 107, 2, '柳田光治');
  setCell(grid, 107, 3, 'その他');
  setCell(grid, 107, 4, '合計');

  setCell(grid, 182, 12, year);
  setCell(grid, 182, 13, '理由総数');
  setCell(grid, 182, 14, '柳田光治');
  setCell(grid, 183, 12, '他社');
  setCell(grid, 184, 12, '合計');

  for (const headerRow of [229, 285]) {
    setCell(grid, headerRow + 1, 1, '検索');
    setCell(grid, headerRow + 2, 1, 'その他');
    setCell(grid, headerRow + 3, 1, '合計');
  }
  for (const headerRow of [341, 471]) {
    setCell(grid, headerRow + 1, 1, '名古屋市中区');
    setCell(grid, headerRow + 2, 1, '愛知県');
    setCell(grid, headerRow + 3, 1, 'その他');
    setCell(grid, headerRow + 4, 1, '合計');
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

function makeEnvironment(year = '2026年') {
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
    }
  }
  const domain = new StatefulSheet(
    '【一般住宅】名古屋',
    makeResidentialDomainGrid(year),
    { events, maxColumns: 30 },
  );
  sheets.push(domain);

  const spreadsheet = new StatefulSpreadsheet(sheets, { events });
  const platform = makeStatefulGasPlatform(spreadsheet, { events });
  const gas = loadGas({ platformOverrides: platform.platformOverrides });
  return { gas, spreadsheet, events, domain };
}

const CUSTOMER_FIXTURE = '顧客管理テスト.gs';
const SALES_FIXTURE = '営業進捗テスト.gs';

test('実ペイロード: 顧客管理テスト.gs は一覧書き込みとドメイン集計まで成功する', () => {
  const env = makeEnvironment();
  const payload = extractFixturePayload(CUSTOMER_FIXTURE);

  const response = env.gas.handleWebhook({
    postData: { contents: JSON.stringify(payload) },
  });
  const body = JSON.parse(response.getContent());

  assert.equal(body.result, 'success');
  assert.equal(body.listSheet, '名古屋-一般住宅');
  assert.equal(body.domainSheet, '【一般住宅】名古屋');

  const list = env.spreadsheet.getSheetByName('名古屋-一般住宅');
  assert.equal(list.valueAt(2, 6), 'テスト 三瀬', 'お客様名');
  assert.equal(list.valueAt(2, 1), '2026年', '反響年');
  assert.equal(list.valueAt(2, 2), '8月', '反響日7/28は21日以降なので翌月扱い');
  assert.equal(list.valueAt(2, 3), 'B-D', '「面識なし」は不明と同じB-D');

  // 年別ファネル: 反響1／来場0（顧客情報アプリは商談日を書かない）／成約0
  assert.equal(env.domain.valueAt(35, 2), 1, '反響者');
  assert.equal(env.domain.valueAt(36, 2), 0, '来場者');
  assert.equal(env.domain.valueAt(39, 2), 0, '成約');
  // 月別反響数: 8月（70行が1月）
  assert.equal(env.domain.valueAt(77, 2), 1, '8月の反響数');
});

test('実ペイロード: 営業進捗テスト.gs は同じ行を更新し商談日を集計へ反映する', () => {
  const env = makeEnvironment();
  env.gas.handleWebhook({
    postData: { contents: JSON.stringify(extractFixturePayload(CUSTOMER_FIXTURE)) },
  });

  const response = env.gas.handleWebhook({
    postData: { contents: JSON.stringify(extractFixturePayload(SALES_FIXTURE)) },
  });
  const body = JSON.parse(response.getContent());

  assert.equal(body.result, 'success');
  assert.equal(body.domainSheet, '【一般住宅】名古屋');

  const list = env.spreadsheet.getSheetByName('名古屋-一般住宅');
  assert.equal(list.getLastRow(), 2, '同名顧客なので行は増えない');
  assert.equal(list.valueAt(2, 3), 'B-C', '営業側の「見込み小」でランクを更新');
  assert.equal(list.valueAt(2, 5), '2', '来場回数');

  // 1回目・2回目の商談日が入るため来場・再来が立つ
  assert.equal(env.domain.valueAt(35, 2), 1, '反響者');
  assert.equal(env.domain.valueAt(36, 2), 1, '来場者');
  assert.equal(env.domain.valueAt(37, 2), 1, '再来者');
  assert.equal(env.domain.valueAt(38, 2), 0, '3回目以上');
  assert.equal(env.domain.valueAt(39, 2), 0, '成約');
  assert.equal(env.domain.valueAt(77, 2), 1, '8月の反響数');
});

test('実ペイロード: 2ファイルとも対応イベント種別とYYYY-MM-DD形式を満たす', () => {
  const gas = loadGas();
  for (const relPath of [CUSTOMER_FIXTURE, SALES_FIXTURE]) {
    const payload = extractFixturePayload(relPath);
    assert.doesNotThrow(
      () => gas._assertSupportedWebhookEventType(payload.type),
      `${relPath}: type が対応イベント種別`,
    );
    assert.match(
      payload.record.inquiry_date.value,
      /^\d{4}-\d{2}-\d{2}$/,
      `${relPath}: inquiry_date はゼロ埋めのYYYY-MM-DD`,
    );
  }
});
