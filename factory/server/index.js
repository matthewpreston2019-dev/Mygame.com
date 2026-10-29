// AI Worker Factory — entry point.
import { config, isLoopback } from './config.js';
import { load, flush } from './core/store.js';
import { log } from './core/log.js';
import { seed } from './factory/world.js';
import { recover } from './factory/pool.js';
import { startScheduler } from './factory/scheduler.js';
import { createServer } from './http/server.js';
import { routes, status } from './http/routes.js';

if (!config.token && !isLoopback(config.host)) {
  console.error('Refusing to start: FACTORY_TOKEN must be set when HOST is not 127.0.0.1 (the factory would be open to anyone).');
  process.exit(1);
}

load();
seed();
recover();
startScheduler();

const server = createServer(routes);
server.listen(config.port, config.host, () => {
  const mode = status().ai;
  console.log(`AI Worker Factory → http://${isLoopback(config.host) ? 'localhost' : config.host}:${config.port}  (AI: ${mode})`);
  if (mode === 'offline') console.log('No ANTHROPIC_API_KEY set: workers cannot run. Add it to .env, or use `npm run demo`.');
  log.info('server.started', { ai: mode, port: config.port });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    flush();
    server.close();
    process.exit(0);
  });
}
