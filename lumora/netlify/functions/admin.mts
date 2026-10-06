import type { Config } from '@netlify/functions';
import { authMode, requireUser } from '../../server/auth';
import { env } from '../../server/env';
import { errorResponse, HttpError, json } from '../../server/http';
import { getDailyUsage } from '../../server/limits';
import { recentEvents } from '../../server/logger';
import { currentTierMap, getProviders, listModels } from '../../server/providers/registry';

// Admin/debug data: provider health, model availability, usage, latency, errors and tool failures.
export default async (req: Request) => {
  try {
    const user = await requireUser(req);
    if (!user.isAdmin) throw new HttpError(403, 'forbidden', 'Admins only.');

    const providers = await Promise.all(
      getProviders().map(async (p) => {
        const t = Date.now();
        const r = await listModels(p.id, true);
        return { id: p.id, label: p.label, ok: !r.error, latencyMs: Date.now() - t, modelCount: r.models.length, error: r.error?.slice(0, 300) };
      }),
    );
    const events = await recentEvents(2, 300);
    const requests = events.filter((e) => e.kind === 'request');
    const latencies = requests.map((e) => e.latencyMs ?? 0).sort((a, b) => a - b);
    const pct = (p: number) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] : 0);

    return json({
      authMode: authMode(),
      search: { provider: env.searchProvider },
      transcription: !!env.transcriptionProvider,
      providers,
      tiers: await currentTierMap(),
      usageToday: await getDailyUsage(user.id),
      limits: {
        rateLimitPerMinute: env.rateLimitPerMinute,
        dailyRequestLimit: env.dailyRequestLimit,
        dailyTokenBudget: env.dailyTokenBudget,
        maxOutputTokens: env.maxOutputTokens,
        maxFileBytes: env.maxFileBytes,
        maxRequestBytes: env.maxRequestBytes,
        maxAgentSteps: env.maxAgentSteps,
        fallback: env.fallbackEnabled,
        router: env.routerStrategy,
      },
      stats: {
        requests: requests.length,
        errors: events.filter((e) => e.kind === 'error').length,
        toolFailures: events.filter((e) => e.kind === 'tool' && !e.ok).length,
        p50LatencyMs: pct(0.5),
        p95LatencyMs: pct(0.95),
        inputTokens: requests.reduce((n, e) => n + (e.inputTokens ?? 0), 0),
        outputTokens: requests.reduce((n, e) => n + (e.outputTokens ?? 0), 0),
      },
      events: events.slice(0, 150),
    });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = { path: '/api/admin' };
