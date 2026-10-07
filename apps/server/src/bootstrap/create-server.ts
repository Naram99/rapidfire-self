import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import express from 'express';
import type { Router } from 'express';
import { Server } from 'socket.io';
import type { GameService } from '../application/game-service.js';
import { bindGameSocket } from '../transport/socket.js';
import type { Authenticate, GameSocketServer } from '../transport/socket.js';

export function createGameServer(
  options: Readonly<{
    service: GameService;
    authenticate: Authenticate;
    allowedOrigins: readonly string[];
    webRoot?: string;
    api?: Router;
  }>,
) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/api/health', (_request, response) =>
    response.json({ status: 'ok' }),
  );
  if (options.api) app.use(options.api);
  app.use('/api', (_request, response) =>
    response.status(404).json({ code: 'NOT_FOUND' }),
  );
  app.use('/socket.io', (_request, response) =>
    response.status(404).json({ code: 'NOT_FOUND' }),
  );
  if (options.webRoot) {
    const webRoot = options.webRoot;
    if (!existsSync(`${webRoot}/index.html`))
      throw new Error('Frontend build missing; run npm run build first');
    app.use(express.static(webRoot));
    app.get('/{*path}', (_request, response) =>
      response.sendFile(`${webRoot}/index.html`),
    );
  }
  const httpServer = createServer(app);
  const io: GameSocketServer = new Server(httpServer, {
    maxHttpBufferSize: 16_384,
    allowRequest: (request, allow) => {
      const origin = request.headers.origin;
      allow(
        null,
        origin === undefined || options.allowedOrigins.includes(origin),
      );
    },
  });
  bindGameSocket(io, options.service, options.authenticate);
  return { app, httpServer, io };
}
