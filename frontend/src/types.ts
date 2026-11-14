export interface ContactRecord {
  ContactId: string;
  CustomerEndpointAddress: string;
  AgentInteractionDuration: number;
  DisconnectReason: string;
  InitiationMethod: string;
  QueueName: string;
  /** VOICE, CHAT, etc. */
  Channel: string;
  /** ISO-8601 timestamp. */
  Timestamp: string;
}

export interface ContactHistoryResponse {
  contacts: ContactRecord[];
}
