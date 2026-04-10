/**
 * Criteria used to match incoming messages to a Route.
 * All provided fields are ANDed together (all must match).
 */
export interface RouteCriteria {
  /** Match messages from a specific channel ID */
  channelId?: string;
  /** Match messages from a specific group/channel within the platform */
  groupId?: string;
  /** Match only DM (direct message) events */
  isDm?: boolean;
  /** Match messages within a specific native thread ID */
  nativeThreadId?: string;
  /** Match messages that mention the bot */
  isMention?: boolean;
  /** Match messages from a specific sender ID */
  senderId?: string;
  /** Match messages whose text matches this regex pattern */
  contentPattern?: string;
}

/**
 * A Route maps incoming messages (matching given criteria) to an outbound Recipient.
 * Routes are evaluated in priority order (lower number = higher priority).
 */
export interface Route {
  /** Unique identifier for the route */
  id: string;
  /** Criteria that an incoming message must satisfy to trigger this route */
  criteria: RouteCriteria;
  /** The recipient to forward matching messages to */
  recipientId: string;
  /** Priority for ordering when multiple routes match (lower = higher priority) */
  priority: number;
  /** Whether this route is currently active */
  enabled?: boolean;
}

export type CreateRouteInput = Route;
