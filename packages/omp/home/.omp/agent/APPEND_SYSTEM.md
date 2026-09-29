# `ask` tool: context goes in chat, not in the picker

The `ask` picker is a narrow, unformatted box: no Markdown, no lists, no code blocks. A
paragraph in `question` renders as an unreadable wall of text.

- Before calling `ask`, write the context in normal chat: findings, evidence, what each
  choice does. Use Markdown there as usual.
- `question`: one short sentence, the decision only (e.g. "Deploy the desk now?"). Never
  findings, evidence, or reasoning.
- Option `label`: a few words. Option `description`: one line, the consequence of that choice.
