import type { Response } from 'express';

interface Client {
  id: number;
  res: Response;
}

const channels = new Map<string, Set<Client>>();
let nextId = 1;

export function addSseClient(ownerUid: string, res: Response): () => void {
  const client: Client = { id: nextId++, res };
  let set = channels.get(ownerUid);
  if (!set) {
    set = new Set();
    channels.set(ownerUid, set);
  }
  set.add(client);
  return () => {
    const current = channels.get(ownerUid);
    if (!current) return;
    current.delete(client);
    if (current.size === 0) channels.delete(ownerUid);
  };
}

export function broadcast(ownerUid: string, event: string, data: unknown = {}): void {
  const set = channels.get(ownerUid);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of [...set]) {
    try {
      client.res.write(payload);
    } catch {
      set.delete(client);
    }
  }
}

/** Gửi nhịp giữ kết nối, tránh proxy đóng idle. */
export function heartbeat(): void {
  for (const set of channels.values()) {
    for (const client of [...set]) {
      try {
        client.res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        set.delete(client);
      }
    }
  }
}

export function clientCount(): number {
  return [...channels.values()].reduce((sum, set) => sum + set.size, 0);
}
