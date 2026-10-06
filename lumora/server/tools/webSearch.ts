// Web search through a legitimate search API: Tavily, Brave Search API, or a SearXNG instance.
import type { Source } from '../../shared/types';
import { env } from '../env';
import { optNum, str, type ToolContext, type ToolDef } from './types';

export async function searchWeb(query: string, count: number, ctx: ToolContext): Promise<Source[]> {
  const provider = env.searchProvider;
  if (!provider) throw new Error('No search provider configured (set SEARCH_PROVIDER and SEARCH_API_KEY or SEARXNG_URL)');
  if (provider === 'tavily') {
    const key = env.searchKey;
    if (!key) throw new Error('SEARCH_API_KEY (Tavily) is missing');
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: count, search_depth: 'basic', include_answer: false }),
      signal: ctx.signal,
    });
    if (!res.ok) throw new Error(`Tavily search failed (${res.status})`);
    const data = (await res.json()) as { results?: { title: string; url: string; content?: string }[] };
    return (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content?.slice(0, 600) }));
  }
  if (provider === 'brave') {
    const key = env.searchKey;
    if (!key) throw new Error('SEARCH_API_KEY (Brave) is missing');
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': key },
      signal: ctx.signal,
    });
    if (!res.ok) throw new Error(`Brave search failed (${res.status})`);
    const data = (await res.json()) as { web?: { results?: { title: string; url: string; description?: string }[] } };
    return (data.web?.results ?? []).slice(0, count).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description?.replace(/<[^>]+>/g, '').slice(0, 600),
    }));
  }
  const base = env.searxngUrl;
  if (!base) throw new Error('SEARXNG_URL is missing');
  const res = await fetch(`${base.replace(/\/+$/, '')}/search?q=${encodeURIComponent(query)}&format=json`, {
    headers: { Accept: 'application/json' },
    signal: ctx.signal,
  });
  if (!res.ok) throw new Error(`SearXNG search failed (${res.status}). Is the JSON format enabled on the instance?`);
  const data = (await res.json()) as { results?: { title: string; url: string; content?: string }[] };
  return (data.results ?? []).slice(0, count).map((r) => ({ title: r.title, url: r.url, snippet: r.content?.slice(0, 600) }));
}

export const webSearchTool: ToolDef = {
  name: 'web_search',
  risk: 'safe',
  spec: {
    name: 'web_search',
    description:
      'Search the web for current information. Returns numbered results (title, URL, snippet). Cite results in your answer with their bracketed numbers, e.g. [1]. Use read_url to read a result in full when the snippet is not enough.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A focused search query' },
        count: { type: 'number', description: 'Number of results (1-10, default 5)' },
      },
      required: ['query'],
    },
  },
  async run(args, ctx) {
    const query = str(args.query, 'query', 400);
    const count = Math.min(10, Math.max(1, Math.round(optNum(args.count) ?? 5)));
    const results = await searchWeb(query, count, ctx);
    if (!results.length) return { content: `No results for "${query}".`, summary: `No results for "${query}"`, sources: [] };
    const start = ctx.sourceOffset;
    ctx.sourceOffset += results.length;
    const content = [
      `Search results for "${query}" (cite as [n]):`,
      ...results.map((r, i) => `[${start + i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet ?? ''}`),
    ].join('\n\n');
    return { content, summary: `Searched “${query}” · ${results.length} results`, sources: results };
  },
};
