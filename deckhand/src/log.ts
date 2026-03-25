export function log(tag: string, ...args: unknown[]) {
  const ts = new Date().toISOString().slice(11, 23);
  console.error(`[${ts}] [${tag}]`, ...args);
}
