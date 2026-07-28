// ============================================================
// aggregation.test.mjs — ドメインシート集計（全面再計算）の特性テスト
// ------------------------------------------------------------
// buildAggregationWrites(grid, listData, targetYear, style) が
// 一覧シートデータから正しい書き込み指示を組み立てることを固定する。
// シートには書き込まない（書き込み指示 { row, col, values } のみ検証）。
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert';
import { loadGas } from '../harness/loadGas.mjs';

const g = loadGas();

// ------------------------------------------------------------
// テスト用グリッド（ドメインシートの骨格を再現）
// ------------------------------------------------------------

function makeGrid(rows = 520, cols = 30) {
  return Array.from({ length: rows }, () => new Array(cols).fill(''));
}

/** 1始まりで grid にセルを置く */
function setCell(grid, row, col, value) {
  grid[row - 1][col - 1] = value;
}

/** 共通ブロックのラベルを配置した住宅系グリッドを作る */
function makeResidentialGrid() {
  const grid = makeGrid();
  // 年別ファネル・月別のヘッダー
  setCell(grid, 34, 1, '一般住宅');
  setCell(grid, 34, 2, '2025年');
  setCell(grid, 34, 3, '2026年');
  setCell(grid, 69, 1, '月ごとの反響数');
  setCell(grid, 69, 2, '2025年');
  setCell(grid, 69, 3, '2026年');
  // 担当者ヘッダー（その他=受け皿、合計=横計）
  setCell(grid, 107, 1, '2025年');
  setCell(grid, 107, 2, '田中');
  setCell(grid, 107, 3, '佐藤');
  setCell(grid, 107, 4, 'その他');
  setCell(grid, 107, 5, '合計');
  // 離脱理由（L列=12列目）
  setCell(grid, 182, 12, '2025年');
  setCell(grid, 182, 13, '理由総数');
  setCell(grid, 182, 14, '田中');
  setCell(grid, 182, 15, '佐藤');
  setCell(grid, 183, 12, '他社');
  setCell(grid, 184, 12, '予算乖離');
  setCell(grid, 185, 12, '合計');
  // 反響媒体
  setCell(grid, 229, 1, '反響媒体');
  setCell(grid, 229, 2, '2025年');
  setCell(grid, 229, 3, '2026年');
  setCell(grid, 230, 1, '検索');
  setCell(grid, 231, 1, 'Instagram');
  setCell(grid, 232, 1, 'その他');
  setCell(grid, 233, 1, '合計');
  setCell(grid, 285, 2, '2025年');
  setCell(grid, 285, 3, '2026年');
  setCell(grid, 286, 1, '検索');
  setCell(grid, 287, 1, '合計');
  // エリア
  setCell(grid, 341, 2, '2025年');
  setCell(grid, 341, 3, '2026年');
  setCell(grid, 342, 1, '名古屋市中区');
  setCell(grid, 343, 1, '愛知県');
  setCell(grid, 344, 1, 'その他');
  setCell(grid, 345, 1, '合計');
  setCell(grid, 471, 2, '2025年');
  setCell(grid, 471, 3, '2026年');
  setCell(grid, 472, 1, '名古屋市中区');
  setCell(grid, 473, 1, 'その他');
  setCell(grid, 474, 1, '合計');
  return grid;
}

/** 法人系グリッドを作る */
function makeBusinessGrid() {
  const grid = makeGrid();
  setCell(grid, 34, 1, '小型店舗');
  setCell(grid, 34, 2, '2025年');
  setCell(grid, 34, 3, '2026年');
  setCell(grid, 69, 1, '名古屋');
  setCell(grid, 69, 2, '2025年');
  setCell(grid, 69, 3, '2026年');
  setCell(grid, 107, 1, '2025年');
  setCell(grid, 107, 2, '田中');
  setCell(grid, 107, 3, '計');
  // 業種×企業規模
  setCell(grid, 120, 1, '2025年');
  setCell(grid, 120, 2, '零細企業');
  setCell(grid, 120, 3, '中小企業');
  setCell(grid, 120, 4, '不明');
  setCell(grid, 120, 5, '計');
  setCell(grid, 121, 1, '飲食');
  setCell(grid, 122, 1, '不明');
  setCell(grid, 123, 1, '計');
  // 肩書×企業規模
  setCell(grid, 144, 1, '2025年');
  setCell(grid, 144, 2, '零細企業');
  setCell(grid, 144, 3, '不明');
  setCell(grid, 144, 4, '計');
  setCell(grid, 145, 1, '代表者');
  setCell(grid, 146, 1, '不明');
  setCell(grid, 147, 1, '計');
  // 業態×業種（反響者）＋ 集客イベント
  setCell(grid, 154, 1, '2025年');
  setCell(grid, 154, 2, '独立');
  setCell(grid, 154, 3, '既存店舗');
  setCell(grid, 154, 4, '新店舗');
  setCell(grid, 154, 5, '合計');
  setCell(grid, 155, 1, '飲食');
  setCell(grid, 156, 1, '不明');
  setCell(grid, 157, 1, '計');
  setCell(grid, 154, 12, '集客イベント');
  setCell(grid, 154, 13, '相談会');
  setCell(grid, 154, 14, '個別相談');
  setCell(grid, 154, 15, '計');
  // 業態×業種（契約者）
  setCell(grid, 176, 1, '2025年');
  setCell(grid, 176, 2, '独立');
  setCell(grid, 176, 3, '既存店舗');
  setCell(grid, 176, 4, '新店舗');
  setCell(grid, 176, 5, '合計');
  setCell(grid, 177, 1, '飲食');
  setCell(grid, 178, 1, '不明');
  setCell(grid, 179, 1, '計');
  // 媒体・エリア（共通ブロック）
  setCell(grid, 229, 2, '2025年');
  setCell(grid, 229, 3, '2026年');
  setCell(grid, 230, 1, '検索');
  setCell(grid, 231, 1, '合計');
  setCell(grid, 285, 2, '2026年');
  setCell(grid, 286, 1, '検索');
  setCell(grid, 287, 1, '合計');
  setCell(grid, 341, 2, '2026年');
  setCell(grid, 342, 1, '名古屋市中区');
  setCell(grid, 343, 1, '合計');
  setCell(grid, 471, 2, '2026年');
  setCell(grid, 472, 1, '名古屋市中区');
  setCell(grid, 473, 1, '合計');
  return grid;
}

// ------------------------------------------------------------
// テスト用一覧シート行
// ------------------------------------------------------------

/** 空の一覧行（37列） */
function makeListRow(overrides = {}) {
  const row = new Array(37).fill('');
  const set = (col, v) => { row[col - 1] = v; };
  set(1, overrides.year ?? '2026年');
  set(2, overrides.month ?? '1月');
  set(3, overrides.rank ?? 'C');
  set(4, overrides.likehood ?? '長期追客');
  set(6, overrides.name ?? '顧客A');
  set(7, overrides.firstAppoint ?? '');
  set(9, overrides.media ?? '検索');
  set(11, overrides.manager ?? '田中');
  set(13, overrides.mtg1 ?? '');
  set(14, overrides.mtg2 ?? '');
  set(15, overrides.mtg3 ?? '');
  set(18, overrides.pref ?? '愛知県');
  set(19, overrides.city ?? '名古屋市中区');
  set(22, overrides.age ?? '');
  set(24, overrides.workPlace ?? '');
  set(25, overrides.industry ?? '');
  set(26, overrides.occupation ?? '');
  set(27, overrides.family ?? '');
  set(28, overrides.income ?? '');
  set(30, overrides.flagA ?? '');
  set(31, overrides.flagB ?? '');
  set(32, overrides.firstAcquirer ?? '');
  set(33, overrides.ownHouse ?? '');
  set(34, overrides.parentalHome ?? '');
  set(35, overrides.reason ?? '');
  return row;
}

/** 書き込み指示から (row, col) 一致の1件を取り出す */
function findWrite(writes, row, col) {
  return writes.find((w) => w.row === row && w.col === col);
}

// ------------------------------------------------------------
// 住宅系
// ------------------------------------------------------------

test('住宅系: 年別ファネルは全管理年度の列を一覧から再計算する', () => {
  const grid = makeResidentialGrid();
  const listData = [
    makeListRow({ year: '2026年', mtg1: '1月10日', mtg2: '2月1日', rank: 'A', likehood: '成約' }),
    makeListRow({ year: '2026年', mtg1: '1月15日' }),
    makeListRow({ year: '2026年' }),
    makeListRow({ year: '2025年', mtg1: '3月1日' }),  // 対象外の年
  ];
  const writes = g.buildAggregationWrites(grid, listData, '2026年', 'residential');

  const funnel = findWrite(writes, 35, 3);  // 2026年 = C列
  assert.ok(funnel, 'ファネルの書き込みが2026年列にある');
  assert.deepStrictEqual(
    funnel.values.map((r) => r[0]),
    [3, 2, 1, 0, 1, 2 / 3, 1 / 2, 0, 1 / 2, 1],
    '反響3/来場2/再来1/3回目0/成約1と各率'
  );
  // 2025年列（B列）も現在値への差分加算ではなく、2025年一覧行だけから再計算する
  const previousYear = findWrite(writes, 35, 2);
  assert.ok(previousYear, '過年度列も再計算対象になる');
  assert.deepStrictEqual(
    previousYear.values.map((r) => r[0]),
    [1, 1, 0, 0, 0, 1, 0, 0, 0, 0],
    '2025年は反響1/来場1として全面再計算'
  );
});

test('住宅系: 年度移動後は旧年度を0、新年度を1へ再計算する', () => {
  const grid = makeResidentialGrid();
  // 旧集計値が残っている状態を再現。書き込み計画は現在値を参照せず一覧から作る。
  setCell(grid, 35, 2, 99);
  setCell(grid, 35, 3, 0);
  const listData = [
    makeListRow({ year: '2026年', month: '1月', name: '年度移動した顧客' }),
  ];

  const writes = g.buildAggregationWrites(grid, listData, '2026年', 'residential');
  const oldYear = findWrite(writes, 35, 2);
  const newYear = findWrite(writes, 35, 3);

  assert.equal(oldYear.values[0][0], 0, '旧年度の反響数を0へ戻す');
  assert.equal(newYear.values[0][0], 1, '新年度の反響数を1へ更新する');
});

test('住宅系: 一覧年度に対応する必須年ヘッダーが無ければ失敗する', () => {
  const grid = makeResidentialGrid();
  const listData = [
    makeListRow({ year: '2027年', name: '未定義年度の顧客' }),
  ];

  assert.throws(
    () => g.buildAggregationWrites(grid, listData, '2026年', 'residential'),
    /必須年別ヘッダーが不足/
  );
});

test('住宅系: 月別反響数は12ヶ月+計を対象年度の列に書く', () => {
  const grid = makeResidentialGrid();
  const listData = [
    makeListRow({ month: '1月' }),
    makeListRow({ month: '1月' }),
    makeListRow({ month: '12月' }),
  ];
  const writes = g.buildAggregationWrites(grid, listData, '2026年', 'residential');
  const monthly = findWrite(writes, 70, 3);
  assert.ok(monthly);
  const col = monthly.values.map((r) => r[0]);
  assert.strictEqual(col.length, 13);
  assert.strictEqual(col[0], 2);   // 1月
  assert.strictEqual(col[11], 1);  // 12月
  assert.strictEqual(col[12], 3);  // 計
});

test('住宅系: 不正な月は月別合計から黙って落とさず書込前に失敗する', () => {
  const grid = makeResidentialGrid();
  assert.throws(
    () => g.buildAggregationWrites(
      grid,
      [makeListRow({ month: '13月' })],
      '2026年',
      'residential',
    ),
    /月が不正/
  );
});

// 旧挙動: 未定義ランクは書込前に失敗させていた。
// 新挙動（2026-07-28）: ランクは成約(A)判定にしか使わず反響数は全行数えるため、
// 語彙外ランクは「成約以外」として集計を続行する（警告ログのみ）。
// 顧客情報アプリの likehood_now に RANK_MAP 未定義の値が実在し、
// 一覧だけ書けて集計が反映されない状態を作っていたため。
test('住宅系: 未定義ランクは「成約以外」として集計を続行する', () => {
  const grid = makeResidentialGrid();
  const writes = g.buildAggregationWrites(
    grid,
    [makeListRow({ rank: '未知ランク' })],
    '2026年',
    'residential',
  );

  const funnel = findWrite(writes, 35, 3);
  assert.ok(funnel);
  assert.strictEqual(funnel.values[0][0], 1, '反響者には数える');
  assert.strictEqual(funnel.values[4][0], 0, '成約には数えない');
});

// 旧挙動: 検討レベルに無い見込度は書込前に失敗させていた。
// 新挙動（2026-07-28）: 「未」区分へ寄せ、検討レベル合計を反響数と一致させる。
test('住宅系: 検討レベルに無い見込度は「未」へ寄せて合計を反響数と一致させる', () => {
  const grid = makeResidentialGrid();
  const writes = g.buildAggregationWrites(
    grid,
    [makeListRow({ likehood: '面識なし' })],
    '2026年',
    'residential',
  );

  const consideration = writes.find((w) => w.col === 13 && w.values.length === 1);
  assert.ok(consideration, '検討レベルの書き込み指示がある');
  const counts = consideration.values[0];
  assert.strictEqual(counts[4], 1, '「未」区分へ寄せる');
  assert.strictEqual(counts.at(-1), 1, '合計は反響数と一致');
});

test('住宅系: 担当者別はヘッダーの担当者順+その他+合計で書く', () => {
  const grid = makeResidentialGrid();
  const listData = [
    makeListRow({ manager: '田中', mtg1: '1月10日', rank: 'A' }),
    makeListRow({ manager: '佐藤' }),
    makeListRow({ manager: '山本' }),  // ヘッダーに無い → その他
  ];
  const writes = g.buildAggregationWrites(grid, listData, '2026年', 'residential');
  const staff = findWrite(writes, 108, 2);
  assert.ok(staff);
  assert.strictEqual(staff.values.length, 8, '8指標');
  assert.strictEqual(staff.values[0].length, 4, '田中/佐藤/その他/合計');
  assert.deepStrictEqual(staff.values[0], [1, 1, 1, 3], '反響数');
  assert.deepStrictEqual(staff.values[1], [1, 0, 0, 1], '来場数');
  assert.deepStrictEqual(staff.values[4], [1, 0, 0, 1], '成約');
  assert.deepStrictEqual(staff.values[5], [1, 0, 0, 1 / 3], '反響来場率');
});

test('住宅系: 媒体別は対象年度の列にラベル順+合計で書く（成約者ブロックはランクAのみ）', () => {
  const grid = makeResidentialGrid();
  const listData = [
    makeListRow({ media: '検索', rank: 'A' }),
    makeListRow({ media: '検索' }),
    makeListRow({ media: 'Instagram' }),
    makeListRow({ media: '未知の媒体' }),  // ラベルに無い → その他
  ];
  const writes = g.buildAggregationWrites(grid, listData, '2026年', 'residential');

  const media = findWrite(writes, 230, 3);
  assert.deepStrictEqual(media.values, [[2], [1], [1], [4]], '検索2/Instagram1/その他1/合計4');

  const mediaClosed = findWrite(writes, 286, 3);
  assert.deepStrictEqual(mediaClosed.values, [[1], [1]], '成約者は検索1/合計1');
});

test('住宅系: エリア別は市区優先・都道府県フォールバックで数える', () => {
  const grid = makeResidentialGrid();
  const listData = [
    makeListRow({ pref: '愛知県', city: '名古屋市中区' }),  // 市区一致
    makeListRow({ pref: '愛知県', city: '豊田市' }),        // 市区不一致 → 都道府県
    makeListRow({ pref: '岐阜県', city: '' }),              // どちらも不一致 → その他
  ];
  const writes = g.buildAggregationWrites(grid, listData, '2026年', 'residential');
  const area = findWrite(writes, 342, 3);
  assert.deepStrictEqual(area.values, [[1], [1], [1], [3]], '中区1/愛知県1/その他1/合計3');
});

test('住宅系: 年収×年齢は反響者(B列)と契約者(M列)の両ブロックを書く', () => {
  const grid = makeResidentialGrid();
  const listData = [
    makeListRow({ age: 30, income: '4500000', rank: 'A' }),  // 25〜30歳 × 401〜500万
    makeListRow({ age: 70, income: '' }),                    // 60歳〜 × 不明
  ];
  const writes = g.buildAggregationWrites(grid, listData, '2026年', 'residential');

  const all = findWrite(writes, 121, 2);
  assert.strictEqual(all.values.length, 10, '年収9区分+計');
  assert.strictEqual(all.values[0].length, 9, '年齢8区分+計');
  assert.strictEqual(all.values[1][1], 1, '401〜500万 × 25〜30歳');
  assert.strictEqual(all.values[8][6], 1, '不明収入 × 60歳〜');
  assert.strictEqual(all.values[9][8], 2, '総計');

  const closed = findWrite(writes, 121, 13);
  assert.strictEqual(closed.values[1][1], 1, '契約者ブロックはランクAのみ');
  assert.strictEqual(closed.values[9][8], 1);
});

test('住宅系: 問い合わせニーズはフラグ列で絞り込み種別ごとに数える', () => {
  const grid = makeResidentialGrid();
  const listData = [
    makeListRow({ firstAcquirer: '1', firstAppoint: '相談会', mtg1: '1月10日', rank: 'A' }),
    makeListRow({ firstAcquirer: '1', firstAppoint: '個別相談' }),
    makeListRow({ ownHouse: '1', firstAppoint: '相談会' }),  // 一次取得ブロック対象外
  ];
  const writes = g.buildAggregationWrites(grid, listData, '2026年', 'residential');

  const firstAcq = findWrite(writes, 178, 2);
  assert.deepStrictEqual(firstAcq.values[0], [1, 1, 0, 0, 0, 2], '反響: 相談会1/個別相談1/計2');
  assert.deepStrictEqual(firstAcq.values[1], [1, 0, 0, 0, 0, 1], '来場');
  assert.deepStrictEqual(firstAcq.values[2], [1, 0, 0, 0, 0, 1], '契約');
  assert.deepStrictEqual(firstAcq.values[3], [1, 0, 0, 0, 0, 1 / 2], '来場率');

  const ownHouse = findWrite(writes, 186, 2);
  assert.deepStrictEqual(ownHouse.values[0], [1, 0, 0, 0, 0, 1], '持家ブロックは持家フラグ行のみ');
});

test('住宅系: 検討レベル総数は見込度列を7区分+合計で数える', () => {
  const grid = makeResidentialGrid();
  const listData = [
    makeListRow({ likehood: '成約' }),
    makeListRow({ likehood: '長期追客' }),
    makeListRow({ likehood: '長期追客' }),
    makeListRow({ likehood: '無' }),
  ];
  const writes = g.buildAggregationWrites(grid, listData, '2026年', 'residential');
  const consideration = findWrite(writes, 178, 13);
  assert.deepStrictEqual(consideration.values, [[1, 0, 0, 0, 0, 2, 1, 4]]);
});

test('住宅系: 離脱理由×担当者は理由総数列+担当者列+合計行を書く', () => {
  const grid = makeResidentialGrid();
  const listData = [
    makeListRow({ reason: '他社', manager: '田中' }),
    makeListRow({ reason: '他社', manager: '山本' }),   // ヘッダーに無い担当 → 理由総数のみ
    makeListRow({ reason: '予算乖離', manager: '佐藤' }),
    makeListRow({ reason: '' }),                        // 理由なしは対象外
  ];
  const writes = g.buildAggregationWrites(grid, listData, '2026年', 'residential');
  const leaving = findWrite(writes, 183, 13);
  assert.deepStrictEqual(leaving.values, [
    [2, 1, 0],  // 他社: 総数2 / 田中1 / 佐藤0
    [1, 0, 1],  // 予算乖離
    [3, 1, 1],  // 合計
  ]);
});

test('住宅系: 「20XX年」の年ラベルセルは対象年度に更新される', () => {
  const grid = makeResidentialGrid();
  const writes = g.buildAggregationWrites(grid, [], '2026年', 'residential');
  const label = findWrite(writes, 107, 1);
  assert.ok(label, 'A107(2025年)が更新対象になる');
  assert.deepStrictEqual(label.values, [['2026年']]);
});

// ------------------------------------------------------------
// 法人系
// ------------------------------------------------------------

test('法人系: 業種×企業規模は不明フォールバック込みで反響者/契約者を書く', () => {
  const grid = makeBusinessGrid();
  const listData = [
    makeListRow({ industry: '飲食', workPlace: '零細企業', rank: 'A' }),
    makeListRow({ industry: '謎の業種', workPlace: '謎の規模' }),  // → 不明×不明
  ];
  const writes = g.buildAggregationWrites(grid, listData, '2026年', 'business');

  const all = findWrite(writes, 121, 2);
  assert.deepStrictEqual(all.values, [
    [1, 0, 0, 1],  // 飲食: 零細1
    [0, 0, 1, 1],  // 不明: 不明1
    [1, 0, 1, 2],  // 計
  ]);
  const closed = findWrite(writes, 121, 13);
  assert.deepStrictEqual(closed.values[0], [1, 0, 0, 1], '契約者はランクAのみ');
});

// 新挙動（2026-07-28）でも「受け皿が無ければ失敗」は維持する。
// 媒体別・エリア別は合計が反響数と一致すべきブロックのため、寄せ先が無いまま
// 続行すると合計が黙って減る。メッセージは受け皿追加を促す内容へ変更。
test('法人系: 受け皿の無い未知媒体は合計から黙って落とさず失敗する', () => {
  const grid = makeBusinessGrid();
  assert.throws(
    () => g.buildAggregationWrites(
      grid,
      [makeListRow({ media: '未知の媒体' })],
      '2026年',
      'business',
    ),
    /反響媒体（全体）に「その他」「不明」行がなく/
  );
});

test('法人系: 業態×業種はフラグ列(希望種別A/B/C)で列を決める', () => {
  const grid = makeBusinessGrid();
  const listData = [
    makeListRow({ industry: '飲食', flagA: '1', rank: 'A' }),      // 独立
    makeListRow({ industry: '飲食', firstAcquirer: '1' }),          // 32列=希望種別C → 新店舗
    makeListRow({ industry: '飲食' }),                              // フラグ無し → 対象外
  ];
  const writes = g.buildAggregationWrites(grid, listData, '2026年', 'business');

  const all = findWrite(writes, 155, 2);
  assert.deepStrictEqual(all.values, [
    [1, 0, 1, 2],  // 飲食: 独立1/新店舗1
    [0, 0, 0, 0],  // 不明
    [1, 0, 1, 2],  // 計
  ]);
  const closed = findWrite(writes, 177, 2);
  assert.deepStrictEqual(closed.values[0], [1, 0, 0, 1], '契約者は独立1のみ');
});

test('法人系: 集客イベントは初回アポ種別ごとに反響/来場/契約と率を書く', () => {
  const grid = makeBusinessGrid();
  const listData = [
    makeListRow({ firstAppoint: '相談会', mtg1: '1月10日', rank: 'A' }),
    makeListRow({ firstAppoint: '個別相談' }),
    makeListRow({ firstAppoint: '見学会' }),  // ヘッダーに無い → 対象外
  ];
  const writes = g.buildAggregationWrites(grid, listData, '2026年', 'business');
  const event = findWrite(writes, 155, 13);
  assert.deepStrictEqual(event.values, [
    [1, 1, 2],        // 反響
    [1, 0, 1],        // 来場
    [1, 0, 1],        // 契約
    [1, 0, 1 / 2],    // 来場率
    [1, 0, 1],        // 歩留
  ]);
});

// ------------------------------------------------------------
// 対象年度の決定
// ------------------------------------------------------------

test('resolveAggregationYear: B1が「20XX年」ならそれを使う', () => {
  const grid = makeGrid(5, 5);
  grid[0][1] = '2027年';
  assert.strictEqual(g.resolveAggregationYear(grid), '2027年');
});

test('resolveAggregationYear: B1が無ければ現在日付から算出（12/21以降は翌年）', () => {
  const grid = makeGrid(5, 5);
  assert.strictEqual(g.resolveAggregationYear(grid, new Date('2026-07-24T00:00:00+09:00')), '2026年');
  assert.strictEqual(g.resolveAggregationYear(grid, new Date('2026-12-21T00:00:00+09:00')), '2027年');
  assert.strictEqual(g.resolveAggregationYear(grid, new Date('2026-12-20T00:00:00+09:00')), '2026年');
});
