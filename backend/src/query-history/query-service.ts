import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, getTableName } from '../shared/dynamo';
import { ContactHistoryItem, ContactRecordDto } from '../shared/types';

export interface QueryOptions {
  /** Only return contacts at/after this epoch-ms timestamp. */
  sinceMs?: number;
  /** Max number of records to return (newest first). Defaults to 100. */
  limit?: number;
}

/** Start of "today" in UTC as epoch ms. */
export function startOfTodayMs(now: number = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export class QueryService {
  /**
   * Query all contact history rows for a given Connect user id. By default bounds the
   * query to the start of the current UTC day and returns newest-first.
   */
  async getContactHistory(
    agentId: string,
    options: QueryOptions = {}
  ): Promise<ContactRecordDto[]> {
    if (!agentId || !agentId.trim()) {
      throw new ValidationError('agentId is required');
    }

    const since = options.sinceMs ?? startOfTodayMs();
    const limit = options.limit ?? 100;

    const result = await getDocClient().send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: 'pk = :pk AND sk >= :since',
        ExpressionAttributeValues: { ':pk': agentId, ':since': since },
        // Newest first.
        ScanIndexForward: false,
        Limit: limit,
      })
    );

    const items = (result.Items ?? []) as ContactHistoryItem[];
    return items.map(toDto);
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function toDto(item: ContactHistoryItem): ContactRecordDto {
  return {
    ContactId: item.ContactId,
    CustomerEndpointAddress: item.CustomerEndpointAddress,
    AgentInteractionDuration: item.AgentInteractionDuration,
    DisconnectReason: item.DisconnectReason,
    InitiationMethod: item.InitiationMethod,
    QueueName: item.QueueName,
    // Items written before Channel was stored were voice-only.
    Channel: item.Channel ?? 'VOICE',
    Timestamp: new Date(item.sk).toISOString(),
  };
}
