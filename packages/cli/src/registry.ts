import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentSpec } from '@bellwether/runner';

/** Walks up from this file to the repository root, which holds pnpm-workspace.yaml. */
export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth++) {
    try {
      readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8');
      return dir;
    } catch {
      dir = dirname(dir);
    }
  }
  return process.cwd();
}

interface RegistryEntry {
  command: string;
  args: string[];
  description?: string;
  env?: Record<string, string>;
}

interface RegistryFile {
  agents: Record<string, RegistryEntry>;
}

export function loadRegistry(): RegistryFile {
  const root = repoRoot();
  return JSON.parse(readFileSync(join(root, 'agents', 'registry.json'), 'utf8')) as RegistryFile;
}

export function resolveAgent(name: string): AgentSpec {
  const registry = loadRegistry();
  const entry = registry.agents[name];
  if (!entry) {
    throw new Error(
      `unknown agent "${name}". Available: ${Object.keys(registry.agents).join(', ')}. Add your own in agents/registry.json (see docs/add-an-agent.md).`,
    );
  }
  const root = repoRoot();
  return {
    name,
    command: entry.command,
    // Relative script paths are resolved against the repo root so the CLI works
    // from any working directory.
    args: entry.args.map((arg) =>
      arg.includes('/') && !arg.startsWith('-') ? resolve(root, arg) : arg,
    ),
    env: entry.env,
  };
}
