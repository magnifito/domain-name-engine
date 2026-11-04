/** Prefix of the env names .mcp.json uses for values from the Claude Code plugin settings form. */
export const USER_CONFIG_PREFIX = 'USER_CONFIG_';

function readOne(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value && !value.startsWith('${') ? value : undefined;
}

/**
 * Reads one setting. The plugin settings form value (USER_CONFIG_<NAME>) wins over the plain
 * env variable <NAME>. Each counts as unset when it is missing, blank, or an unexpanded
 * "${...}" placeholder (what a host passes when it does not substitute the reference).
 */
export function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return readOne(env, `${USER_CONFIG_PREFIX}${name}`) ?? readOne(env, name);
}
