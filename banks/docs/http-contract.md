# Banks HTTP contract

Callers submit, query and cancel external payments over JSON/HTTP. They reuse the payment UUID for every operation on the same instruction.

| Route | Request | Success |
| --- | --- | --- |
| GET /health | No parameters | 200 with `{"ok":true}` |
| POST /submit | Payment and settlement details | 200 with `status` and `receipt` |
| GET /payments/:id?companyId=... | Payment UUID and owning company ID | 200 with current `status` and `receipt` |
| POST /cancel | `paymentId` and `companyId` | 200 with `status` and `receipt` unless the instruction was rejected |

## Submit an instruction

```json
{
  "paymentId": "418827fa-5977-4918-ab8a-dabb597f14fa",
  "companyId": "horizonte",
  "amountMinor": 12500,
  "currency": "BRL",
  "beneficiaryRef": "supplier-001"
}
```

`beneficiaryRef` is an opaque, nonempty identifier of up to 150 characters. `companyId` accepts 1 to 100 characters. `amountMinor` is a positive integer up to 1,000,000,000,000. Currency codes use three uppercase letters. On replay of an instruction with recorded details, the amount, currency and beneficiary must match.

## Settlement and recovery

A `PAID` response has a stable receipt in the form `B-<uuid>`. Other recorded outcomes have `receipt: null`. A request returning `PROCESSING` can be polled through the GET route. A processing instruction can become `PAID`, `REJECTED` or `CANCELLED` depending on the simulator mode and the operation. After losing a submit response, query the same payment. If the payment settled, query and equivalent repeated submissions return its original receipt.

A successful cancellation of an unknown UUID records `CANCELLED` and blocks late settlement. Cancelling a paid instruction returns its original `PAID` status and receipt. Paid, cancelled and rejected states are final. In offline mode the API returns 503 before looking up the payment.

| HTTP code | Response / cause |
| --- | --- |
| 400 | Schema validation error, or `{"status":"INVALID"}` for incomplete settlement details |
| 404 | `{"status":"UNKNOWN"}` for an unknown payment query or ownership mismatch |
| 409 | `{"status":"CONFLICT"}` if repeated settlement details disagree |
| 422 | `{"status":"REJECTED","receipt":null}` for a rejected payment |
| 503 | `{"status":"UNAVAILABLE"}` in offline mode |

Schema validation errors use Fastify's JSON envelope with `statusCode`, `error` and `message`. Business errors with no recorded decision omit the receipt field.
