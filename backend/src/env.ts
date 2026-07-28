/** Process env helper for Node (replaces Deno.env.get). */
export function getEnv(key: string): string | undefined {
  const v = process.env[key];
  return v === '' ? undefined : v;
}
