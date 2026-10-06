import type { BuiltInModeId, ModelTier, ToolName } from './types';

export interface ModeDef {
  id: BuiltInModeId;
  label: string;
  tagline: string;
  /** Name of a lucide icon, resolved in the UI. */
  icon: string;
  tier: Exclude<ModelTier, 'auto'>;
  temperature: number;
  tools: ToolName[];
  prompt: string;
  suggestions: string[];
}

const BASE_TOOLS: ToolName[] = ['calculator', 'datetime'];

export const MODES: Record<BuiltInModeId, ModeDef> = {
  general: {
    id: 'general',
    label: 'General',
    tagline: 'Everyday questions, ideas and writing',
    icon: 'Sparkles',
    tier: 'balanced',
    temperature: 0.7,
    tools: [...BASE_TOOLS, 'web_search', 'read_url', 'weather'],
    prompt:
      'You are a helpful, knowledgeable general assistant. Answer clearly and directly, lead with the answer, and use Markdown (headings, lists, tables) only when it improves readability. Ask a brief clarifying question only when a request is genuinely ambiguous.',
    suggestions: [
      'Explain how compound interest works with an example',
      'Give me 5 ideas for a relaxing weekend',
      'What should I consider when buying a used car?',
    ],
  },
  coding: {
    id: 'coding',
    label: 'Coding',
    tagline: 'Write, debug, refactor and explain code',
    icon: 'Code2',
    tier: 'powerful',
    temperature: 0.2,
    tools: [...BASE_TOOLS, 'run_code', 'web_search', 'read_url', 'json_tool'],
    prompt: [
      'You are an expert software engineer and pair programmer fluent in all mainstream languages and frameworks.',
      'When debugging: identify the root cause first, explain it briefly, then show the fix.',
      'When writing code: produce complete, runnable code in fenced blocks with the correct language tag. When creating or changing a whole file, start the block with a comment line naming the file path, e.g. `// file: src/app.ts`.',
      'Prefer idiomatic, secure, maintainable solutions; point out security issues and edge cases you notice.',
      'For large codebases, reason about structure before details and reference files by path.',
      'If a run_code tool is available you may use it to verify small Python or JavaScript snippets.',
    ].join(' '),
    suggestions: [
      'Fix this Python error: TypeError: unsupported operand type(s)',
      'Write a TypeScript debounce function with tests',
      'Explain the difference between async/await and promises',
    ],
  },
  research: {
    id: 'research',
    label: 'Research',
    tagline: 'Sourced, structured, fact-checked answers',
    icon: 'Search',
    tier: 'balanced',
    temperature: 0.3,
    tools: [...BASE_TOOLS, 'web_search', 'read_url'],
    prompt: [
      'You are a meticulous research assistant.',
      'When a web_search tool is available, search before answering questions about current events, products, prices, statistics or anything that may have changed, and read the most relevant pages when snippets are insufficient.',
      'Cite sources inline using bracketed numbers like [1] that match the numbered search results. Never invent sources, URLs or citations.',
      'Separate established facts from uncertainty, note disagreements between sources, and end with a short summary or recommendation when appropriate.',
      'If no search tool is available, say that your answer is based on training data that may be outdated.',
    ].join(' '),
    suggestions: [
      'Research the best laptops for programming this year',
      'Compare solar panels vs heat pumps for home energy savings',
      'What does current research say about intermittent fasting?',
    ],
  },
  writing: {
    id: 'writing',
    label: 'Writing',
    tagline: 'Emails, essays, stories, posts and translation',
    icon: 'PenLine',
    tier: 'balanced',
    temperature: 0.8,
    tools: [...BASE_TOOLS],
    prompt:
      'You are a skilled writer and editor. Match the requested tone, audience, length and format precisely. For rewrites, preserve meaning while improving clarity and flow. For translation, translate faithfully and naturally. Return the finished text first; add brief notes or alternatives only if useful.',
    suggestions: [
      'Write a professional email asking for a deadline extension',
      'Rewrite this paragraph to sound more confident',
      'Draft a LinkedIn post announcing my new job',
    ],
  },
  study: {
    id: 'study',
    label: 'Study',
    tagline: 'Learn step by step, quizzes and flashcards',
    icon: 'GraduationCap',
    tier: 'balanced',
    temperature: 0.4,
    tools: [...BASE_TOOLS, 'web_search'],
    prompt: [
      'You are a patient, encouraging tutor.',
      'Explain concepts step by step, starting from what the learner likely knows, using analogies and worked examples.',
      'For homework, guide the learner toward understanding rather than only giving answers; show the reasoning.',
      'When asked for quizzes, produce numbered questions with an answer key at the end. For flashcards use a two-column Markdown table (Front | Back).',
      'Use LaTeX ($...$ or $$...$$) for mathematics.',
    ].join(' '),
    suggestions: [
      'Explain photosynthesis like I am 12',
      'Make 10 flashcards about the French Revolution',
      'Quiz me on basic derivatives',
    ],
  },
  creative: {
    id: 'creative',
    label: 'Creative',
    tagline: 'Brainstorms, stories, games and ventures',
    icon: 'Lightbulb',
    tier: 'balanced',
    temperature: 1,
    tools: [...BASE_TOOLS, 'web_search'],
    prompt:
      'You are an imaginative creative partner. Generate bold, original and varied ideas, then help refine the most promising ones. Offer unexpected angles, concrete details and next steps. Avoid clichés unless asked.',
    suggestions: [
      'Brainstorm 10 unique mobile game concepts',
      'Help me name my coffee shop',
      'Pitch three startup ideas around sustainable fashion',
    ],
  },
  analysis: {
    id: 'analysis',
    label: 'Analysis',
    tagline: 'Documents, data, tables and reasoning',
    icon: 'BarChart3',
    tier: 'powerful',
    temperature: 0.2,
    tools: [...BASE_TOOLS, 'data_analysis', 'json_tool', 'run_code'],
    prompt: [
      'You are a rigorous analyst.',
      'Ground every claim in the provided documents or data and quote or reference the relevant parts.',
      'Structure your answer: key findings first, then supporting detail, assumptions and limitations.',
      'Use tables for comparisons. Use the data_analysis or calculator tools for numeric work instead of estimating.',
    ].join(' '),
    suggestions: [
      'Summarize the key points of the attached document',
      'Compare these two options in a table with pros and cons',
      'Find trends and outliers in the attached CSV',
    ],
  },
  planner: {
    id: 'planner',
    label: 'Planner',
    tagline: 'Projects, trips, schedules and decisions',
    icon: 'CalendarCheck',
    tier: 'balanced',
    temperature: 0.5,
    tools: [...BASE_TOOLS, 'weather', 'web_search'],
    prompt: [
      'You are an organised planning assistant.',
      'Break goals into concrete, ordered steps with time estimates, owners or deadlines where relevant.',
      'Use checklists (- [ ]) and tables for schedules. Consider constraints, risks and buffers.',
      'For decisions, lay out options, criteria and a clear recommendation.',
      'Use the datetime tool for current dates and the weather tool for travel plans when helpful.',
    ].join(' '),
    suggestions: [
      'Help me plan my week',
      'Plan a 4-day trip to Lisbon on a budget',
      'Break down launching a personal website into tasks',
    ],
  },
};

export const MODE_ORDER: BuiltInModeId[] = [
  'general',
  'coding',
  'research',
  'writing',
  'study',
  'creative',
  'analysis',
  'planner',
];

export const ALL_TOOLS: { name: ToolName; label: string; description: string; client: boolean; needsKey?: string }[] = [
  { name: 'web_search', label: 'Web search', description: 'Search the web through the configured search API', client: false, needsKey: 'search' },
  { name: 'read_url', label: 'Read web page', description: 'Fetch and read a public web page', client: false },
  { name: 'calculator', label: 'Calculator', description: 'Exact math evaluation', client: false },
  { name: 'datetime', label: 'Date & time', description: 'Current date/time and conversions', client: false },
  { name: 'weather', label: 'Weather', description: 'Forecasts via Open-Meteo (free, no key)', client: false },
  { name: 'json_tool', label: 'JSON tools', description: 'Validate, query and transform JSON', client: false },
  { name: 'data_analysis', label: 'Data analysis', description: 'Statistics on CSV/tabular data', client: false },
  { name: 'run_code', label: 'Run code', description: 'Run Python/JavaScript in a sandbox in your browser (asks first)', client: true },
  { name: 'remember', label: 'Memory', description: 'Lets the AI save useful facts about you (when memory is on)', client: true },
];

export const CLIENT_TOOLS: ToolName[] = ALL_TOOLS.filter((t) => t.client).map((t) => t.name);
