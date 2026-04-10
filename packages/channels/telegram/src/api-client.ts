/**
 * Lightweight Telegram Bot API HTTP client.
 *
 * Uses the native fetch API (available in Bun / Node 18+).
 * Raises TelegramApiError on non-ok responses.
 */

import type {
  SendMessageParams,
  AnswerCallbackQueryParams,
  SetWebhookParams,
  TelegramApiResponse,
  TelegramMessage,
} from "./types.js";

export class TelegramApiError extends Error {
  constructor(
    public readonly errorCode: number,
    description: string,
  ) {
    super(`Telegram API error ${errorCode}: ${description}`);
    this.name = "TelegramApiError";
  }
}

export class TelegramApiClient {
  private readonly baseUrl: string;

  constructor(private readonly botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  private async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    const body = (await response.json()) as TelegramApiResponse<T>;

    if (!body.ok) {
      throw new TelegramApiError(
        body.error_code ?? response.status,
        body.description ?? "Unknown error",
      );
    }

    return body.result as T;
  }

  /**
   * Send a message to a chat.
   */
  async sendMessage(params: SendMessageParams): Promise<TelegramMessage> {
    return this.call<TelegramMessage>("sendMessage", params as unknown as Record<string, unknown>);
  }

  /**
   * Answer a callback query (clears the spinner on the button).
   */
  async answerCallbackQuery(params: AnswerCallbackQueryParams): Promise<boolean> {
    return this.call<boolean>("answerCallbackQuery", params as unknown as Record<string, unknown>);
  }

  /**
   * Register a webhook URL with Telegram.
   * Telegram will POST updates to this URL.
   */
  async setWebhook(params: SetWebhookParams): Promise<boolean> {
    return this.call<boolean>("setWebhook", params as unknown as Record<string, unknown>);
  }

  /**
   * Remove the registered webhook.
   */
  async deleteWebhook(dropPendingUpdates = false): Promise<boolean> {
    return this.call<boolean>("deleteWebhook", { drop_pending_updates: dropPendingUpdates });
  }

  /**
   * Get basic information about the bot.
   */
  async getMe(): Promise<{ id: number; username: string; first_name: string }> {
    return this.call("getMe", {});
  }
}
