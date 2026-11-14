import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, getTableName } from '../shared/dynamo';
import { logger } from '../shared/logger';
import { ContactHistoryItem, ContactTraceRecord } from '../shared/types';

/** Channel assumed when a CTR has no Channel field (older/partial records). */
const DEFAULT_CHANNEL = 'VOICE';

/**
 * Parse a comma-separated channel list (e.g. "VOICE,CHAT") into upper-case values.
 * Falls back to VOICE only when the list is empty.
 */
export function parseAllowedChannels(raw?: string | null): string[] {
  const channels = (raw ?? '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => c.length > 0);
  return channels.length > 0 ? channels : [DEFAULT_CHANNEL];
}

export class CtrProcessor {
  private readonly allowedChannels: string[];

  constructor(
    private readonly ttlHours: number = Number(process.env.TTL_HOURS ?? 24),
    allowedChannels: string[] = parseAllowedChannels(process.env.ALLOWED_CHANNELS)
  ) {
    this.allowedChannels = allowedChannels.map((c) => c.toUpperCase());
  }

  /**
   * Decide whether a CTR represents a completed contact, on an allowed channel, that
   * was handled by an agent. Other channels, abandoned contacts, and queue callbacks
   * with no agent are skipped.
   */
  isProcessable(ctr: ContactTraceRecord): boolean {
    if (!ctr || typeof ctr !== 'object') return false;
    if (!ctr.ContactId) return false;
    // Only persist contacts that reached an agent.
    const agent = ctr.Agent;
    if (!agent || !(agent.ARN || agent.Username)) return false;
    // Only allowed channels (default VOICE, as in the blog). Treat a missing channel
    // as voice to stay permissive with partial records from older streams.
    if (!this.allowedChannels.includes(this.channelOf(ctr))) return false;
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
      Channel: this.channelOf(ctr),
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

  private channelOf(ctr: ContactTraceRecord): string {
    return (ctr.Channel ?? DEFAULT_CHANNEL).toUpperCase();
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
