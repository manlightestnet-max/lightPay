import { Environment } from '../types/index.js';

export interface CreatePaymentIntentParams {
  amount: number | bigint;
  currency: string;
  customerEmail?: string;
  customerName?: string;
  customerPhone?: string;
  description?: string;
  returnUrl?: string;
  metadata?: Record<string, any>;
  environment: Environment;
}

export interface PaymentIntentResult {
  gatewayTransactionId: string;
  checkoutUrl?: string; // URL vers laquelle rediriger le client pour payer par Carte / Multicaixa / MoMo
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  provider: string;
  rawResponse?: any;
}

export interface PayoutIntentParams {
  amount: number | bigint;
  currency: string;
  recipientPhone: string;
  recipientName?: string;
  network: string; // 'UNITEL', 'MOVICEL', 'MTN', 'AIRTEL', etc.
  reference?: string;
  environment: Environment;
}

export interface PayoutIntentResult {
  gatewayPayoutId: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  provider: string;
  rawResponse?: any;
}

export interface WebhookEventPayload {
  event: string;
  transactionId: string;
  reference?: string;
  amount: string;
  currency: string;
  status: 'SUCCESS' | 'FAILED';
  environment: Environment;
  metadata?: Record<string, any>;
}
