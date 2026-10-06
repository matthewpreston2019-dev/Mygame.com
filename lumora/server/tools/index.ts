import type { ToolName } from '../../shared/types';
import { env } from '../env';
import { calculatorTool } from './calculator';
import { rememberTool, runCodeTool } from './clientTools';
import { dataAnalysisTool } from './dataAnalysis';
import { datetimeTool } from './datetime';
import { jsonTool } from './jsonTool';
import { readUrlTool } from './readUrl';
import type { ToolDef } from './types';
import { weatherTool } from './weather';
import { webSearchTool } from './webSearch';

export const TOOLS: Record<ToolName, ToolDef> = {
  web_search: webSearchTool,
  read_url: readUrlTool,
  calculator: calculatorTool,
  datetime: datetimeTool,
  weather: weatherTool,
  json_tool: jsonTool,
  data_analysis: dataAnalysisTool,
  run_code: runCodeTool,
  remember: rememberTool,
};

/** Whether a tool can actually work with the current configuration. */
export function toolAvailable(name: ToolName): boolean {
  if (name === 'web_search') return env.searchProvider !== null;
  return name in TOOLS;
}
