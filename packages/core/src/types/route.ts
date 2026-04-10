/**
 * Route — a routing rule that maps incoming messages (sender via channel)
 * to outbound recipients. Routes are evaluated in priority order.
 */
export interface Route {
  /** Unique identifier for the route */
  routeId: string;
  /** Human-readable name for the route */
  name: string;
  /** Criteria that must match for this route to be applied */
  criteria: RouteCriteria;
  /** The recipient that receives matched messages */
  recipientId: string;
  /** Priority order — lower numbers are evaluated first */
  priority: number;
  /** Whether the route is currently active */
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RouteCriteria {
  /** Match by specific channel */
  channelId?: string;
  /** Match by channel type (e.g. 'slack', 'telegram') */
  channelType?: string;
  /** Match by target ID (group, DM, channel) on the platform */
  targetId?: string;
  /** Match by specific thread */
  threadId?: string;
  /** Match by sender ID */
  senderId?: string;
  /** Match by mention (e.g. bot username) */
  mention?: string;
  /** Match message content against a regex pattern */
  contentPattern?: string;
  /** Whether to match only direct messages */
  isDM?: boolean;
  /** Additional platform-specific criteria */
  [key: string]: unknown;
}

export type RouteInput = Omit<Route, 'createdAt' | 'updatedAt'>;
