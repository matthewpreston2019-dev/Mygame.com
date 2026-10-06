// Heuristic request router used by AUTO mode. Runs on the server (and in tests).
// It is deliberately fast and deterministic; an optional LLM router can refine it.

import type { BuiltInModeId, ContentPart, ModelTier } from './types';

export interface RouteDecision {
  mode: BuiltInModeId;
  tier: Exclude<ModelTier, 'auto'>;
  needsVision: boolean;
  longContext: boolean;
  confidence: number;
  reason: string;
}

type Rule = { mode: BuiltInModeId; weight: number; re: RegExp };

// Multilingual keyword hints (EN, ES, FR, DE, PT, IT + a few CJK terms).
const RULES: Rule[] = [
  // Everyday lookups stay in General (weather, time, quick facts)
  { mode: 'general', weight: 4, re: /\b(weather|forecast|temperature (in|outside)|what time is it|time in)\b/i },
  // Coding
  { mode: 'coding', weight: 4, re: /```|\b(traceback|stack ?trace|segfault|exception|syntaxerror|typeerror|referenceerror|nullpointer|undefined is not|cannot read propert)/i },
  { mode: 'coding', weight: 3, re: /\b(code|coding|debug|bug|compile|refactor|function|method|class|regex|api|endpoint|sql|query|script|repo|git|npm|pip|docker|kubernetes|typescript|javascript|python|java|rust|golang|c\+\+|c#|php|ruby|kotlin|swift|react|vue|angular|node\.?js|django|flask|html|css|algorithm|unit test)\b/i },
  { mode: 'coding', weight: 2, re: /(?:^|[^\p{L}])(c[oó]digo|programa(r|ción)|depurar|fehler im code|programmier|programma|d[ée]boguer|programmation)/iu },
  { mode: 'coding', weight: 2, re: /(コード|バグ|プログラム|代码|编程|程序|错误)/ },
  { mode: 'coding', weight: 2, re: /\b(fix|error)\b.*\b(this|my)\b/i },
  // Research
  { mode: 'research', weight: 3, re: /\b(research|sources?|cite|citations?|studies|evidence|fact[- ]?check|latest|news|compare prices|best .{0,30}(to buy|for)|reviews?)\b/i },
  { mode: 'research', weight: 2, re: /(?:^|[^\p{L}])(investiga(r|ción)|fuentes|recherche|sources|recherch|forsch|quellen|pesquis|ricerca)/iu },
  { mode: 'research', weight: 2, re: /\b(20\d\d|today|this (week|year|month)|currently|current)\b/i },
  { mode: 'research', weight: 2, re: /(調べ|研究|调查|研究)/ },
  // Writing
  { mode: 'writing', weight: 3, re: /\b(write|draft|rewrite|rephrase|proofread|edit|email|e-mail|letter|essay|blog post|cover letter|linkedin|tweet|caption|newsletter|speech|script|translate|translation|tone)\b/i },
  { mode: 'writing', weight: 2, re: /(?:^|[^\p{L}])(escrib(e|ir)|redact|correo|carta|traduc|écri(re|s)|rédige|lettre|courriel|schreib|übersetz|brief|escrev|tradu|scrivi)/iu },
  { mode: 'writing', weight: 2, re: /(書いて|メール|翻訳|写一|翻译|邮件)/ },
  // Study
  { mode: 'study', weight: 3, re: /\b(explain|teach me|homework|exam|quiz|flashcards?|study|learn|lesson|understand|what is|how does|why does|definition|concept|step by step|solve)\b/i },
  { mode: 'study', weight: 2, re: /(?:^|[^\p{L}])(expl[ií]ca|ens[eé]ñame|tarea|examen|estudi|explique|apprendre|devoirs|erkl[äa]r|lernen|hausaufgabe|explica|aprender|spiega|studiare)/iu },
  { mode: 'study', weight: 2, re: /(説明|教えて|勉強|解释|学习|作业)/ },
  { mode: 'study', weight: 1, re: /(\$[^$]+\$|\b(integral|derivative|equation|theorem|photosynthesis|physics|chemistry|biology|history of)\b)/i },
  // Creative
  { mode: 'creative', weight: 3, re: /\b(brainstorm|ideas?|imagine|story|poem|lyrics|fiction|character|plot|game idea|app idea|business idea|startup|name for|names for|slogan|creative)\b/i },
  { mode: 'creative', weight: 2, re: /(?:^|[^\p{L}])(ideas|cuento|historia|poema|id[ée]es|histoire|po[eè]me|ideen|geschichte|gedicht|ideias|storia)/iu },
  { mode: 'creative', weight: 2, re: /(アイデア|物語|创意|故事|诗)/ },
  // Analysis
  { mode: 'analysis', weight: 3, re: /\b(analy[sz]e|analysis|summari[sz]e|summary|dataset|data|csv|spreadsheet|table|statistics|trend|outlier|compare|comparison|pros and cons|evaluate|assess|report|metrics)\b/i },
  { mode: 'analysis', weight: 2, re: /(?:^|[^\p{L}])(analiza|resum|analyse|résum|zusammenfass|auswert|analis|riassum)/iu },
  { mode: 'analysis', weight: 2, re: /(分析|要約|总结|数据)/ },
  // Planner
  { mode: 'planner', weight: 3, re: /\b(plan|planning|schedule|itinerary|trip|travel|agenda|routine|roadmap|timeline|goals?|to-?do|checklist|organi[sz]e|my week|my day|decide|decision|should i)\b/i },
  { mode: 'planner', weight: 2, re: /(?:^|[^\p{L}])(planifica|horario|viaje|itinerario|planifie|voyage|emploi du temps|planen|reise|zeitplan|planej|viagem|pianifica|viaggio)/iu },
  { mode: 'planner', weight: 2, re: /(計画|予定|旅行|计划|日程|旅行)/ },
];

const LONG_CONTEXT_CHARS = 120_000;

export function textOf(parts: ContentPart[]): string {
  return parts
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

export function routeRequest(parts: ContentPart[], historyChars = 0): RouteDecision {
  const text = textOf(parts);
  const files = parts.filter((p) => p.type === 'file') as Extract<ContentPart, { type: 'file' }>[];
  const images = parts.filter((p) => p.type === 'image');
  const scores = new Map<BuiltInModeId, number>();
  const add = (m: BuiltInModeId, w: number) => scores.set(m, (scores.get(m) ?? 0) + w);

  for (const rule of RULES) if (rule.re.test(text)) add(rule.mode, rule.weight);

  // Attachments are strong signals.
  const codeExt = /\.(js|jsx|ts|tsx|py|java|c|cpp|h|hpp|cs|go|rs|rb|php|swift|kt|scala|sh|sql|html|css|scss|vue|svelte|json|ya?ml|toml)$/i;
  for (const f of files) {
    if (codeExt.test(f.name)) add('coding', 3);
    else if (/\.(csv|xlsx|xls|tsv)$/i.test(f.name)) add('analysis', 4);
    else add('analysis', 2);
  }

  let mode: BuiltInModeId = 'general';
  let best = 0;
  for (const [m, s] of scores) {
    if (s > best) {
      best = s;
      mode = m;
    }
  }
  // Weak single signal stays General unless the message is very short and specific.
  if (best < 2) mode = 'general';

  const fileChars = files.reduce((n, f) => n + f.text.length, 0);
  const totalChars = text.length + fileChars + historyChars;
  const longContext = totalChars > LONG_CONTEXT_CHARS;
  const needsVision = images.length > 0;

  // Tier: short simple questions → fast; heavy reasoning/code → powerful.
  let tier: RouteDecision['tier'] = 'balanced';
  const complexity =
    (text.length > 1500 ? 2 : 0) +
    (fileChars > 20_000 ? 2 : 0) +
    (/```/.test(text) ? 1 : 0) +
    (/\b(architecture|design a|optimi[sz]e|prove|complex|in depth|detailed|thorough|step by step)\b/i.test(text) ? 1 : 0);
  if (mode === 'coding' || mode === 'analysis') tier = complexity >= 1 || best >= 5 ? 'powerful' : 'balanced';
  else if (complexity >= 3) tier = 'powerful';
  else if (mode === 'general' && text.length < 160 && files.length === 0 && images.length === 0) tier = 'fast';

  const confidence = best === 0 ? 0.3 : Math.min(0.95, 0.4 + best * 0.08);
  const reason =
    best === 0
      ? 'No specialised signals — using General'
      : `Matched ${mode} signals (score ${best})${needsVision ? ', image attached' : ''}${longContext ? ', long input' : ''}`;
  return { mode, tier, needsVision, longContext, confidence, reason };
}
