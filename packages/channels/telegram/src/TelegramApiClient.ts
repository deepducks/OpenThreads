/**
 * Lightweight Telegram Bot API HTTP client.
 *
 * Zero external dependencies — uses the built-in `fetch` API.
 * Supports the minimum surface needed by TelegramAdapter:
 *   - setWebhook
 *   - sendMessage (with inline keyboards)
 *   - editMessageText
 *   - editMessageReplyMarkup
 *   - answerCallbackQuery
 *   - deleteWebhook
 */

// ---------------------------------------------------------------------------
// Shared API types
// ---------------------------------------------------------------------------

export interface TelegramSendMessageParams {
  chat_id: string | number;
  text: string;
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  reply_to_message_id?: number;
  reply_markup?: unknown;
  disable_notification?: boolean;
}

export interface TelegramEditMessageTextParams {
  chat_id: string | number;
  message_id: number;
  text: string;
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  reply_markup?: unknown;
}

export interface TelegramEditMessageReplyMarkupParams {
  chat_id: string | number;
  message_id: number;
  reply_markup?: unknown;
}

export interface TelegramAnswerCallbackQueryParams {
  callback_query_id: string;
  text?: string;
  show_alert?: boolean;
}

export interface TelegramSetWebhookParams {
  url: string;
  secret_token?: string;
  allowed_updates?: string[];
  drop_pending_updates?: boolean;
}

// ---------------------------------------------------------------------------
// Injectable client interface — for testability
// ---------------------------------------------------------------------------

export interface TelegramApiClientLike {
  setWebhook(params: TelegramSetWebhookParams): Promise<unknown>;
  deleteWebhook(): Promise<unknown>;
  sendMessage(params: TelegramSendMessageParams): Promise<unknown>;
  editMessageText(params: TelegramEditMessageTextParams): Promise<unknown>;
  editMessageReplyMarkup(params: TelegramEditMessageReplyMarkupParams): Promise<unknown>;
  answerCallbackQuery(params: TelegramAnswerCallbackQueryParams): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Concrete implementation
// ---------------------------------------------------------------------------

export class TelegramApiClient implements TelegramApiClientLike {
  private readonly baseUrl: string;

  constructor(token: string) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  private async call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '(no body)');
      throw new Error(`Telegram API HTTP ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as {
      ok: boolean;
      result?: unknown;
      description?: string;
    };

    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.description ?? 'Unknown error'}`);
    }

    return data.result;
  }

  async setWebhook(params: TelegramSetWebhookParams): Promise<unknown> {
    return this.call('setWebhook', params as unknown as Record<string, unknown>);
  }

  async deleteWebhook(): Promise<unknown> {
    return this.call('deleteWebhook', {});
  }

  async sendMessage(params: TelegramSendMessageParams): Promise<unknown> {
    return this.call('sendMessage', params as unknown as Record<string, unknown>);
  }

  async editMessageText(params: TelegramEditMessageTextParams): Promise<unknown> {
    return this.call('editMessageText', params as unknown as Record<string, unknown>);
  }

  async editMessageReplyMarkup(params: TelegramEditMessageReplyMarkupParams): Promise<unknown> {
    return this.call('editMessageReplyMarkup', params as unknown as Record<string, unknown>);
  }

  async answerCallbackQuery(params: TelegramAnswerCallbackQueryParams): Promise<unknown> {
    return this.call('answerCallbackQuery', params as unknown as Record<string, unknown>);
  }
}
