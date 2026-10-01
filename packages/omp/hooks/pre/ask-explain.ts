// Blocks an `ask` call whose assistant message carries no reply text.
//
// The user sees only reply text and the picker; reasoning is not shown. Sessions showed the
// model planning its explanation in reasoning, then sending the picker alone (13 of 27 ask
// calls after 2026-09-28). APPEND_SYSTEM.md states the rule; this makes the failure visible
// to the model instead of to the user.

type Block = { type: string; text?: string; id?: string };
type Message = { role?: string; content?: unknown };
type Api = {
  on(
    event: 'message_update' | 'message_end',
    handler: (event: { message: Message }) => void
  ): void;
  on(
    event: 'tool_call',
    handler: (event: {
      toolName: string;
      toolCallId: string;
    }) => { block: true; reason: string } | undefined
  ): void;
};

const MIN_TEXT = 20;

const REASON =
  'Blocked: this `ask` was sent with no reply text, so the user would see the picker alone. ' +
  'Your reasoning is not shown to the user. In your next response, write the explanation as ' +
  'reply text first (findings, what each choice does, any steps to run), then call `ask` ' +
  'again in that same response.';

export default function askNeedsText(pi: Api): void {
  const textLengthByCall = new Map<string, number>();

  // `tool_call` fires before `message_end`, so the streaming snapshots are the ones that
  // hold the finished tool call when the guard runs.
  const record = ({ message }: { message: Message }): void => {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) return;
    const blocks = message.content as Block[];
    if (!blocks.some((block) => block.type === 'toolCall')) return;
    const textLength = blocks
      .filter((block) => block.type === 'text')
      .reduce((sum, block) => sum + (block.text ?? '').trim().length, 0);
    for (const block of blocks) {
      if (block.type === 'toolCall' && block.id)
        textLengthByCall.set(block.id, textLength);
    }
  };
  pi.on('message_update', record);
  pi.on('message_end', record);

  pi.on('tool_call', ({ toolName, toolCallId }) => {
    if (toolName !== 'ask') return undefined;
    const textLength = textLengthByCall.get(toolCallId);
    textLengthByCall.delete(toolCallId);
    if (textLength === undefined || textLength >= MIN_TEXT) return undefined;
    return { block: true, reason: REASON };
  });
}
