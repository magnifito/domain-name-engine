import budget from '../../data/rulesets/budget.json' with { type: 'json' };
import coined from '../../data/rulesets/coined.json' with { type: 'json' };
import compound from '../../data/rulesets/compound.json' with { type: 'json' };
import descriptive from '../../data/rulesets/descriptive.json' with { type: 'json' };
import devTool from '../../data/rulesets/dev-tool.json' with { type: 'json' };
import evocative from '../../data/rulesets/evocative.json' with { type: 'json' };
import localBusiness from '../../data/rulesets/local-business.json' with { type: 'json' };
import personal from '../../data/rulesets/personal.json' with { type: 'json' };
import premium from '../../data/rulesets/premium.json' with { type: 'json' };
import { type Ruleset, RulesetSchema } from './schema.js';

// JSON imports are bundled into dist/index.js, so plugin users need no data files at runtime.
const RAW: readonly unknown[] = [
  coined,
  descriptive,
  compound,
  evocative,
  premium,
  devTool,
  personal,
  localBusiness,
  budget,
];

/** Read-only built-in rulesets, validated once at load. */
export const BUILTIN_RULESETS: readonly Ruleset[] = RAW.map((raw) => RulesetSchema.parse(raw));

export const BUILTIN_IDS: ReadonlySet<string> = new Set(BUILTIN_RULESETS.map((r) => r.id));
