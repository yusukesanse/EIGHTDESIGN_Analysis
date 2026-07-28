// 特性テスト（フェーズ2）: 正規化済みモデル buildNormalizedRecord
// 一覧行生成・グラフ集計が受け取る共通モデルの内容を固定する。
// モデルの各値は既存の抽出・正規化関数の結果と一致する（新たな変換は追加しない）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from '../harness/loadGas.mjs';

const g = loadGas();

function customerRecord() {
  return {
    $id: { value: '1001' },
    $revision: { value: '7' },
    customer_type: { value: '注文住宅' },
    customer_name: { value: '顧客花子' },
    promotion_area: { value: '名古屋店' },
    inquiry_date: { value: '2025-04-21' },
    likehood_now: { value: '成約' },
    information_route: { value: 'SUUMO' },
    manager: { value: [{ name: '田中' }, { name: '佐藤' }] },
    age: { value: '30代' },
    current_residence: { value: '賃貸' },
    family_member: { value: '3' },
  };
}

function salesRecord() {
  return {
    $id: { value: '2002' },
    $revision: { value: '3' },
    customer_type: { value: '小型店舗' },
    customer_name: { value: '営業商店' },
    promotion_area: { value: '東京' },
    inquiry_date: { value: '2025-12-21' },   // 翌年1月へ繰り上がる
    likehood_now: { value: '見込み大' },
    nego_status: { value: '長期追客' },
    manager: { value: [{ name: '鈴木' }] },
    deal_history: { value: [] },
  };
}

test('モデル（顧客アプリ）: メタ情報・正規化・シート名', () => {
  const m = g.buildNormalizedRecord(g.CUSTOMER_APP_ID, customerRecord(), 'ADD_RECORD');
  assert.equal(m.appId, g.CUSTOMER_APP_ID);
  assert.equal(m.eventType, 'ADD_RECORD');
  assert.equal(m.recordId, '1001');
  assert.equal(m.revision, '7');
  assert.equal(m.sourceKey, '20:1001');
  assert.equal(m.customerName, '顧客花子');
  assert.equal(m.customerType, '一般住宅');       // 注文住宅→一般住宅
  assert.equal(m.promotionArea, '名古屋');         // 末尾「店」除去
  assert.equal(m.inquiryDate, '2025-04-21');
  assert.equal(m.aggregationYear, '2025年');
  assert.equal(m.aggregationMonth, '5月');         // 21日→翌月
  assert.equal(m.rank, 'A');                       // 成約→A
  assert.equal(m.manager, '田中');                 // 先頭1名
  assert.equal(m.sheetArea, '名古屋');
  assert.equal(m.listSheetName, '名古屋-一般住宅');
  // アプリ由来項目: 顧客側のみ
  assert.notEqual(m.customerFields, null);
  assert.equal(m.salesFields, null);
  assert.equal(m.customerFields.familyMember, '3');
});

test('モデル（営業アプリ）: 東京・年繰り上がり・salesFields', () => {
  const m = g.buildNormalizedRecord(g.SALES_APP_ID, salesRecord(), 'UPDATE_RECORD');
  assert.equal(m.appId, g.SALES_APP_ID);
  assert.equal(m.eventType, 'UPDATE_RECORD');
  assert.equal(m.recordId, '2002');
  assert.equal(m.customerType, '小型店舗');
  assert.equal(m.promotionArea, '東京');
  assert.equal(m.aggregationYear, '2026年');       // 12/21→翌年
  assert.equal(m.aggregationMonth, '1月');
  assert.equal(m.rank, 'B-A');                     // 見込み大→B-A
  assert.equal(m.manager, '鈴木');
  assert.equal(m.sheetArea, '東京');
  assert.equal(m.listSheetName, '東京-小型店舗');
  assert.equal(m.customerFields, null);
  assert.notEqual(m.salesFields, null);
  assert.equal(m.salesFields.negoStatus, '長期追客');
});

test('モデル: 遠方エリアは名古屋シートへ集約', () => {
  const rec = customerRecord();
  rec.promotion_area = { value: '遠方' };
  const m = g.buildNormalizedRecord(g.CUSTOMER_APP_ID, rec);
  assert.equal(m.promotionArea, '遠方');
  assert.equal(m.sheetArea, '名古屋');
  assert.equal(m.listSheetName, '名古屋-一般住宅');   // 遠方→名古屋
  assert.equal(m.eventType, '');                     // 既定は空
});

test('モデル: 対応エリア外は書き込み前に例外', () => {
  const rec = customerRecord();
  rec.promotion_area = { value: '大阪' };
  assert.throws(
    () => g.buildNormalizedRecord(g.CUSTOMER_APP_ID, rec),
    /未対応の販促エリア/
  );
});

test('モデル: 未対応の顧客種別は書き込み前に例外', () => {
  const rec = customerRecord();
  rec.customer_type = { value: '不明な種別' };
  assert.throws(
    () => g.buildNormalizedRecord(g.CUSTOMER_APP_ID, rec),
    /未対応の顧客種別/
  );
});

test('モデル: 不正な問い合わせ日は書き込み前に例外', () => {
  const rec = customerRecord();
  rec.inquiry_date = { value: '2025/04/21' };
  assert.throws(
    () => g.buildNormalizedRecord(g.CUSTOMER_APP_ID, rec),
    /YYYY-MM-DD形式/
  );
});

test('モデル: 実在しない問い合わせ日は書き込み前に例外', () => {
  const rec = customerRecord();
  rec.inquiry_date = { value: '2025-02-30' };
  assert.throws(
    () => g.buildNormalizedRecord(g.CUSTOMER_APP_ID, rec),
    /実在する日付/
  );
});

test('モデル: revision欠落・不正形式・安全整数範囲外は書き込み前に例外', () => {
  const missing = customerRecord();
  delete missing.$revision;
  assert.throws(
    () => g.buildNormalizedRecord(g.CUSTOMER_APP_ID, missing),
    /\$revision は非負の整数文字列/
  );

  const decimal = customerRecord();
  decimal.$revision = { value: '1.5' };
  assert.throws(
    () => g.buildNormalizedRecord(g.CUSTOMER_APP_ID, decimal),
    /\$revision は非負の整数文字列/
  );

  const tooLarge = customerRecord();
  tooLarge.$revision = { value: '9007199254740992' };
  assert.throws(
    () => g.buildNormalizedRecord(g.CUSTOMER_APP_ID, tooLarge),
    /\$revision は安全な整数範囲内/
  );
});

test('モデル: $idは正の安全整数文字列だけを受け付ける', () => {
  const zero = customerRecord();
  zero.$id = { value: '0' };
  assert.throws(
    () => g.buildNormalizedRecord(g.CUSTOMER_APP_ID, zero),
    /\$id は1以上の整数文字列/
  );

  for (const invalidId of ['1.5', 'not-a-number']) {
    const invalid = customerRecord();
    invalid.$id = { value: invalidId };
    assert.throws(
      () => g.buildNormalizedRecord(g.CUSTOMER_APP_ID, invalid),
      /\$id は非負の整数文字列/
    );
  }

  const tooLarge = customerRecord();
  tooLarge.$id = { value: '9007199254740992' };
  assert.throws(
    () => g.buildNormalizedRecord(g.CUSTOMER_APP_ID, tooLarge),
    /\$id は安全な整数範囲内/
  );
});

test('モデル: 未対応アプリIDは例外', () => {
  assert.throws(() => g.buildNormalizedRecord('99', customerRecord()), /未対応のアプリID/);
});

test('parseWebhookBody: イベント種別を透過する', () => {
  const body = JSON.stringify({ app: { id: 20 }, type: 'ADD_RECORD', record: customerRecord() });
  const { appId, type } = g.parseWebhookBody(body);
  assert.equal(appId, '20');
  assert.equal(type, 'ADD_RECORD');
});
