# Architecture

This solution is fully serverless and event-driven. It follows the flow described in the
AWS blog and is composed of five logical stages.

## 1. Amazon Connect streams data

Amazon Connect is configured to stream **Contact Trace Records (CTRs)** to an Amazon
Kinesis Data Stream. A CTR is emitted when a contact completes and contains the agent,
queue, customer endpoint, timestamps, and disconnect information.

## 2. CTR Processor Lambda

The `CtrProcessorFunction` is triggered by the Kinesis stream. For each record it:

1. Base64-decodes and JSON-parses the Kinesis payload.
2. Filters for completed **voice** contacts that were actually handled by an agent
   (an `Agent` block with a `Username`/`ARN` is present).
3. Maps CTR fields to the compact DynamoDB item shape.
4. Computes an `ExpirationTime` (TTL) so rows auto-expire (default 24h).
5. Writes the item to DynamoDB with `PutItem`.

Malformed records are caught, logged, and skipped so one bad record never fails the whole
batch. (A production setup can route failures to a DLQ via `BisectBatchOnFunctionError`
and an `OnFailure` destination.)

## 3. DynamoDB table

A single table stores one item per handled contact.

- Partition key `pk` = Amazon Connect **user id** (the agent).
- Sort key `sk` = event **timestamp** (epoch ms), so a query naturally returns the
  agent's contacts in chronological order and can be bounded to "today".
- `ExpirationTime` is the DynamoDB **TTL** attribute for automatic cleanup.

Billing mode is `PAY_PER_REQUEST` (on-demand) to keep operations and cost low.

## 4. Query Lambda + API Gateway

`QueryHistoryFunction` is fronted by an **HTTP API** (API Gateway v2) exposing:

```
GET /contact-history?agentId=<connectUserId>&since=<epochMs?>
```

It queries DynamoDB for that `pk`, optionally bounded to the start of the current day,
returns the newest records first, and responds with:

```json
{ "contacts": [ { "ContactId": "...", "Timestamp": "...", ... } ] }
```

CORS is enabled so the browser-based widget can call it directly.

> **Authentication.** As the blog notes, production deployments should put a JWT
> authorizer (same IdP as the agent workspace, for SSO) in front of this API. The
> template includes a commented-out `JwtAuthorizer` block to enable that.

## 5. React 3P widget

A React + TypeScript app built with Vite:

1. Initializes the Amazon Connect SDK with `AmazonConnectApp.init()`.
2. Creates an `AgentClient` with the returned `provider` and calls `getARN()`.
3. Parses the agent id from the ARN.
4. Calls the API Gateway endpoint with that agent id.
5. Renders results as a responsive table/card list with explicit loading, empty,
   and error states.

The widget is registered in the Amazon Connect console as a third-party application.

## IAM (least privilege)

- CTR Processor: `dynamodb:PutItem` on the table + Kinesis read on the stream.
- Query Lambda: `dynamodb:Query` on the table only.
- Each function gets its own execution role.
