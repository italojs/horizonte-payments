export interface Operation {
  paymentId: string;
  companyId: string;
  accountId?: string;
  amountMinor?: number;
  currency?: string;
  beneficiaryRef?: string;
}
