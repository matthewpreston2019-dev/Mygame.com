import type { ChatRequestBody, StreamEvent } from '@shared/types';
import { api, ApiError } from './api';

/** Calls /api/chat for one step and yields NDJSON events as they arrive. */
export async function* streamChat(body: ChatRequestBody, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const res = await api('/api/chat', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    signal,
  });
  if (!res.body) throw new ApiError(500, 'internal', 'Empty response from server', true);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawTerminal = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line) as StreamEvent;
        if (ev.type === 'done' || ev.type === 'error') sawTerminal = true;
        yield ev;
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!sawTerminal && !signal.aborted) {
    // The function was cut off (e.g. platform time limit) before finishing.
    yield { type: 'error', code: 'timeout', message: 'The response was interrupted before it finished. You can ask me to continue.', retryable: true };
  }
}
