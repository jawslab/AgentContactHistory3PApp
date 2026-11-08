import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { KinesisStreamEvent } from 'aws-lambda';
import { handler } from '../src/ctr-processor/handler';
import { __setDocClient } from '../src/shared/dynamo';
import { ContactTraceRecord } from '../src/shared/types';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeAll(() => {
  process.env.TABLE_NAME = 'TestTable';
});

beforeEach(() => {
  ddbMock.reset();
  __setDocClient(ddbMock as unknown as DynamoDBDocumentClient);
});

afterAll(() => __setDocClient(undefined));

function kinesisRecord(payload: unknown) {
  return {
    kinesis: {
      data: Buffer.from(JSON.stringify(payload)).toString('base64'),
      sequenceNumber: 'seq-1',
      partitionKey: 'pk',
      approximateArrivalTimestamp: 1,
      kinesisSchemaVersion: '1.0',
    },
    eventSource: 'aws:kinesis',
    eventID: 'id',
    eventVersion: '1.0',
    eventName: 'aws:kinesis:record',
    invokeIdentityArn: 'arn',
    awsRegion: 'us-east-1',
    eventSourceARN: 'arn',
  };
}

function rawRecord(data: string) {
  return { ...kinesisRecord({}), kinesis: { ...kinesisRecord({}).kinesis, data } };
}

const validCtr: ContactTraceRecord = {
  ContactId: 'c-1',
  InitiationMethod: 'INBOUND',
  Channel: 'VOICE',
  DisconnectTimestamp: '2025-08-14T10:05:30Z',
  DisconnectReason: 'CUSTOMER_DISCONNECT',
  CustomerEndpoint: { Address: '+15555550100' },
  Queue: { Name: 'Support' },
  Agent: { ARN: 'arn:.../agent/agent-1', AgentInteractionDuration: 120 },
};

describe('ctr-processor handler', () => {
  it('processes a batch of valid CTR records', async () => {
    const event: KinesisStreamEvent = {
      Records: [kinesisRecord(validCtr), kinesisRecord({ ...validCtr, ContactId: 'c-2' })],
    };
    await handler(event, {} as never, () => undefined);
    expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 2);
  });

  it('catches malformed (non-JSON) records and keeps processing the rest', async () => {
    const event: KinesisStreamEvent = {
      Records: [
        rawRecord(Buffer.from('not-json{{{').toString('base64')),
        kinesisRecord(validCtr),
      ],
    };
    // Should not throw even though one record is malformed.
    await expect(handler(event, {} as never, () => undefined)).resolves.toBeUndefined();
    expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 1);
  });
});
