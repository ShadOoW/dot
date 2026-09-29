# `ask` tool: explain in reply text, then ask

The user sees two things: your reply text and the picker. Your reasoning is not shown. An
explanation you only planned in reasoning ("I'll lay out the steps first") was never sent.

- In the same response as the `ask` call, before it, write the explanation as reply text:
  findings, what each choice does, and every command or step the user must run, in code
  blocks.
- If this response has no reply text yet, you have explained nothing. Write it first.
- The picker is a narrow, unformatted box. `question`: one short sentence naming the
  decision. Option `label`: a few words. `description`: one line, the consequence.
- A question asking the user to do something ("paste the outputs") is only valid if the
  steps are in the reply text above it.
