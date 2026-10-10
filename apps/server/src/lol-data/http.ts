import express from 'express';
import { lolImportRequestSchema } from '@rapidfire/contracts';
import type { AuthBridge } from '../auth/bridge.js';
import type { LolImporter } from './importer.js';
import type { LolRepository } from './repository.js';

export function createLolAdminRouter(
  bridge: AuthBridge,
  repository: LolRepository,
  importer: LolImporter,
) {
  const router = express.Router();
  router.get('/api/admin/access', async (request, response) => {
    const { access } = await bridge.normal(request.headers);
    response.json({
      isAdmin: access ? await repository.isAdmin(access.person.id) : false,
    });
  });
  router.use('/api/admin/lol-data', async (request, response, next) => {
    const { access } = await bridge.normal(request.headers);
    if (!access) {
      response.status(401).json({ code: 'AUTH_REQUIRED' });
      return;
    }
    if (!(await repository.isAdmin(access.person.id))) {
      response.status(403).json({ code: 'FORBIDDEN' });
      return;
    }
    response.locals.adminUserId = access.person.id;
    next();
  });
  router.get('/api/admin/lol-data', async (_request, response) => {
    response.json(await repository.overview());
  });
  router.post(
    '/api/admin/lol-data/imports',
    express.json({ limit: '16kb', strict: true }),
    async (request, response) => {
      const body: unknown = request.body;
      const parsed = lolImportRequestSchema.safeParse(body);
      if (!parsed.success) {
        response.status(400).json({ code: 'INVALID_PAYLOAD' });
        return;
      }
      const adminUserId: unknown = response.locals.adminUserId;
      if (typeof adminUserId !== 'string') {
        response.status(401).json({ code: 'AUTH_REQUIRED' });
        return;
      }
      response
        .status(202)
        .json(await importer.start(adminUserId, parsed.data.mode));
    },
  );
  router.get(
    '/api/admin/lol-data/imports/:runId',
    async (request, response) => {
      const id = request.params.runId;
      if (
        typeof id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        )
      ) {
        response.status(400).json({ code: 'INVALID_PAYLOAD' });
        return;
      }
      const run = await repository.run(id);
      if (!run) {
        response.status(404).json({ code: 'NOT_FOUND' });
        return;
      }
      response.json(run);
    },
  );
  return router;
}
