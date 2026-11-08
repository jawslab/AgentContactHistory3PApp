import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/**
 * Lazily-created, reused DynamoDB Document client.
 * Reusing the client across warm Lambda invocations avoids re-establishing connections.
 */
let docClient: DynamoDBDocumentClient | undefined;

export function getDocClient(): DynamoDBDocumentClient {
  if (!docClient) {
    const base = new DynamoDBClient({});
    docClient = DynamoDBDocumentClient.from(base, {
      marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false },
    });
  }
  return docClient;
}

/** Test-only hook to inject a mocked client. */
export function __setDocClient(client: DynamoDBDocumentClient | undefined): void {
  docClient = client;
}

export function getTableName(): string {
  const name = process.env.TABLE_NAME;
  if (!name) throw new Error('TABLE_NAME environment variable is not set');
  return name;
}
