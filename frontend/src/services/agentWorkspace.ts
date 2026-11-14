import { AmazonConnectApp } from '@amazon-connect/app';
import { AgentClient } from '@amazon-connect/contact';

/**
 * Initializes the Amazon Connect Customer SDK and exposes a helper to resolve the
 * current agent's Connect user id.
 *
 * The SDK must be initialized via `AmazonConnectApp.init()`. The returned `provider`
 * is then passed to `AgentClient`, which is the interface used to request agent data
 * such as the agent ARN. See the Connect Customer SDK Agent API docs.
 */
let agentClientPromise: Promise<AgentClient> | null = null;

function initAgentClient(): Promise<AgentClient> {
  return new Promise<AgentClient>((resolve, reject) => {
    try {
      // Resolve only once the workspace has connected (onCreate), so requests such as
      // getARN() are not sent before the handshake completes.
      const { provider } = AmazonConnectApp.init({
        onCreate: async () => {
          resolve(new AgentClient({ provider }));
        },
        onDestroy: async () => {
          agentClientPromise = null;
        },
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** Returns a memoized AgentClient so the SDK is initialized only once. */
export function getAgentClient(): Promise<AgentClient> {
  if (!agentClientPromise) {
    agentClientPromise = initAgentClient();
  }
  return agentClientPromise;
}

/**
 * The Amazon Connect user id is the final segment of the agent ARN
 * (e.g. "arn:aws:connect:...:instance/<inst>/agent/<userId>").
 */
export function parseAgentIdFromArn(arn: string): string {
  const id = arn.split('/').pop();
  if (!id) {
    throw new Error('Agent ID could not be parsed from ARN');
  }
  return id;
}

/** Resolves the current agent's Connect user id via the workspace SDK. */
export async function getAgentId(): Promise<string> {
  const client = await getAgentClient();
  const arn = await client.getARN();
  return parseAgentIdFromArn(arn);
}
