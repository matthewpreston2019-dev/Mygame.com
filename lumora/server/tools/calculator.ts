import { all, create } from 'mathjs';
import { str, ToolInputError, type ToolDef } from './types';

// A locked-down mathjs instance (see mathjs "security" docs): no parsing/evaluation helpers,
// no unit creation, no huge matrix constructors.
const math = create(all, { number: 'number', precision: 64 });
const evaluate = math.evaluate.bind(math);
const blocked = (name: string) => () => {
  throw new Error(`Function ${name} is disabled`);
};
math.import(
  Object.fromEntries(
    ['import', 'createUnit', 'evaluate', 'parse', 'simplify', 'derivative', 'compile', 'resolve', 'reviver', 'zeros', 'ones', 'identity', 'range', 'matrixFromFunction'].map(
      (n) => [n, blocked(n)],
    ),
  ),
  { override: true },
);

export function calculate(expression: string): string {
  if (expression.length > 500) throw new ToolInputError('Expression too long');
  if (/\d\s*:\s*\d/.test(expression)) throw new ToolInputError('Range syntax is not supported');
  const result = evaluate(expression);
  if (typeof result === 'function') throw new ToolInputError('Expression did not produce a value');
  return math.format(result, { precision: 14 });
}

export const calculatorTool: ToolDef = {
  name: 'calculator',
  risk: 'safe',
  spec: {
    name: 'calculator',
    description:
      'Evaluate a mathematical expression exactly (arithmetic, powers, roots, trig, logs, statistics like mean/median/std, unit conversion like "5 km to mi", percentages). Use this instead of mental math for any non-trivial calculation.',
    parameters: {
      type: 'object',
      properties: { expression: { type: 'string', description: 'e.g. "sqrt(2) * 15^3", "12% * 340", "75 kg to lb"' } },
      required: ['expression'],
    },
  },
  async run(args) {
    const expression = str(args.expression, 'expression', 500);
    const value = calculate(expression);
    return { content: `${expression} = ${value}`, summary: `${expression} = ${value}` };
  },
};
