/**
 * Generated shard.yml (the wings config.yml equivalent): the panel knows
 * the node's FQDN/port, its token and its own URL — the admin copies the
 * file next to shard.exe and the node is configured.
 *
 * IMPORTANT — kept in sync with the agent:
 * internal/config TestPanelGeneratedConfigIsLoadable (mojito-shard)
 * pins this exact shape; change both sides together.
 * Windows paths need SINGLE quotes: in YAML double quotes, backslashes
 * start escapes (\P is invalid).
 */
export interface AgentConfigNode {
  name: string;
  fqdn: string;
  agentPort: number;
  /** SFTP listen port — `sftp.port` in the generated file. */
  sftpPort: number;
  agentToken: string;
  panelUrl: string;
}

export function buildAgentConfig(node: AgentConfigNode): string {
  return [
    `# shard.yml — agent du node « ${node.name} » (${node.fqdn})`,
    '# Généré par le panel — placer ce fichier à côté de shard.exe',
    '# (ou démarrer avec : shard.exe --config <chemin>).',
    `token: ${node.agentToken}`,
    `panel_url: ${node.panelUrl}`,
    'api:',
    '  host: 0.0.0.0',
    `  port: ${node.agentPort}`,
    '  # TLS direct (wings api.ssl) : passer enabled: true + cert_file/key_file',
    "  # pour servir l'agent en HTTPS ; laisser disabled derrière un reverse proxy",
    "  # (c'est le proxy qui termine le TLS).",
    '  ssl:',
    '    enabled: false',
    'system:',
    "  data_dir: 'C:\\PanelData'",
    'sftp:',
    '  enabled: true',
    '  host: 0.0.0.0',
    `  port: ${node.sftpPort}`,
    '# Utilisateurs dedies (process natifs) — un utilisateur local par',
    '# serveur de jeu : prefix = debut du nom des comptes derives, group =',
    '# groupe local regroupant tous les serveurs (filtre du GC au boot).',
    'users:',
    '  prefix: mojito-',
    '  group: MojitoServers',
    'allowed_origins:',
    `  - ${node.panelUrl}`,
    '',
  ].join('\n');
}

/**
 * Placeholder shown when the token cannot be displayed anymore (encrypted
 * at rest, shown once at creation/reset) — the admin must reset it to
 * regenerate a displayable configuration.
 */
export const TOKEN_PLACEHOLDER = '<regénère le token pour afficher la configuration>';

export function buildAgentConfigWithoutToken(node: Omit<AgentConfigNode, 'agentToken'>): string {
  return buildAgentConfig({ ...node, agentToken: TOKEN_PLACEHOLDER });
}
