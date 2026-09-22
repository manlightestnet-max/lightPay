export type Environment = 'sandbox' | 'production';

export interface LightWalletConfig {
  baseUrl: string;
  appId: string;
  apiKey: string;
}

export interface WalletRecord {
  id: string;
  app_id: string;
  account_id: string;
  account_type: 'USER' | 'MERCHANT' | 'PLATFORM' | 'SYSTEM';
  environment: Environment;
  currency: string;
  available_balance: string | number;
  locked_balance: string | number;
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  created_at: string;
  updated_at?: string;
}

export interface DepositParams {
  accountId?: string;
  walletId?: string;
  amount: number | bigint | string;
  currency?: string;
  method?: string;
  reference?: string;
  metadata?: Record<string, any>;
  idempotencyKey?: string;
}

export interface TransferParams {
  fromAccountId?: string;
  toAccountId?: string;
  fromWalletId?: string;
  toWalletId?: string;
  amount: number | bigint | string;
  currency?: string;
  note?: string;
  metadata?: Record<string, any>;
  idempotencyKey?: string;
}

export interface LedgerEntryItem {
  id: string;
  transaction_id: string;
  wallet_id: string;
  direction: 'DEBIT' | 'CREDIT';
  environment: Environment;
  amount: string;
  balance_before: string;
  balance_after: string;
  description: string;
  created_at: string;
  transaction_type: string;
  reference: string;
}

/**
 * Générateur UUID universel (Compatible Node.js 16+, Deno, Bun et Navigateurs modernes)
 */
function universalUUID(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * LightWalletClient
 * SDK Client universel pour interagir avec le moteur comptable LightWallet.
 * Détecte automatiquement l'environnement (Sandbox vs Production) à partir de la clé d'API.
 */
export class LightWalletClient {
  public readonly baseUrl: string;
  public readonly appId: string;
  public readonly apiKey: string;
  public readonly environment: Environment;

  constructor(config: LightWalletConfig) {
    if (!config.baseUrl) {
      throw new Error('[LightWallet SDK] baseUrl is required');
    }
    if (!config.appId) {
      throw new Error('[LightWallet SDK] appId is required');
    }
    if (!config.apiKey) {
      throw new Error('[LightWallet SDK] apiKey is required');
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.appId = config.appId;
    this.apiKey = config.apiKey;
    // Détection automatique : sec_test_... -> Sandbox, sinon -> Production
    this.environment = config.apiKey.startsWith('sec_test_') ? 'sandbox' : 'production';
  }

  /**
   * Retourne si le SDK opère actuellement en mode Sandbox
   */
  public isSandbox(): boolean {
    return this.environment === 'sandbox';
  }

  /**
   * Retourne si le SDK opère en production réelle
   */
  public isLive(): boolean {
    return this.environment === 'production';
  }

  /**
   * Génère une clé d'idempotence unique (UUIDv4)
   */
  public static generateIdempotencyKey(): string {
    return universalUUID();
  }

  private async request<T = any>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      body?: any;
      idempotencyKey?: string;
      customHeaders?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-App-Id': this.appId,
      'X-Api-Key': this.apiKey,
      'X-Environment': this.environment,
      ...(options.customHeaders || {}),
    };

    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMsg = (data as any)?.error || (data as any)?.message || `HTTP Error ${response.status}`;
      throw new Error(`[LightWallet SDK Error] ${errorMsg}`);
    }

    return data as T;
  }

  /**
   * Vérifie la connectivité avec le serveur LightWallet
   */
  public async healthCheck(): Promise<{ status: string; uptime?: number; timestamp?: string }> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new Error(`[LightWallet SDK] Server health check failed: HTTP ${response.status}`);
    }
    return (await response.json()) as any;
  }

  /**
   * Créer ou récupérer le portefeuille d'un compte utilisateur (Upsert)
   */
  public async getOrCreateWallet(params: {
    accountId: string;
    accountType?: 'USER' | 'MERCHANT' | 'PLATFORM';
    currency?: string;
    metadata?: Record<string, any>;
  }): Promise<WalletRecord> {
    const res = await this.request<{ status: string; wallet: WalletRecord }>('/v1/wallets', {
      method: 'POST',
      body: {
        account_id: params.accountId,
        account_type: params.accountType || 'USER',
        currency: params.currency || 'CREDIT',
        metadata: params.metadata || {},
      },
    });
    return res.wallet;
  }

  /**
   * Consulter un portefeuille par son identifiant de compte externe (ex: user_alice)
   */
  public async getWalletByAccount(accountId: string, currency = 'CREDIT'): Promise<WalletRecord> {
    const res = await this.request<{ status: string; wallet: WalletRecord }>(
      `/v1/wallets/accounts/${encodeURIComponent(accountId)}?currency=${encodeURIComponent(currency)}`
    );
    return res.wallet;
  }

  /**
   * Consulter un portefeuille par son UUID interne
   */
  public async getWalletById(walletId: string): Promise<WalletRecord> {
    const res = await this.request<{ status: string; wallet: WalletRecord }>(
      `/v1/wallets/${encodeURIComponent(walletId)}`
    );
    return res.wallet;
  }

  /**
   * Effectuer un dépôt / recharge en crédits sur un portefeuille
   */
  public async deposit(params: DepositParams): Promise<any> {
    const idempotencyKey = params.idempotencyKey || LightWalletClient.generateIdempotencyKey();
    return await this.request('/v1/collections/deposit', {
      method: 'POST',
      idempotencyKey,
      body: {
        account_id: params.accountId,
        wallet_id: params.walletId,
        amount: params.amount.toString(),
        currency: params.currency || 'CREDIT',
        method: params.method || (this.isSandbox() ? 'SANDBOX_TOPUP' : 'DIRECT_CREDIT'),
        reference: params.reference,
        metadata: params.metadata || {},
      },
    });
  }

  /**
   * Transférer des crédits en direct entre deux comptes (P2P instantané et atomique)
   */
  public async transfer(params: TransferParams): Promise<any> {
    const idempotencyKey = params.idempotencyKey || LightWalletClient.generateIdempotencyKey();
    return await this.request('/v1/payments/transfer', {
      method: 'POST',
      idempotencyKey,
      body: {
        from_account_id: params.fromAccountId,
        to_account_id: params.toAccountId,
        from_wallet_id: params.fromWalletId,
        to_wallet_id: params.toWalletId,
        amount: params.amount.toString(),
        currency: params.currency || 'CREDIT',
        note: params.note,
        metadata: params.metadata || {},
      },
    });
  }

  /**
   * Obtenir le relevé comptable complet (statement) d'un portefeuille
   */
  public async getStatement(walletId: string, limit = 50, offset = 0): Promise<LedgerEntryItem[]> {
    const res = await this.request<{ status: string; entries: LedgerEntryItem[] }>(
      `/v1/wallets/${encodeURIComponent(walletId)}/statement?limit=${limit}&offset=${offset}`
    );
    return res.entries || [];
  }
}

