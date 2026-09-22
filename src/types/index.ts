export type Currency = 'CREDIT' | 'AOA' | 'USD' | 'EUR' | 'XAF';

export type AccountType = 'USER' | 'MERCHANT' | 'PLATFORM' | 'SYSTEM';

export type WalletStatus = 'ACTIVE' | 'FROZEN' | 'CLOSED';

export type TransactionType =
  | 'COLLECTION'
  | 'PAYMENT'
  | 'TRANSFER'
  | 'DISBURSEMENT'
  | 'REFUND'
  | 'HOLD_CAPTURE'
  | 'HOLD_RELEASE';

export type TransactionStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'REVERSED';

export type LedgerDirection = 'DEBIT' | 'CREDIT';

export type HoldStatus = 'ACTIVE' | 'CAPTURED' | 'RELEASED';

export type Environment = 'production' | 'sandbox';

export interface AppRecord {
  id: string;
  name: string;
  api_key_hash: string;
  test_api_key_hash?: string | null;
  webhook_url?: string | null;
  webhook_secret: string;
  is_active: boolean;
  max_amount_per_tx?: string;
  daily_volume_limit?: string;
  rate_limit_rpm?: number;
  contact_email?: string | null;
  description?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface WalletRecord {
  id: string;
  app_id: string;
  account_id: string;
  account_type: AccountType;
  environment: Environment;
  currency: Currency;
  available_balance: string; // BIGINT retourné en string par pg
  locked_balance: string;
  status: WalletStatus;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface TransactionRecord {
  id: string;
  app_id: string;
  idempotency_key: string;
  type: TransactionType;
  environment: Environment;
  amount: string;
  fee_amount: string;
  currency: Currency;
  status: TransactionStatus;
  reference?: string | null;
  metadata: Record<string, any>;
  error_message?: string | null;
  created_at: Date;
  completed_at?: Date | null;
}

export interface LedgerEntryRecord {
  id: string;
  transaction_id: string;
  wallet_id: string;
  direction: LedgerDirection;
  environment: Environment;
  amount: string;
  balance_before: string;
  balance_after: string;
  description?: string | null;
  created_at: Date;
}

export interface HoldRecord {
  id: string;
  wallet_id: string;
  amount: string;
  status: HoldStatus;
  reason?: string | null;
  metadata: Record<string, any>;
  expires_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}
