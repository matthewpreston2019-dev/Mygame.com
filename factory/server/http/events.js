// Server-Sent Events: the server pushes live updates, so the browser never polls.
const clients = new Set();

export function subscribe(req, res, snapshot) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
  // A comment every 25s keeps proxies (and phones) from closing an idle connection.
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);
  clients.add(res);
  req.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(res);
  });
}

export function emit(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

export const clientCount = () => clients.size;
