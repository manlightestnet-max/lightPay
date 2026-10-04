import { EventEmitter } from 'events';
import { Environment } from './types/index.js';

/**
 * In-process "this wallet changed" signal, for the person's open pages (GET /v1/me/stream).
 * Raised after every committed ledger movement and every journal line written or updated.
 * It carries no data: the page re-reads what it shows through the normal, authenticated API.
 * One process (Render runs one instance); a page that misses a signal catches up on reconnect.
 */
const bus = new EventEmitter();
bus.setMaxListeners(0);

const key = (environment: Environment, walletId: string) => `${environment}:${walletId}`;

export function notifyWallets(environment: Environment, walletIds: Iterable<string | null | undefined>) {
  for (const id of new Set(walletIds)) if (id) bus.emit(key(environment, id));
}

export function onWalletChange(environment: Environment, walletId: string, listener: () => void) {
  const k = key(environment, walletId);
  bus.on(k, listener);
  return () => {
    bus.off(k, listener);
  };
}
