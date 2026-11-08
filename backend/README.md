# Backend — Lambda functions

Two Lambda functions written in TypeScript (compiled to `dist/` for deployment).

## Functions

| Function                 | Trigger            | Purpose                                            |
|--------------------------|--------------------|----------------------------------------------------|
| `ctr-processor/handler`  | Kinesis stream     | Decode CTRs, filter handled voice contacts, write to DynamoDB. |
| `query-history/handler`  | API Gateway (HTTP) | Query DynamoDB for an agent id and return contacts. |

## Commands

```bash
npm install
npm run typecheck   # strict type-check (no emit)
npm test            # Jest unit tests (22 tests)
npm run build       # compile src/ -> dist/ for SAM packaging
```

## Local invoke with SAM

After `npm run build`, from the `infrastructure/` directory:

```bash
# CTR processor with a sample Kinesis-wrapped event:
sam local invoke CtrProcessorFunction -e ../events/kinesis-wrapped-inbound.json

# Query function:
sam local invoke QueryHistoryFunction -e ../events/apigw-get.json
```

## Notes

- The DynamoDB document client is created lazily and reused across warm invocations
  (`src/shared/dynamo.ts`). Tests inject a mock via `__setDocClient`.
- `TABLE_NAME` must be set (SAM sets it from the table resource).
- `TTL_HOURS` controls how long records are retained (default 24h).
