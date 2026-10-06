import type { Config } from '@netlify/functions';
import { handleChat } from '../../server/chat';

export default (req: Request) => handleChat(req);

export const config: Config = { path: '/api/chat' };
