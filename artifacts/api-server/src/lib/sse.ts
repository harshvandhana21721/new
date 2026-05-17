import type { Response } from "express";

const clients = new Set<Response>();

export function sseSubscribe(res: Response): void {
  clients.add(res);
}

export function sseUnsubscribe(res: Response): void {
  clients.delete(res);
}

export function sseEmit(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}
