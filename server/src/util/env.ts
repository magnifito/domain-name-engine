/**
 * Reads one env variable. Returns undefined when it is unset, blank, or an unexpanded
 * "${VAR}" placeholder (what .mcp.json passes when the variable is not set).
 */
export function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value && !value.startsWith('${') ? value : undefined;
}
