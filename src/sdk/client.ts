export type Environment = 'sandbox' | 'production';

export interface LightWalletConfig {
  baseUrl: string;
  appId: string;
  apiKey: string;
}

export interface MerchantBalanceRecord {
  status: string;
  app_id: string;
  environment: Environment;
  wallet_id: string;
  currency: string;
  available_balance: string;
  locked_balance: string;
  account_type: 'MERCHANT';
  status_label: 'ACTIVE' | 'FROZEN' | 'CLOSED';
}

export interface ChargeUserParams {
  userAccountId: string;
  amount: number | bigint | string;
  currency?: string;
  reference?: string;
  description?: string;
  metadata?: Record<string, any>;
  idempotencyKey?: string;
}

export interface RequestPayoutParams {
  amount: number | bigint | string;
  phone: string;
  network?: string;
  name?: string;
  currency?: string;
  country?: string;
  description?: string;
}

export interface LedgerEntryItem {
  id: string;
  transaction_id: string;
  direction: 'DEBIT' | 'CREDIT';
  category: 'COLLECTION' | 'DISBURSEMENT';
  amount: string;
  balance_before: string;
  balance_after: string;
  description: string;
  created_at: string;
  transaction_type: string;
  reference: string;
  metadata?: Record<string, any>;
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
 * SDK Client universel pour Marchands Grossistes LightPay.
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
      'Authorization': `Bearer ${this.apiKey}`,
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
   * 1. Consulter le solde marchand de l'application (Son Solde)
   */
  public async getBalance(currency = 'CREDIT'): Promise<MerchantBalanceRecord> {
    return await this.request<MerchantBalanceRecord>(
      `/v1/merchant/balance?currency=${encodeURIComponent(currency)}`
    );
  }

  /**
   * 2. Collecter un paiement auprès d'un utilisateur LightPay (Collection)
   */
  public async chargeUser(params: ChargeUserParams): Promise<any> {
    const idempotencyKey = params.idempotencyKey || LightWalletClient.generateIdempotencyKey();
    return await this.request('/v1/merchant/collections/charge-user', {
      method: 'POST',
      idempotencyKey,
      body: {
        user_account_id: params.userAccountId,
        amount: params.amount.toString(),
        currency: params.currency || 'CREDIT',
        reference: params.reference,
        description: params.description,
        metadata: params.metadata || {},
      },
    });
  }

  /**
   * 3. Demander un retrait vers Mobile Money MTN ou Airtel Congo (Disbursement)
   */
  public async requestPayout(params: RequestPayoutParams): Promise<any> {
    return await this.request('/v1/merchant/disbursements/payout', {
      method: 'POST',
      body: {
        amount: params.amount.toString(),
        phone: params.phone,
        network: params.network,
        name: params.name,
        currency: params.currency || 'CREDIT',
        country: params.country || 'CG',
        description: params.description,
      },
    });
  }

  /**
   * 4. Obtenir le relevé complet des mouvements marchands (Collections & Disbursements)
   */
  public async getStatement(params?: {
    limit?: number;
    offset?: number;
    type?: 'ALL' | 'COLLECTION' | 'DISBURSEMENT';
  }): Promise<{ status: string; count: number; entries: LedgerEntryItem[] }> {
    const limit = params?.limit || 50;
    const offset = params?.offset || 0;
    const typeParam = params?.type && params.type !== 'ALL' ? `&type=${params.type}` : '';
    return await this.request(
      `/v1/merchant/statement?limit=${limit}&offset=${offset}${typeParam}`
    );
  }

  /**
   * 5. Recharger son compte de test en mode Sandbox (Top-up Test)
   */
  public async topupSandbox(amount: number | bigint | string = 50000, currency = 'CREDIT'): Promise<any> {
    return await this.request('/v1/merchant/sandbox-topup', {
      method: 'POST',
      body: {
        amount: amount.toString(),
        currency,
      },
    });
  }

  /**
   * 6. Virement direct entre comptes (P2P atomique)
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
}
