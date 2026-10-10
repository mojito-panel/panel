import { loadConfig } from './config';
import { createAgentServer } from './api';

/**
 * Point d'entrée de l'agent.
 * Charge la config, démarre le serveur Fastify.
 */
async function main() {
  const config = loadConfig();
  const app = createAgentServer(config);

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`Agent démarré sur http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
