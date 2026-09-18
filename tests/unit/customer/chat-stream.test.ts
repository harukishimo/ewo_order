import { describe, expect, it } from 'vitest';
import { readChatStream } from '../../../src/components/customer/chat-stream';
import type { ChatStreamEvent } from '../../../src/contracts';

function response(text: string, split = 1) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split));
      controller.close();
    },
  }));
}
describe('chat transport recovery boundaries', () => {
  it('preserves Japanese characters across arbitrary byte boundaries and final line without newline', async () => {
    const events: ChatStreamEvent[] = [];
    await readChatStream(response('{"type":"delta","text":"絵はいかがですか？"}\n{"type":"done","consultation":{}}'), e => events.push(e));
    expect(events[0]).toEqual({ type: 'delta', text: '絵はいかがですか？' });
    expect(events[1].type).toBe('done');
  });
  it('does not treat partial generation as committed after network loss', async () => {
    await expect(readChatStream(response('{"type":"delta","text":"途中"}\n'), () => {})).rejects.toThrow('通信が途切れました');
  });
  it('propagates server errors inside a successful HTTP stream', async () => {
    await expect(readChatStream(response('{"type":"error","message":"再確認してください","retryable":true}\n'), () => {})).rejects.toThrow('再確認してください');
  });
  it('shows an authentication failure before opening the stream', async () => {
    const denied = Response.json({error:{message:'相談の所有権を確認してください'}}, {status:403});
    await expect(readChatStream(denied, () => {})).rejects.toThrow('相談の所有権を確認してください');
  });
});
