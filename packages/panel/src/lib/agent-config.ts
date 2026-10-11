/**
 * Generated icecube.yml (the wings config.yml equivalent): the panel knows
 * the node's FQDN/port, its token and its own URL — the admin copies the
 * file next to icecube.exe and the node is configured.
 *
 * IMPORTANT — kept in sync with the agent:
 * internal/config TestPanelGeneratedConfigIsLoadable (mojito-icecube)
 * pins this exact shape; change both sides together.
 * Windows paths need SINGLE quotes: in YAML double quotes, backslashes
 * start escapes (\P is invalid).
 */
export interface AgentConfigNode {
  name: string;
  fqdn: string;
  agentPort: number;
  agentToken: string;
  panelUrl: string;
}

export function buildAgentConfig(node: AgentConfigNode): string {
  return [
    `# icecube.yml — agent du node « ${node.name} » (${node.fqdn})`,
    '# Généré par le panel — placer ce fichier à côté de icecube.exe',
    '# (ou démarrer avec : icecube.exe --config <chemin>).',
    `token: ${node.agentToken}`,
    `panel_url: ${node.panelUrl}`,
    'api:',
    '  host: 0.0.0.0',
    `  port: ${node.agentPort}`,
    'system:',
    "  data_dir: 'C:\\PanelData'",
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
