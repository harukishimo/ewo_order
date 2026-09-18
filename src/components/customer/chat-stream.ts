import type { ChatStreamEvent } from '@/contracts';

/** Parse incremental NDJSON, including UTF-8 and lines split across network chunks. */
export async function readChatStream(
  response: Response,
  onEvent: (event: ChatStreamEvent) => void,
) {
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? 'メッセージを送信できませんでした。');
  }
  if (!response.body) throw new Error('応答を受信できませんでした。もう一度送信してください。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  function line(value: string) {
    if (!value.trim()) return;
    const event = JSON.parse(value) as ChatStreamEvent;
    if (event.type === 'error') throw new Error(event.message);
    if (event.type === 'done') completed = true;
    onEvent(event);
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      if (done) break;
    }
    line(buffer);
    if (!completed) throw new Error('通信が途切れました。同じ内容を再送すると結果を確認できます。');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
