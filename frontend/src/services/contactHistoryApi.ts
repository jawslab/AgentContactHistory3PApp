import { ContactHistoryResponse, ContactRecord } from '../types';

const API_ENDPOINT = import.meta.env.VITE_API_ENDPOINT as string | undefined;

/**
 * Calls the API Gateway endpoint for the given agent id and returns the contact list.
 * Throws on network errors or non-2xx responses so the UI can show an error state.
 */
export async function fetchContactHistory(
  agentId: string,
  signal?: AbortSignal
): Promise<ContactRecord[]> {
  if (!API_ENDPOINT) {
    throw new Error('VITE_API_ENDPOINT is not configured');
  }

  const url = `${API_ENDPOINT}?agentId=${encodeURIComponent(agentId)}`;
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = (await response.json()) as ContactHistoryResponse;
  return data.contacts ?? [];
}
