// 特性テスト: Webhook 検証・アプリ別ディスパッチ（現行挙動の固定）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from '../harness/loadGas.mjs';

const g = loadGas();

const customerRecord = () => ({
  customer_type: { value: '注文住宅' },
  customer_name: { value: '既存太郎' },
  promotion_area: { value: '名古屋店' },
  inquiry_date: { value: '2025-04-10' },
  likehood_now: { value: '見込み大' },
});
const salesRecord = () => ({
  ...customerRecord(),
  nego_status: { value: '商談中' },
});

test('正常な顧客アプリのペイロード', () => {
  const body = JSON.stringify({ app: { id: 20 }, record: customerRecord() });
  const { appId, record } = g.validateWebhookPayload(body);
  assert.equal(appId, '20');
  assert.equal(record.customer_name.value, '既存太郎');
  // ディスパッチ検証・抽出が例外なく通ること
  assert.doesNotThrow(() => g._validateRecordByApp('20', record));
  const fields = g._extractFieldsByApp('20', record);
  assert.equal(fields.customerName, '既存太郎');
});

test('正常な営業アプリのペイロード', () => {
  const body = JSON.stringify({ app: { id: 27 }, record: salesRecord() });
  const { appId, record } = g.validateWebhookPayload(body);
  assert.equal(appId, '27');
  assert.doesNotThrow(() => g._validateRecordByApp('27', record));
  const fields = g._extractFieldsByApp('27', record);
  assert.equal(fields.negoStatus, '商談中');
});

test('JSON 不正はパースエラー', () => {
  assert.throws(() => g.validateWebhookPayload('{ not json'), /パースに失敗/);
});

test('app.id 不足', () => {
  const body = JSON.stringify({ record: customerRecord() });
  assert.throws(() => g.validateWebhookPayload(body), /app\.id/);
});

test('record 不足', () => {
  const body = JSON.stringify({ app: { id: 20 } });
  assert.throws(() => g.validateWebhookPayload(body), /record/);
});

test('未対応アプリ ID', () => {
  assert.throws(() => g._validateRecordByApp('99', customerRecord()), /未対応のアプリID/);
  assert.throws(() => g._extractFieldsByApp('99', customerRecord()), /未対応のアプリID/);
});

test('顧客アプリ: 必須フィールド不足', () => {
  const rec = customerRecord();
  delete rec.likehood_now;
  assert.throws(() => g.validateCustomerRecord(rec), /必須フィールドが不足/);
});

test('営業アプリ: 必須フィールド不足（nego_status 欠如）', () => {
  const rec = salesRecord();
  delete rec.nego_status;
  assert.throws(() => g.validateSalesRecord(rec), /必須フィールドが不足/);
});
