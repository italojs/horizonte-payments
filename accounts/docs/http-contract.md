# Accounts HTTP contract

All requests and responses use JSON. Monetary amounts are integer minor units. Each caller reuses the same payment UUID on retries.

| Route | Request | Success |
| --- | --- | --- |
| GET /health | No parameters | 200 with `{"ok":true}` |
| GET /accounts/:company | Company ID in the path | 200 with `id`, `availableMinor`, `currency` |
| POST /reserve | Payment and account details | 200 with `{"status":"HELD"}` on the first hold |
| POST /capture | Payment and company IDs | 200 with `{"status":"CAPTURED"}` |
| POST /release | Payment and company IDs | 200 with `{"status":"RELEASED"}` |

## Reserve

```json
{
  "paymentId": "418827fa-5977-4918-ab8a-dabb597f14fa",
  "companyId": "horizonte",
  "accountId": "acc-horizonte",
  "amountMinor": 12500,
  "currency": "BRL"
}
```

A reserve requires the account's currency and a positive integer amount up to 1,000,000,000,000. A successful hold reduces `availableMinor`. A capture reduces the posted balance and the reserved amount by the same value. A release frees the hold. For capture and release, callers may supply the original account and amount. If supplied, these must match the existing operation, except that a release recorded before a reserve remains final.

## Replay and failure responses

A replay returns the existing status and adds no duplicate ledger entries. A reserve after release returns `RELEASED`. A reserve after capture returns `CAPTURED` for the original details. Releasing an unknown payment creates a `RELEASED` reservation to fence a late reserve. Capture on an unknown or released payment and release on a captured payment return 409.

| HTTP code | Response / cause |
| --- | --- |
| 400 | Schema validation error, or `{"status":"INVALID"}` for missing or mismatched reserve details |
| 404 | `{"error":"Unknown account"}` on account lookup, or `{"status":"UNKNOWN_ACCOUNT"}` for an account or ownership mismatch |
| 409 | `{"status":"CONFLICT"}` for conflicting amounts or incompatible transitions |
| 422 | `{"status":"INSUFFICIENT_FUNDS"}` if spendable funds cannot cover the hold |

`companyId` is a nonempty string up to 100 characters. `accountId` is a string up to 120 characters. Currency codes use three uppercase letters. Validation errors use Fastify's JSON error envelope with `statusCode`, `error` and `message`.
