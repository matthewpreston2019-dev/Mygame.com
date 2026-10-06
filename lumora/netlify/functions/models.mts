import type { Config } from '@netlify/functions';
import { requireUser } from '../../server/auth';
import { errorResponse, json } from '../../server/http';
import { currentTierMap, getProviders, listModels } from '../../server/providers/registry';

// Lists models discovered live from each configured provider, plus the current tier mapping.
export default async (req: Request) => {
  try {
    await requireUser(req);
    const force = new URL(req.url).searchParams.get('refresh') === '1';
    const providers = await Promise.all(
      getProviders().map(async (p) => {
        const r = await listModels(p.id, force);
        return { id: p.id, label: p.label, kind: p.kind, models: r.models, error: r.error ? 'Could not load the live model list; showing defaults.' : undefined };
      }),
    );
    const tiers = await currentTierMap();
    return json({ providers, tiers });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = { path: '/api/models' };
