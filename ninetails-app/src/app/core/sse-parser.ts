export interface SseMessage {
  event: string; // 'message' when the server sends no `event:` line
  data: string;
  id?: string;
}

/**
 * Minimal Server-Sent Events parser (https://html.spec.whatwg.org/multipage/server-sent-events.html).
 * Feed it text chunks as they arrive; it returns the messages completed by each chunk.
 * We parse by hand because the browser's EventSource cannot send an Authorization header.
 * Comment lines (": ping" heartbeats) are ignored but still count as activity for the caller.
 */
export class SseParser {
  private buffer = '';

  push(chunk: string): SseMessage[] {
    this.buffer += chunk.replace(/\r\n?/g, '\n');
    const messages: SseMessage[] = [];

    let end: number;
    while ((end = this.buffer.indexOf('\n\n')) !== -1) {
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const msg = parseBlock(block);
      if (msg) messages.push(msg);
    }
    return messages;
  }
}

function parseBlock(block: string): SseMessage | null {
  let event = 'message';
  let id: string | undefined;
  const data: string[] = [];

  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue; // blank or comment
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    else if (field === 'id') id = value;
  }
  return data.length ? { event, data: data.join('\n'), id } : null;
}
