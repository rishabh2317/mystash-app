/** React Native's installed AbortSignal has no static timeout() method. */
export async function withRequestTimeout<T>(milliseconds: number, request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try { return await request(controller.signal); }
  finally { clearTimeout(timer); }
}
