import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { AgentConfig } from '../config';
import {
  installServerRequestSchema,
  pluginSchema,
  serverActionRequestSchema,
  sendCommandRequestSchema,
  type HealthResponse,
} from '@mojito/contract';
import { runInstall } from '../runner';
import { fromInstallRequest } from '../process/system-vars';
import { ProcessRegistry, PowerActionError } from '../process/registry';
import { ServerStore } from '../process/store';
import { toPanelStatus } from '../process/states';

const startTime = Date.now();

/**
 * Hash SHA-256 du token pour comparaison en temps constant.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Vérifie le Bearer token de la requête en temps constant.
 */
function isAuthorized(request: FastifyRequest, expectedTokenHash: string): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  const token = header.slice(7);
  const tokenHash = hashToken(token);
  const a = Buffer.from(tokenHash, 'hex');
  const b = Buffer.from(expectedTokenHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Mappe les erreurs du registry en réponses HTTP. */
function powerErrorReply(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof PowerActionError) {
    const code = err.code === 'not_found' ? 404 : 409;
    return reply.code(code).send({ error: err.message, code: err.code });
  }
  return reply.code(500).send({ error: 'Erreur interne' });
}

/**
 * Construit l'instance Fastify de l'agent.
 * - /health est public (healthcheck)
 * - Toutes les autres routes nécessitent `Authorization: Bearer <token>`
 */
export function createAgentServer(config: AgentConfig): FastifyInstance {
  const app = Fastify({ logger: true });
  const expectedTokenHash = hashToken(config.token);

  const store = new ServerStore(config.dataDir);
  const registry = new ProcessRegistry({ store });

  // ─── Healthcheck (public) ──────────────────────────────────────────────────
  app.get('/health', async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
      version: config.version,
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    };
  });

  // ─── Hook d'authentification (sauf /health) ────────────────────────────────
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url === '/health') return;
    if (!isAuthorized(request, expectedTokenHash)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // ─── Installation d'un serveur (runner d'étapes du plugin) ─────────────────
  app.post('/servers/install', async (request, reply) => {
    const parsed = installServerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Requête invalide',
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }

    const pluginResult = pluginSchema.safeParse(parsed.data.plugin);
    if (!pluginResult.success) {
      return reply.code(400).send({
        error: 'Plugin invalide',
        details: pluginResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }

    const result = await runInstall({
      plugin: pluginResult.data,
      variables: parsed.data.variables,
      systemVariables: fromInstallRequest(parsed.data),
      installDir: parsed.data.installDir,
      // Progression temps réel via WS : phase 3. Pour l'instant, l'appel est synchrone.
    });

    if (!result.success) {
      return reply.code(422).send({ error: result.error });
    }

    // Persister le serveur installé → start n'a besoin que du serverId
    await store.save({
      serverId: parsed.data.serverId,
      name: parsed.data.name,
      plugin: pluginResult.data,
      variables: parsed.data.variables,
      installDir: parsed.data.installDir,
      allocation: parsed.data.allocation,
      installedAt: new Date().toISOString(),
    });

    return {
      serverId: parsed.data.serverId,
      status: 'stopped',
      message: 'Installation terminée',
    };
  });

  // ─── Liste des serveurs installés ──────────────────────────────────────────
  app.get('/servers', async () => {
    const stored = await store.list();
    return {
      servers: stored.map((s) => ({
        serverId: s.serverId,
        name: s.name,
        status: toPanelStatus(registry.getState(s.serverId), false),
      })),
    };
  });

  // ─── Info d'un serveur (état runtime réel + logs récents) ───────────────────
  app.get<{ Params: { serverId: string } }>('/servers/:serverId', async (request, reply) => {
    const stored = await store.get(request.params.serverId);
    if (!stored) {
      return reply.code(404).send({ error: 'Serveur inconnu', code: 'not_found' });
    }

    const state = registry.getState(request.params.serverId);
    return {
      serverId: stored.serverId,
      name: stored.name,
      status: toPanelStatus(state, false),
      runtimeState: state,
      pid: null, // métriques en phase 2
      ramMb: null,
      cpuPercent: null,
      startedAt: null,
      logs: registry.getLogs(request.params.serverId).slice(-50),
    };
  });

  // ─── Action power (start/stop/restart/kill) ────────────────────────────────
  app.post<{ Params: { serverId: string } }>(
    '/servers/:serverId/action',
    async (request, reply) => {
      const parsed = serverActionRequestSchema.safeParse({
        serverId: request.params.serverId,
        ...(request.body as object),
      });
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Requête invalide',
          details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }

      try {
        await registry.handlePowerAction(parsed.data.serverId, parsed.data.action);
        return {
          serverId: parsed.data.serverId,
          action: parsed.data.action,
          status: toPanelStatus(registry.getState(parsed.data.serverId), false),
        };
      } catch (err) {
        return powerErrorReply(err, reply);
      }
    },
  );

  // ─── Suppression d'un serveur (cleanup complet) ────────────────────────────
  app.delete<{ Params: { serverId: string } }>(
    '/servers/:serverId',
    async (request, reply) => {
      const { serverId } = request.params;
      const stored = await store.get(serverId);
      if (!stored) {
        return reply.code(404).send({ error: 'Serveur inconnu', code: 'not_found' });
      }

      // Refuser si le process tourne — le panel doit stop/kill d'abord
      if (registry.isRunning(serverId)) {
        return reply.code(409).send({
          error: 'Le serveur est en cours d’exécution',
          code: 'already_running',
        });
      }

      registry.forget(serverId);
      await store.delete(serverId);

      // Suppression du dossier — uniquement s'il est sous le dataDir de l'agent
      // (garde anti-suppression accidentelle d'un chemin hors de notre périmètre)
      const normalizedDataDir = resolve(config.dataDir);
      const normalizedInstallDir = resolve(stored.installDir);
      let removed = false;
      if (
        normalizedInstallDir === normalizedDataDir ||
        normalizedInstallDir.startsWith(normalizedDataDir + sep)
      ) {
        await rm(stored.installDir, { recursive: true, force: true });
        removed = true;
      }

      return { serverId, removed, installDir: stored.installDir };
    },
  );

  // ─── Commande console (stdin) ───────────────────────────────────────────────
  app.post<{ Params: { serverId: string } }>(
    '/servers/:serverId/command',
    async (request, reply) => {
      const parsed = sendCommandRequestSchema.safeParse({
        serverId: request.params.serverId,
        ...(request.body as object),
      });
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Requête invalide',
          details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }

      try {
        const sent = await registry.sendCommand(parsed.data.serverId, parsed.data.command);
        if (!sent) {
          return reply.code(409).send({
            error: 'Le serveur n’est pas en cours d’exécution',
            code: 'not_running',
          });
        }
        return { serverId: parsed.data.serverId, sent: true };
      } catch (err) {
        return powerErrorReply(err, reply);
      }
    },
  );

  return app;
}
