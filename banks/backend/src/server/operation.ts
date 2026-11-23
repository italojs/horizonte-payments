export const uuidPattern =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
export const bodySchema = {
  type: 'object',
  required: ['paymentId', 'companyId'],
  properties: {
    paymentId: { type: 'string', pattern: uuidPattern },
    companyId: { type: 'string', minLength: 1, maxLength: 100 },
    accountId: { type: 'string', maxLength: 120 },
    amountMinor: { type: 'integer', minimum: 1, maximum: 1000000000000 },
    currency: { type: 'string', pattern: '^[A-Z]{3}$' },
    beneficiaryRef: { type: 'string', maxLength: 150 },
  },
};
