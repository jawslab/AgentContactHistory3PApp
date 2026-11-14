import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CtrProcessor, parseAllowedChannels } from '../src/ctr-processor/ctr-processor';
import { __setDocClient } from '../src/shared/dynamo';
import { ContactTraceRecord } from '../src/shared/types';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeAll(() => {
  process.env.TABLE_NAME = 'TestTable';
});

beforeEach(() => {
  ddbMock.reset();
  // Inject the mocked document client into the shared module.
  __setDocClient(ddbMock as unknown as DynamoDBDocumentClient);
});

afterAll(() => {
  __setDocClient(undefined);
});

function inboundCtr(overrides: Partial<ContactTraceRecord> = {}): ContactTraceRecord {
  return {
    ContactId: 'contact-123',
    InitiationMethod: 'INBOUND',
    Channel: 'VOICE',
    InitiationTimestamp: '2025-08-14T10:00:00Z',
    DisconnectTimestamp: '2025-08-14T10:05:30Z',
    DisconnectReason: 'CUSTOMER_DISCONNECT',
    CustomerEndpoint: { Address: '+15555550100', Type: 'TELEPHONE_NUMBER' },
    Queue: { Name: 'Support', ARN: 'arn:aws:connect:us-east-1:111:instance/abc/queue/q1' },
    Agent: {
      ARN: 'arn:aws:connect:us-east-1:111:instance/abc/agent/agent-xyz',
      Username: 'jdoe',
      AgentInteractionDuration: 300,
    },
    ...overrides,
  };
}

describe('CtrProcessor.isProcessable', () => {
  const p = new CtrProcessor(24);

  it('accepts a completed voice contact handled by an agent', () => {
    expect(p.isProcessable(inboundCtr())).toBe(true);
  });

  it('rejects a CTR with no agent', () => {
    expect(p.isProcessable(inboundCtr({ Agent: null }))).toBe(false);
  });

  it('rejects a non-voice channel', () => {
    expect(p.isProcessable(inboundCtr({ Channel: 'CHAT' }))).toBe(false);
  });

  it('rejects a contact that has not disconnected', () => {
    expect(p.isProcessable(inboundCtr({ DisconnectTimestamp: null }))).toBe(false);
  });

  it('rejects a record missing a ContactId', () => {
    expect(p.isProcessable(inboundCtr({ ContactId: undefined }))).toBe(false);
  });

  it('rejects null / non-object input', () => {
    expect(p.isProcessable(null as unknown as ContactTraceRecord)).toBe(false);
  });

  it('treats a missing channel as voice', () => {
    expect(p.isProcessable(inboundCtr({ Channel: undefined }))).toBe(true);
  });
});

describe('CtrProcessor allowed channels', () => {
  const p = new CtrProcessor(24, ['VOICE', 'CHAT']);

  it('accepts CHAT when it is allowed', () => {
    expect(p.isProcessable(inboundCtr({ Channel: 'CHAT' }))).toBe(true);
  });

  it('still accepts VOICE when CHAT is also allowed', () => {
    expect(p.isProcessable(inboundCtr())).toBe(true);
  });

  it('rejects a channel outside the allowed list', () => {
    expect(p.isProcessable(inboundCtr({ Channel: 'TASK' }))).toBe(false);
  });

  it('stores the channel on the item', () => {
    expect(p.mapToItem(inboundCtr({ Channel: 'chat' })).Channel).toBe('CHAT');
    expect(p.mapToItem(inboundCtr({ Channel: undefined })).Channel).toBe('VOICE');
  });
});

describe('parseAllowedChannels', () => {
  it('ignores spaces, case, and empty entries', () => {
    expect(parseAllowedChannels(' voice , Chat ,, ')).toEqual(['VOICE', 'CHAT']);
  });

  it('defaults to VOICE when unset or empty', () => {
    expect(parseAllowedChannels(undefined)).toEqual(['VOICE']);
    expect(parseAllowedChannels('')).toEqual(['VOICE']);
  });
});

describe('CtrProcessor.mapToItem', () => {
  const p = new CtrProcessor(24);

  it('maps CTR fields into the DynamoDB item shape', () => {
    const item = p.mapToItem(inboundCtr());
    expect(item.pk).toBe('agent-xyz'); // parsed from agent ARN
    expect(item.sk).toBe(Date.parse('2025-08-14T10:05:30Z'));
    expect(item.ContactId).toBe('contact-123');
    expect(item.CustomerEndpointAddress).toBe('+15555550100');
    expect(item.AgentInteractionDuration).toBe(300);
    expect(item.DisconnectReason).toBe('CUSTOMER_DISCONNECT');
    expect(item.InitiationMethod).toBe('INBOUND');
    expect(item.QueueName).toBe('Support');
  });

  it('computes a TTL that is ttlHours after the disconnect time', () => {
    const item = p.mapToItem(inboundCtr());
    const expected = Math.floor(Date.parse('2025-08-14T10:05:30Z') / 1000) + 24 * 3600;
    expect(item.ExpirationTime).toBe(expected);
  });

  it('falls back to Username when no ARN is present', () => {
    const item = p.mapToItem(
      inboundCtr({ Agent: { Username: 'jdoe', AgentInteractionDuration: 10 } })
    );
    expect(item.pk).toBe('jdoe');
  });

  it('uses system endpoint for outbound calls when customer endpoint is absent', () => {
    const item = p.mapToItem(
      inboundCtr({
        InitiationMethod: 'OUTBOUND',
        CustomerEndpoint: null,
        SystemEndpoint: { Address: '+15555559999', Type: 'TELEPHONE_NUMBER' },
      })
    );
    expect(item.CustomerEndpointAddress).toBe('+15555559999');
    expect(item.InitiationMethod).toBe('OUTBOUND');
  });
});

describe('CtrProcessor.ProcessCTREvent', () => {
  it('writes a processable contact to DynamoDB', async () => {
    const p = new CtrProcessor(24);
    const stored = await p.ProcessCTREvent(inboundCtr());
    expect(stored).toBe(true);
    expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 1);
    expect(ddbMock).toHaveReceivedCommandWith(PutCommand, {
      TableName: 'TestTable',
      Item: expect.objectContaining({ pk: 'agent-xyz', ContactId: 'contact-123' }),
    });
  });

  it('skips a non-processable contact without calling DynamoDB', async () => {
    const p = new CtrProcessor(24);
    const stored = await p.ProcessCTREvent(inboundCtr({ Agent: null }));
    expect(stored).toBe(false);
    expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 0);
  });
});
