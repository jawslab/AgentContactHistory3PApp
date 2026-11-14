/**
 * Shared types for the Agent Contact History solution.
 */

/** The compact item persisted to DynamoDB (one row per handled contact). */
export interface ContactHistoryItem {
  /** Partition key: Amazon Connect user id (the agent). */
  pk: string;
  /** Sort key: event timestamp in epoch milliseconds. */
  sk: number;
  ContactId: string;
  /** Incoming (ANI) or dialed customer phone number / endpoint. */
  CustomerEndpointAddress: string;
  /** Agent interaction duration in seconds. */
  AgentInteractionDuration: number;
  /** AGENT or CUSTOMER. */
  DisconnectReason: string;
  /** INBOUND, OUTBOUND, TRANSFER, CALLBACK, etc. */
  InitiationMethod: string;
  /** Name of the inbound or outbound queue. */
  QueueName: string;
  /** VOICE, CHAT, etc. Optional because items written before this field existed lack it. */
  Channel?: string;
  /** DynamoDB TTL attribute (epoch seconds). */
  ExpirationTime: number;
}

/** The record shape returned to the frontend widget. */
export interface ContactRecordDto {
  ContactId: string;
  CustomerEndpointAddress: string;
  AgentInteractionDuration: number;
  DisconnectReason: string;
  InitiationMethod: string;
  QueueName: string;
  /** VOICE, CHAT, etc. */
  Channel: string;
  /** ISO-8601 timestamp of the contact. */
  Timestamp: string;
}

/**
 * Minimal subset of the Amazon Connect Contact Trace Record we care about.
 * See: Amazon Connect data streaming — Contact Trace Records.
 */
export interface ContactTraceRecord {
  ContactId?: string;
  InitiationMethod?: string;
  Channel?: string;
  DisconnectTimestamp?: string | null;
  InitiationTimestamp?: string | null;
  CustomerEndpoint?: { Address?: string | null; Type?: string | null } | null;
  SystemEndpoint?: { Address?: string | null; Type?: string | null } | null;
  Queue?: { Name?: string | null; ARN?: string | null } | null;
  DisconnectReason?: string | null;
  Agent?: {
    ARN?: string | null;
    Username?: string | null;
    AgentInteractionDuration?: number | null;
    ConnectedToAgentTimestamp?: string | null;
  } | null;
}
