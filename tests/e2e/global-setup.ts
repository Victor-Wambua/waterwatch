import { rmSync } from 'node:fs';
import { setupAll } from './auth.ts';

export default async function globalSetup(): Promise<void> {
  rmSync('test-results/auth', { recursive: true, force: true });
  await setupAll(['reporter', 'reporter2', 'tech1', 'tech2', 'dispatcher', 'admin', 'auditor', 'ngo', 'platform']);
}
