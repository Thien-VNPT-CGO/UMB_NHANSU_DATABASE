import { env } from '../env';
import { listWorkerWorkspaces, updateWorkspace } from '../db/repo';
import { runSlaForOwner } from './sla-service';
import { pullHarasocialForOwner, pullHrForOwner } from './pull-service';
import { heartbeat } from './events';

const busy = new Set<string>();
const lastPull = new Map<string, number>();

const SLA_INTERVAL_MS = 30_000;
const PULL_INTERVAL_MS = 5 * 60_000;

async function tick(): Promise<void> {
  const workspaces = await listWorkerWorkspaces();
  await Promise.allSettled(
    workspaces.map(async (workspace) => {
      const ownerUid = workspace.ownerUid;
      if (busy.has(ownerUid)) return;
      busy.add(ownerUid);
      try {
        await runSlaForOwner(ownerUid, { now: new Date() }, workspace).catch((e) =>
          console.warn(`[worker] SLA ${ownerUid}:`, (e as Error).message)
        );

        const previous = lastPull.get(ownerUid) || 0;
        if (Date.now() - previous >= PULL_INTERVAL_MS) {
          lastPull.set(ownerUid, Date.now());
          await Promise.allSettled([
            pullHarasocialForOwner(ownerUid, workspace),
            pullHrForOwner(ownerUid, workspace),
          ]);
        }

        await updateWorkspace(ownerUid, { lastWorkerRunAt: new Date().toISOString() }).catch(() => undefined);
      } finally {
        busy.delete(ownerUid);
      }
    })
  );
}

let slaTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

export function startWorkers(): void {
  if (env.workerDisabled) {
    console.log('[worker] disabled by HARA_WORKER_DISABLED=1');
    return;
  }
  if (slaTimer) return;
  slaTimer = setInterval(() => {
    void tick().catch((e) => console.warn('[worker] tick failed:', (e as Error).message));
  }, SLA_INTERVAL_MS);
  heartbeatTimer = setInterval(heartbeat, 25_000);
  setTimeout(() => {
    void tick().catch((e) => console.warn('[worker] first tick failed:', (e as Error).message));
  }, 5_000);
  console.log('[worker] SLA worker started (30s), pull worker (5m)');
}

export function stopWorkers(): void {
  if (slaTimer) clearInterval(slaTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  slaTimer = null;
  heartbeatTimer = null;
}

export async function runWorkerOnce(): Promise<void> {
  await tick();
}
