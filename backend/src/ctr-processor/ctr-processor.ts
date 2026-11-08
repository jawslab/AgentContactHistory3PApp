import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, getTableName } from '../shared/dynamo';
import { logger } from '../shared/logger';
import { ContactHistoryItem, ContactTraceRecord } from '../shared/types';

/** Contact states we persist. A CTR is only written once the contact has disconnected. */
const VOICE_CHANNEL = 'VOICE';

export class CtrProcessor {
  constructor(private readonly ttlHours: number = Number(process.env.TTL_HOURS ?? 24)) {}

  /**
   * Decide whether a CTR represents a completed voice contact that was handled by an
   * agent. Non-voice channels, abandoned contacts, and queue callbacks with no agent
   * are skipped.
   */
  isProcessable(ctr: ContactTraceRecord): boolean {
    if (!ctr || typeof ctr !== 'object') return false;
    if (!ctr.ContactId) return false;
    // Only persist contacts that reached an agent.
    const agent = ctr.Agent;
    if (!agent || !(agent.ARN || agent.Username)) return false;
    // Only voice contacts (the blog scopes this to call history). Treat a missing
    // channel as voice to stay permissive with partial records from older streams.
    if (ctr.Channel && ctr.Channel.toUpperCase() !== VOICE_CHANNEL) return false;
    // Must be a completed contact.
    if (!ctr.DisconnectTimestamp) return false;
    return true;
  }

  /** Map a raw CTR into the compact DynamoDB item shape. */
  mapToItem(ctr: ContactTraceRecord): ContactHistoryItem {
    const agent = ctr.Agent ?? {};
    const userId = this.extractUserId(agent.ARN, agent.Username);
    if (!userId) {
      throw new Error(`Unable to determine Connect user id for contact ${ctr.ContactId}`);
    }

    const timestampMs = this.toEpochMs(ctr.DisconnectTimestamp) ?? Date.now();
    const customerAddress =
      ctr.CustomerEndpoint?.Address ?? ctr.SystemEndpoint?.Address ?? 'Unknown';

    return {
      pk: userId,
      sk: timestampMs,
      ContactId: ctr.ContactId as string,
      CustomerEndpointAddress: customerAddress,
      AgentInteractionDuration: Number(agent.AgentInteractionDuration ?? 0),
      DisconnectReason: ctr.DisconnectReason ?? 'UNKNOWN',
      InitiationMethod: ctr.InitiationMethod ?? 'UNKNOWN',
      QueueName: ctr.Queue?.Name ?? 'N/A',
      ExpirationTime: this.computeExpiration(timestampMs),
    };
  }

  /**
   * Process a single CTR event: validate, map, and persist. Returns true when the
   * record was written, false when it was intentionally skipped.
   */
  async ProcessCTREvent(ctr: ContactTraceRecord): Promise<boolean> {
    if (!this.isProcessable(ctr)) {
      logger.debug('Skipping non-processable CTR', { contactId: ctr?.ContactId });
      return false;
    }

    const item = this.mapToItem(ctr);
    await getDocClient().send(
      new PutCommand({ TableName: getTableName(), Item: item })
    );
    logger.info('Stored contact history item', {
      pk: item.pk,
      contactId: item.ContactId,
      initiationMethod: item.InitiationMethod,
    });
    return true;
  }

  /**
   * The Amazon Connect user id is the last segment of the agent ARN
   * (".../agent/<userId>"). Fall back to Username when no ARN is present.
   */
  private extractUserId(arn?: string | null, username?: string | null): string | undefined {
    if (arn) {
      const last = arn.split('/').pop();
      if (last) return last;
    }
    return username ?? undefined;
  }

  private toEpochMs(value?: string | null): number | undefined {
    if (!value) return undefined;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? undefined : ms;
  }

  private computeExpiration(timestampMs: number): number {
    const ttlSeconds = this.ttlHours * 60 * 60;
    return Math.floor(timestampMs / 1000) + ttlSeconds;
  }
}
