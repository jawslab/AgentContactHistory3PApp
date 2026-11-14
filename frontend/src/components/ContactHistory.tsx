import React, { useCallback, useEffect, useState } from 'react';
import { getAgentId } from '../services/agentWorkspace';
import { fetchContactHistory } from '../services/contactHistoryApi';
import { ContactRecord } from '../types';
import { formatDuration, formatTimestamp } from '../utils/format';
import './ContactHistory.css';

type Status = 'loading' | 'ready' | 'error';

function initiationClass(method: string): string {
  const m = method.toUpperCase();
  if (m === 'INBOUND') return 'inbound';
  if (m === 'OUTBOUND') return 'outbound';
  return 'other';
}

const ContactHistory: React.FC = () => {
  const [records, setRecords] = useState<ContactRecord[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setStatus('loading');
    setError(null);
    try {
      const agentId = await getAgentId();
      const data = await fetchContactHistory(agentId, signal);
      if (signal?.aborted) return;
      setRecords(data);
      setStatus('ready');
    } catch (err) {
      if (signal?.aborted) return;
      // eslint-disable-next-line no-console
      console.error('Error fetching contact history:', err);
      setError('Failed to load contact history. Please try again later.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <div className="ch-container">
      <div className="ch-header">
        <h3 className="ch-title">Agent Contact History</h3>
        <button
          className="ch-refresh"
          onClick={() => void load()}
          disabled={status === 'loading'}
        >
          {status === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {status === 'error' && <div className="ch-state error">{error}</div>}
      {status === 'loading' && <div className="ch-state">Loading your recent contacts…</div>}

      {status === 'ready' && records.length === 0 && (
        <div className="ch-state">No recent contact history found.</div>
      )}

      {status === 'ready' && records.length > 0 && (
        <>
          <table className="ch-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Channel</th>
                <th>Customer Number</th>
                <th>Queue</th>
                <th>Duration</th>
                <th>Type</th>
                <th>Disconnect</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.ContactId}>
                  <td>{formatTimestamp(r.Timestamp)}</td>
                  <td>{r.Channel}</td>
                  <td>{r.CustomerEndpointAddress}</td>
                  <td>{r.QueueName}</td>
                  <td>{formatDuration(r.AgentInteractionDuration)}</td>
                  <td>
                    <span className={`ch-badge ${initiationClass(r.InitiationMethod)}`}>
                      {r.InitiationMethod}
                    </span>
                  </td>
                  <td>{r.DisconnectReason}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Card layout shown on narrow agent-workspace panels */}
          <div className="ch-cards">
            {records.map((r) => (
              <div className="ch-card" key={`card-${r.ContactId}`}>
                <div className="ch-card-row">
                  <strong>{r.CustomerEndpointAddress}</strong>
                  <span className={`ch-badge ${initiationClass(r.InitiationMethod)}`}>
                    {r.InitiationMethod}
                  </span>
                </div>
                <div className="ch-card-row">
                  <span className="ch-card-label">Time</span>
                  <span>{formatTimestamp(r.Timestamp)}</span>
                </div>
                <div className="ch-card-row">
                  <span className="ch-card-label">Channel</span>
                  <span>{r.Channel}</span>
                </div>
                <div className="ch-card-row">
                  <span className="ch-card-label">Queue</span>
                  <span>{r.QueueName}</span>
                </div>
                <div className="ch-card-row">
                  <span className="ch-card-label">Duration</span>
                  <span>{formatDuration(r.AgentInteractionDuration)}</span>
                </div>
                <div className="ch-card-row">
                  <span className="ch-card-label">Disconnect</span>
                  <span>{r.DisconnectReason}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default ContactHistory;
