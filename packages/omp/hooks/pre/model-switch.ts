// `/ss5`, `/so5`, `/sd4`: switch this session to Sonnet 5.5, Opus 5.5 or DeepSeek V4.1 Flash in
// one typed command.
//
// Why: a plan alternates designs (Opus) and builds (Sonnet) in fresh sessions, and the
// `/model` picker is the slow part of `/new` + switch. The built-in `/switch <id>` skips the
// picker but needs the full id. The model choice itself is the `plans` skill's rule
// ("Which model runs a session"); these commands only make it quick to follow.
//
// Each switch is for this session only (nothing is written to config.yml) and sets the house
// effort for that model; an argument overrides it (`/ss5 xhigh`). Sonnet keeps the Claude
// API's default, `high`. Opus is `high` too, one level above its API default (`medium`):
// the plans that went well ran their Opus designs at `high`, and moving builds to Sonnet is
// where the saving is meant to come from, not thinner designs. DeepSeek offers only
// low/high/max in omp's catalog; `high` is the middle one. Under `omp-claude` the deepseek
// provider is disabled, so `/sd4` reports that the model is unavailable.
//
// Loaded as an extension module from the hook directory (the package README, "Hooks"), so it
// has `registerCommand` and `setModel`.

import type { ExtensionAPI } from '@oh-my-pi/pi-coding-agent';

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
type Target = {
  command: string;
  name: string;
  selector: string;
  efforts: readonly Effort[];
  houseEffort: Effort;
};

const CLAUDE_EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const TARGETS: readonly Target[] = [
  {
    command: 'ss5',
    name: 'Sonnet 5.5',
    selector: 'anthropic/claude-sonnet-5-5',
    efforts: CLAUDE_EFFORTS,
    houseEffort: 'high',
  },
  {
    command: 'so5',
    name: 'Opus 5.5',
    selector: 'anthropic/claude-opus-5-5',
    efforts: CLAUDE_EFFORTS,
    houseEffort: 'high',
  },
  {
    command: 'sd4',
    name: 'DeepSeek V4.1 Flash',
    selector: 'deepseek/deepseek-flash',
    efforts: ['low', 'high', 'max'],
    houseEffort: 'high',
  },
];

export default function modelSwitch(pi: ExtensionAPI) {
  for (const target of TARGETS) {
    const accepted = target.efforts.join('|');
    pi.registerCommand(target.command, {
      description: `Switch this session to ${target.name} (optional effort: ${accepted})`,
      getArgumentCompletions: prefix =>
        target.efforts.filter(e => e.startsWith(prefix)).map(e => ({ value: e, label: e })),
      handler: async (args, ctx) => {
        const requested = args.trim();
        const effort = target.efforts.find(e => e === requested) ?? target.houseEffort;
        if (requested !== '' && effort !== requested) {
          ctx.ui.notify(`${target.name} takes effort ${accepted}, not "${requested}".`, 'error');
          return;
        }
        const model = ctx.models.resolve(target.selector);
        if (!model) {
          ctx.ui.notify(`${target.selector} is not available in this session.`, 'error');
          return;
        }
        if (!(await pi.setModel(model))) {
          ctx.ui.notify(`No credentials for ${target.selector}.`, 'error');
          return;
        }
        pi.setThinkingLevel(effort);
        ctx.ui.notify(`${target.name}, effort ${effort}, for this session.`, 'info');
      },
    });
  }
}
