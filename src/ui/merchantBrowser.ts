/** In-app merchant browser route — single reusable WebView surface. */
export function merchantBrowserPath(url: string, title?: string | null): string {
  const query = new URLSearchParams();
  query.set('url', url);
  if (title?.trim()) query.set('title', title.trim());
  return `/merchant-browser?${query.toString()}`;
}
