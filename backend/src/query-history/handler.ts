import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { QueryService, ValidationError } from './query-service';
import { logger } from '../shared/logger';

const CORS_ORIGIN = process.env.CORS_ALLOW_ORIGIN ?? '*';

function response(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

/**
 * HTTP API Lambda: GET /contact-history?agentId=<id>&since=<epochMs>
 * Returns { contacts: ContactRecordDto[] }.
 */
export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const params = event.queryStringParameters ?? {};
  const agentId = (params.agentId ?? '').trim();
  const sinceRaw = params.since;

  try {
    if (!agentId) {
      return response(400, { message: 'Missing required query parameter: agentId' });
    }

    const sinceMs = sinceRaw !== undefined ? Number(sinceRaw) : undefined;
    if (sinceMs !== undefined && Number.isNaN(sinceMs)) {
      return response(400, { message: 'Query parameter "since" must be a number (epoch ms)' });
    }

    const service = new QueryService();
    const contacts = await service.getContactHistory(agentId, { sinceMs });

    logger.info('Returned contact history', { agentId, count: contacts.length });
    return response(200, { contacts });
  } catch (err) {
    if (err instanceof ValidationError) {
      return response(400, { message: err.message });
    }
    logger.error('Failed to query contact history', {
      agentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return response(500, { message: 'Internal server error' });
  }
};
