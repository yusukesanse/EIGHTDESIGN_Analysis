/**
 * utils.gs — ロガー・入力検証（旧 logger.gs + validator.gs）
 */

// ============================================================
// ログレベル定義
// ============================================================

/** @enum {string} ログレベル */
const LOG_LEVEL = {
  DEBUG: 'DEBUG',
  INFO:  'INFO',
  WARN:  'WARN',
  ERROR: 'ERROR',
};

// ============================================================
// ロガー本体
// ============================================================

/**
 * Logger ユーティリティ
 * DEBUG_MODE が true のときのみ DEBUG ログを出力する
 */
const AppLogger = {

  /**
   * DEBUGログを出力する（DEBUG_MODEがtrueの場合のみ）
   * @param {string} message - ログメッセージ
   * @param {*} [data] - 追加データ（オブジェクト等）
   */
  debug(message, data) {
    if (!DEBUG_MODE) return;
    _log(LOG_LEVEL.DEBUG, message, data);
  },

  /**
   * INFOログを出力する
   * @param {string} message - ログメッセージ
   * @param {*} [data] - 追加データ（オブジェクト等）
   */
  info(message, data) {
    _log(LOG_LEVEL.INFO, message, data);
  },

  /**
   * WARNログを出力する
   * @param {string} message - ログメッセージ
   * @param {*} [data] - 追加データ（オブジェクト等）
   */
  warn(message, data) {
    _log(LOG_LEVEL.WARN, message, data);
  },

  /**
   * ERRORログを出力し、Slack通知も送信する
   * @param {string} message - エラーメッセージ
   * @param {Error|null} [error] - Errorオブジェクト
   * @param {Object} [context] - 追加コンテキスト情報
   * @param {string} [context.functionName] - エラー発生関数名
   * @param {string} [context.customerName] - 処理中のお客様名
   * @param {string} [context.customerType] - 処理中の顧客種別
   */
  error(message, error, context = {}) {
    const detail = {
      ...(error ? { stack: error.stack, errorMessage: error.message } : {}),
      ...context,
    };
    _log(LOG_LEVEL.ERROR, message, detail);
    _notifySlack(message, error, context);
  },

  /**
   * 実行時間を計測してINFOログに記録するタイマーを返す
   * @param {string} label - 計測ラベル
   * @returns {{ stop: function(): number }} stopを呼ぶと経過msを返す
   */
  startTimer(label) {
    const start = Date.now();
    AppLogger.debug(`[TIMER START] ${label}`);
    return {
      stop() {
        const elapsed = Date.now() - start;
        AppLogger.info(`[TIMER END] ${label}: ${elapsed}ms`);
        return elapsed;
      },
    };
  },
};

// ============================================================
// 内部ヘルパー
// ============================================================

/**
 * 実際のログ出力処理
 * @param {string} level - ログレベル
 * @param {string} message - メッセージ
 * @param {*} [data] - 追加データ
 */
function _log(level, message, data) {
  const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const prefix    = `[${timestamp}] [${level}]`;

  if (data !== undefined) {
    const dataStr = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
    console.log(`${prefix} ${message}\n${dataStr}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

/**
 * Slack通知送信
 * SLACK_WEBHOOK_URL が設定されていない場合はスキップ
 * @param {string} message - エラーメッセージ
 * @param {Error|null} [error] - Errorオブジェクト
 * @param {Object} [context] - コンテキスト情報
 */
function _notifySlack(message, error, context = {}) {
  if (!SLACK_WEBHOOK_URL) return;

  try {
    const lines = [
      `*:rotating_light: GAS エラー通知*`,
      `*メッセージ:* ${message}`,
    ];

    if (context.functionName) lines.push(`*発生関数:* ${context.functionName}`);
    if (context.customerName) lines.push(`*お客様名:* ${context.customerName}`);
    if (context.customerType) lines.push(`*顧客種別:* ${context.customerType}`);
    if (error?.stack)         lines.push(`*スタックトレース:*\n\`\`\`${error.stack}\`\`\``);

    const payload = JSON.stringify({ text: lines.join('\n') });

    UrlFetchApp.fetch(SLACK_WEBHOOK_URL, {
      method:      'post',
      contentType: 'application/json',
      payload:     payload,
    });
  } catch (slackErr) {
    console.error('Slack通知送信エラー:', slackErr);
  }
}

// ============================================================
// Webhookペイロード検証
// ============================================================

/**
 * WebhookのPOSTボディを検証する
 * @param {string} rawBody - リクエストボディ（JSON文字列）
 * @returns {{ appId: string, record: Object }} パース済みデータ
 * @throws {Error} パース失敗・必須フィールド欠如の場合
 */
function validateWebhookPayload(rawBody) {
  // JSONパース
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch (e) {
    throw new Error(`Webhookペイロードのパースに失敗しました: ${e.message}`);
  }

  // app.id の存在確認
  if (!parsed?.app?.id) {
    throw new Error('Webhookペイロードに app.id が存在しません');
  }

  // record の存在確認
  if (!parsed?.record || typeof parsed.record !== 'object') {
    throw new Error('Webhookペイロードに record が存在しません');
  }

  return {
    appId:  String(parsed.app.id),
    record: parsed.record,
    type:   parsed.type ?? '',   // Webhookイベント種別（ADD_RECORD 等）。無ければ空文字。
  };
}

// ============================================================
// レコードフィールド検証
// ============================================================

/**
 * レコードの必須フィールドが揃っているか確認する
 * @param {Object} record - kintoneレコードオブジェクト
 * @param {string[]} requiredFields - 必須フィールドコードの配列
 * @throws {Error} 必須フィールドが欠如している場合
 */
function validateRequiredFields(record, requiredFields) {
  const missing = requiredFields.filter(field => {
    const fieldData = record[field];
    return fieldData === undefined || fieldData === null || fieldData.value === undefined;
  });

  if (missing.length > 0) {
    throw new Error(`必須フィールドが不足しています: ${missing.join(', ')}`);
  }
}

/**
 * 顧客情報アプリの必須フィールドを検証する
 * @param {Object} record - kintoneレコードオブジェクト
 * @throws {Error} 必須フィールドが欠如している場合
 */
function validateCustomerRecord(record) {
  const required = [
    CUSTOMER_FIELDS.CUSTOMER_TYPE,
    CUSTOMER_FIELDS.CUSTOMER_NAME,
    CUSTOMER_FIELDS.PROMOTION_AREA,
    CUSTOMER_FIELDS.INQUIRY_DATE,
    CUSTOMER_FIELDS.LIKEHOOD_NOW,
  ];
  validateRequiredFields(record, required);
}

/**
 * 営業・商談管理アプリの必須フィールドを検証する
 * @param {Object} record - kintoneレコードオブジェクト
 * @throws {Error} 必須フィールドが欠如している場合
 */
function validateSalesRecord(record) {
  const required = [
    SALES_FIELDS.CUSTOMER_TYPE,
    SALES_FIELDS.CUSTOMER_NAME,
    SALES_FIELDS.PROMOTION_AREA,
    SALES_FIELDS.INQUIRY_DATE,
    SALES_FIELDS.LIKEHOOD_NOW,
    SALES_FIELDS.NEGO_STATUS,
  ];
  validateRequiredFields(record, required);
}

// ============================================================
// 汎用バリデーションヘルパー
// ============================================================

/**
 * 値がnull/undefinedでないことを確認する
 * @param {*} value - 検証する値
 * @param {string} label - エラーメッセージ用のラベル
 * @throws {Error} 値がnull/undefinedの場合
 */
function assertNotNull(value, label) {
  if (value === null || value === undefined) {
    throw new Error(`${label} はnull/undefinedであってはなりません`);
  }
}

/**
 * 値が非空文字列であることを確認する
 * @param {*} value - 検証する値
 * @param {string} label - エラーメッセージ用のラベル
 * @throws {Error} 空文字列・null・undefinedの場合
 */
function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} は空でない文字列である必要があります（現在の値: ${JSON.stringify(value)}）`);
  }
}

/**
 * 値が有効な日付文字列（YYYY-MM-DD形式）であることを確認する
 * @param {string} value - 検証する値
 * @param {string} label - エラーメッセージ用のラベル
 * @throws {Error} 形式が不正な場合
 */
function assertDateString(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} はYYYY-MM-DD形式である必要があります（現在の値: ${value}）`);
  }
}

/**
 * 値が配列であることを確認する
 * @param {*} value - 検証する値
 * @param {string} label - エラーメッセージ用のラベル
 * @throws {Error} 配列でない場合
 */
function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} は配列である必要があります（現在の型: ${typeof value}）`);
  }
}

/**
 * 値が許容リストに含まれることを確認する
 * @param {*} value - 検証する値
 * @param {Array} allowedValues - 許容する値のリスト
 * @param {string} label - エラーメッセージ用のラベル
 * @throws {Error} 許容リストに含まれない場合
 */
function assertInAllowedValues(value, allowedValues, label) {
  if (!allowedValues.includes(value)) {
    throw new Error(`${label} の値が不正です: "${value}"（許容値: ${allowedValues.join(', ')}）`);
  }
}
