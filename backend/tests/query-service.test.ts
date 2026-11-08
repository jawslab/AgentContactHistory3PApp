import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { QueryService, ValidationError, startOfTodayMs } from '../src/query-history/query-service';
import { handler } from '../src/query-history/handler';
import { __setDocClient } from '../src/shared/dynamo';
import { APIGatewayProxyEventV2 } from 'aws-lambda';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeAll(() => {
  process.env.TABLE_NAME = 'TestTable';
});

beforeEach(() => {
  ddbMock.reset();
  __setDocClient(ddbMock as unknown as DynamoDBDocumentClient);
});

afterAll(() => __setDocClient(undefined));

const sampleItem = {
  pk: 'agent-1',
  sk: Date.parse('2025-08-14T10:05:30Z'),
  ContactId: 'c-1',
  CustomerEndpointAddress: '+15555550100',
  AgentInteractionDuration: 120,
  DisconnectReason: 'CUSTOMER_DISCONNECT',
  InitiationMethod: 'INBOUND',
  QueueName: 'Support',
  ExpirationTime: 1,
};

describe('QueryService', () => {
  it('returns mapped DTOs for an agent with history', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [sampleItem] });
    const service = new QueryService();
    const result = await service.getContactHistory('agent-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      ContactId: 'c-1',
      CustomerEndpointAddress: '+15555550100',
      AgentInteractionDuration: 120,
      DisconnectReason: 'CUSTOMER_DISCONNECT',
      InitiationMethod: 'INBOUND',
      QueueName: 'Support',
      Timestamp: '2025-08-14T10:05:30.000Z',
    });
  });

  it('returns an empty array for an agent with no data', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const service = new QueryService();
    await expect(service.getContactHistory('agent-empty')).resolves.toEqual([]);
  });

  it('throws ValidationError for an invalid (empty) agent id', async () => {
    const service = new QueryService();
    await expect(service.getContactHistory('   ')).rejects.toBeInstanceOf(ValidationError);
    expect(ddbMock).toHaveReceivedCommandTimes(QueryCommand, 0);
  });

  it('bounds the query to the start of the current day by default', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const service = new QueryService();
    await service.getContactHistory('agent-1');
    expect(ddbMock).toHaveReceivedCommandWith(QueryCommand, {
      TableName: 'TestTable',
      ExpressionAttributeValues: expect.objectContaining({ ':since': startOfTodayMs() }),
      ScanIndexForward: false,
    });
  });
});

describe('query-history handler', () => {
  function event(qs: Record<string, string> | undefined): APIGatewayProxyEventV2 {
    return { queryStringParameters: qs } as unknown as APIGatewayProxyEventV2;
  }

  it('returns 200 with contacts for a valid agentId', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [sampleItem] });
    const res = (await handler(event({ agentId: 'agent-1' }))) as {
      statusCode: number;
      body: string;
    };
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).contacts).toHaveLength(1);
  });

  it('returns 400 when agentId is missing', async () => {
    const res = (await handler(event(undefined))) as { statusCode: number };
    expect(res.statusCode).toBe(400);
    expect(ddbMock).toHaveReceivedCommandTimes(QueryCommand, 0);
  });

  it('returns 400 when "since" is not a number', async () => {
    const res = (await handler(event({ agentId: 'a', since: 'abc' }))) as {
      statusCode: number;
    };
    expect(res.statusCode).toBe(400);
  });

  it('returns 500 when DynamoDB fails', async () => {
    ddbMock.on(QueryCommand).rejects(new Error('boom'));
    const res = (await handler(event({ agentId: 'agent-1' }))) as { statusCode: number };
    expect(res.statusCode).toBe(500);
  });
});
