import { z } from 'zod';

/**
 * Scheme the panel and browsers use to talk to the agent — Pelican
 * "Communicate over SSL": 'http', 'https' when the agent itself serves TLS,
 * or 'https-behind-proxy' when a reverse proxy in front of it terminates
 * the TLS (the agent stays in plain HTTP on its listen port).
 */
export const nodeSchemeSchema = z.enum(['http', 'https', 'https-behind-proxy']);

export type NodeScheme = z.infer<typeof nodeSchemeSchema>;

/** HTTPS variants — the panel and browsers talk TLS to the agent (directly
 * or through the reverse proxy in front of it). */
export function isHttpsScheme(scheme: string): boolean {
  return scheme === 'https' || scheme === 'https-behind-proxy';
}

/**
 * Hostname / IP-literal pattern: a bare hostname (letters, digits, hyphens,
 * dots — no spaces, no scheme, no path, no `?`), an IPv4 literal, or a
 * BRACKETED IPv6 literal. The agent client interpolates the value raw into
 * `scheme://<fqdn>:<port>` URLs (src/server/agent/client.ts, the console and
 * health WS URLs), so anything carrying its own scheme, port or path would
 * break every URL the panel builds — and brackets are the only way an IPv6
 * literal survives that interpolation.
 */
const HOSTNAME_OR_IP_PATTERN =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$|^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$|^\d{1,3}(?:\.\d{1,3}){3}$|^\[[0-9A-Fa-f:.]+\]$/;

export const createNodeSchema = z.object({
  name: z.string().min(2, 'Le nom doit faire au moins 2 caractères').max(128),
  fqdn: z
    .string()
    .min(3, 'FQDN invalide')
    .max(255)
    .regex(HOSTNAME_OR_IP_PATTERN, 'FQDN invalide — un nom d’hôte ou une IP, sans schéma ni port'),
  agentPort: z.number().int().min(1).max(65535),
  /** Accessible port — the port the panel and browsers connect to. */
  publicPort: z.number().int().min(1).max(65535),
  scheme: nodeSchemeSchema,
  /** SFTP port of the agent (optional — DEFAULT_SFTP_PORT when omitted). */
  sftpPort: z.number().int().min(1).max(65535).optional(),
});

export type CreateNodeDto = z.infer<typeof createNodeSchema>;

export const nodeIdSchema = z.object({
  nodeId: z.string().min(1),
});

/** FQDN to resolve — Pelican-style live DNS check on the node create form. */
export const nodeFqdnSchema = z.object({
  fqdn: z.string().min(1).max(255),
});

export type NodeFqdnDto = z.infer<typeof nodeFqdnSchema>;

export const updateNodeSchema = z.object({
  nodeId: z.string().min(1),
  name: z.string().min(2, 'Le nom doit faire au moins 2 caractères').max(128),
  fqdn: z
    .string()
    .min(3, 'FQDN invalide')
    .max(255)
    .regex(HOSTNAME_OR_IP_PATTERN, 'FQDN invalide — un nom d’hôte ou une IP, sans schéma ni port'),
  agentPort: z.number().int().min(1).max(65535),
  /** Accessible port — the port the panel and browsers connect to. */
  publicPort: z.number().int().min(1).max(65535),
  scheme: nodeSchemeSchema,
  /** SFTP port of the agent — the node edit form always submits it. */
  sftpPort: z.number().int().min(1).max(65535),
});

export type UpdateNodeDto = z.infer<typeof updateNodeSchema>;

export const deleteNodeSchema = nodeIdSchema;

// ─── Allocations (admin node pool) ─────────────────────────────────────────────

const MIN_PORT = 1024;
const MAX_PORT = 65535;
/** Safety cap — a single import must not create an unbounded number of rows. */
const MAX_PORTS_PER_IMPORT = 1000;

export const PORTS_SPEC_MESSAGE =
  'Ports invalides — utilise "25565" ou "25570-25575, 25599" (>= 1024)';

/**
 * Parses a Pelican-style ports spec: "25565", "25570-25575, 25599".
 * Returns the deduplicated port list, or null when the spec is invalid.
 */
export function parsePortsSpec(spec: string): number[] | null {
  const ports = new Set<number>();
  for (const part of spec.split(',')) {
    const token = part.trim();
    if (!token) continue;

    const range = token.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start < MIN_PORT || end > MAX_PORT || start >= end) return null;
      for (let port = start; port <= end; port++) ports.add(port);
      continue;
    }

    if (!/^\d+$/.test(token)) return null;
    const port = Number(token);
    if (port < MIN_PORT || port > MAX_PORT) return null;
    ports.add(port);
  }

  if (ports.size === 0 || ports.size > MAX_PORTS_PER_IMPORT) return null;
  return [...ports].sort((a, b) => a - b);
}

export const createAllocationsSchema = z.object({
  nodeId: z.string().min(1),
  ip: z.string().min(1, 'L’IP est requise').max(255),
  ports: z.string().min(1, 'Indique au moins un port'),
  alias: z.string().max(255),
});

export type CreateAllocationsDto = z.infer<typeof createAllocationsSchema>;

export const allocationIdSchema = z.object({
  allocationId: z.string().min(1),
});

export const assignAllocationSchema = z.object({
  allocationId: z.string().min(1),
  serverId: z.string().min(1),
});

export type AssignAllocationDto = z.infer<typeof assignAllocationSchema>;
