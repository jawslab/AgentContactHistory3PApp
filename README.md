# Agent Contact History — Amazon Connect 3P Application

A serverless solution that gives Amazon Connect agents a personalized, real-time view of
their recently handled voice contacts directly inside the **Amazon Connect agent workspace**,
embedded as a third-party (3P) application.

Based on the AWS blog:
[Enable agent contact history in Amazon Connect agent workspace as a third-party (3P) application](https://aws.amazon.com/blogs/contact-center/enable-agent-contact-history-in-amazon-connect-agent-workspace-as-a-third-party-3p-application/)
(Rama Krishna Yalla, Agnel Joseph, Mohit Bansal, Thiru Subramanian — 14 Aug 2025).

> This repository is an independent implementation of the architecture described in the blog.
> Content and architecture were paraphrased/re-implemented for licensing compliance.

---

## Architecture

```
                   ┌──────────────────────────┐
                   │    Amazon Connect         │
                   │  (CTRs + Agent Events)    │
                   └────────────┬─────────────┘
                                │ streams
                                ▼
                   ┌──────────────────────────┐
                   │     Amazon Kinesis        │
                   │     Data Stream (CTR)     │
                   └────────────┬─────────────┘
                                │ trigger
                                ▼
                   ┌──────────────────────────┐
                   │  CTR Processor Lambda     │
                   │  (decode / filter / map)  │
                   └────────────┬─────────────┘
                                │ PutItem
                                ▼
                   ┌──────────────────────────┐
                   │   DynamoDB (TTL enabled)  │
                   │  pk=ConnectUserId sk=ts   │
                   └────────────┬─────────────┘
                                │ Query
                                ▼
                   ┌──────────────────────────┐
                   │  Query Lambda             │
                   └────────────┬─────────────┘
                                │
                                ▼
                   ┌──────────────────────────┐
                   │  Amazon API Gateway       │
                   │  GET /contact-history     │
                   └────────────┬─────────────┘
                                │ fetch
                                ▼
                   ┌──────────────────────────┐
                   │  React 3P Widget          │
                   │  (Agent Workspace SDK)    │
                   └──────────────────────────┘
```

See [`infrastructure/ARCHITECTURE.md`](infrastructure/ARCHITECTURE.md) for details.

---

## Repository layout

```
.
├── backend/                      # AWS Lambda source (Node.js / TypeScript)
│   ├── src/
│   │   ├── ctr-processor/         # Kinesis -> DynamoDB writer
│   │   ├── query-history/         # API Gateway -> DynamoDB reader
│   │   └── shared/                # Shared types, DynamoDB client, helpers
│   ├── tests/                     # Jest unit tests
│   ├── package.json
│   ├── tsconfig.json
│   └── jest.config.js
├── frontend/                     # React + TypeScript 3P widget
│   ├── src/
│   │   ├── components/
│   │   ├── services/
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── infrastructure/
│   ├── template.yaml              # AWS SAM / CloudFormation template
│   ├── ARCHITECTURE.md
│   └── samconfig.toml
├── events/                        # Sample events for local testing
└── README.md
```

---

## Quick start

### 1. Deploy the backend

With the SAM CLI available:

```bash
cd infrastructure
sam build
sam deploy --guided
```

If SAM isn't available (e.g. running the build in WSL but SAM only installed on
Windows), use plain CloudFormation instead — build the Lambda code first, then
package/deploy the template directly:

```bash
cd backend && npm ci && npm run build
cd ../infrastructure
aws cloudformation package --template-file template.yaml \
  --s3-bucket <your-artifact-bucket> \
  --output-template-file /tmp/packaged.yaml --region <region>
aws cloudformation deploy --template-file /tmp/packaged.yaml \
  --stack-name agent-contact-history \
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --region <region> \
  --parameter-overrides TableName=AgentContactHistory CreateKinesisStream=true \
    TtlHours=24 AllowedChannels=VOICE,CHAT CorsAllowOrigin=*
```

The stack creates: the DynamoDB table, both Lambda functions, the Kinesis stream
(optional), the API Gateway, and all IAM roles.

Note the `ContactHistoryApiUrl` / `ContactHistoryEndpoint` / `CtrStreamArn` outputs —
you'll use them below.

The `AllowedChannels` parameter (default `VOICE`) controls which contact channels are
stored. Set it to `VOICE,CHAT` to also record chats, for example when testing without a
phone number. **`infrastructure/samconfig.toml` still defaults to `VOICE` — if you
deploy with an `AllowedChannels` override on the command line (as above), remember the
file and the live stack can drift apart unless you update both.**

### 2. Associate the Kinesis stream with your Amazon Connect instance

An Amazon Connect instance can have only **one** Kinesis destination for Contact Trace
Records. Associating a new one silently replaces whatever is configured today — if
another system (a dashboard, an analytics pipeline, a different integration) already
depends on that stream, it stops receiving CTRs with no warning from AWS.

Use [`infrastructure/associate-ctr-stream.sh`](infrastructure/associate-ctr-stream.sh)
instead of calling `associate-instance-storage-config` directly. It checks for an
existing CTR storage configuration first and requires explicit confirmation before
overwriting one:

```bash
cd infrastructure
chmod +x associate-ctr-stream.sh
./associate-ctr-stream.sh <INSTANCE_ID> <CtrStreamArn output> <region>
```

- If no CTR destination exists yet, it asks a plain yes/no before associating.
- If one already exists and points elsewhere, it shows you the existing configuration
  and requires typing `REPLACE` to proceed.
- If one already exists and already points at the target stream, it does nothing.

Alternatively, in the Amazon Connect console: open your instance → **Data storage** →
**Data streaming** → check whether CTR streaming is already enabled → if not, point it
at the stream ARN from the `CtrStreamArn` output.

If your instance already streams CTRs elsewhere and you don't want to replace that
destination, set `CreateKinesisStream=false` in the backend stack and point
`ExistingStreamArn` at the existing stream instead — that way this solution fans in
from the stream that's already wired up rather than requisitioning the instance's only
CTR slot.

### 3. Build and host the frontend widget

The widget must be served over **HTTPS** — `npm run dev` is not sufficient, and Connect
will not load a plain HTTP origin.

```bash
cd frontend
cp .env.example .env         # set VITE_API_ENDPOINT to the ContactHistoryEndpoint output
npm ci
npm run build                # outputs to dist/
```

Host `dist/` on any HTTPS static origin. This repo includes
[`infrastructure/frontend-hosting.yaml`](infrastructure/frontend-hosting.yaml), a
CloudFormation template for a private S3 bucket behind CloudFront (Origin Access
Control, HTTPS-only):

```bash
cd infrastructure
aws cloudformation deploy --template-file frontend-hosting.yaml \
  --stack-name agent-contact-history-widget --region <region>
aws s3 sync ../frontend/dist s3://<BucketName output> --delete --region <region>
aws cloudfront create-invalidation --distribution-id <DistributionId output> --paths "/*"
```

The stack's `WidgetUrl` output is the HTTPS URL to register as the 3P app.

### 4. Register the widget as a 3P application

Newer Connect consoles surface this under **Integrations** rather than "Agent
Applications". If you don't see a 3P-application option there, register via CLI
instead (the API underneath is `AppIntegrations` + `Connect` integration
associations):

```bash
aws appintegrations create-application --region <region> \
  --name "Agent Contact History" \
  --namespace agentcontacthistory \
  --description "Agent contact history 3P app" \
  --application-source-config "ExternalUrlConfig={AccessUrl=<WidgetUrl>,ApprovedOrigins=[<WidgetUrl>]}" \
  --permissions "User.Details.View"
# note the returned application ARN, then:
aws connect create-integration-association --region <region> \
  --instance-id <INSTANCE_ID> \
  --integration-type APPLICATION --integration-arn <application ARN>
```

**The app won't appear in the agent workspace until it's also added to the agent's
security profile.** On the Connect admin website: **Users → Security profiles →
<profile> → Agent Applications** → tick the app → **Save**. Agents must sign out and
back in to see it.

---

## Testing

```bash
cd backend && npm install && npm test        # Lambda unit tests
cd frontend && npm install && npm run build   # Type-check + build the widget
```

### Manual smoke test (no live Connect contact required)

You can exercise the whole pipeline without placing a real call, by writing a
synthetic CTR directly to the Kinesis stream and then querying the API:

```bash
aws kinesis put-record --stream-name <stack>-ctr-stream --partition-key k \
  --cli-binary-format raw-in-base64-out --region <region> \
  --data '{"ContactId":"test-1","Channel":"VOICE","InitiationMethod":"INBOUND",
           "DisconnectReason":"CUSTOMER_DISCONNECT","DisconnectTimestamp":"<ISO-8601 now>",
           "CustomerEndpoint":{"Address":"+15555550100"},"Queue":{"Name":"BasicQueue"},
           "Agent":{"ARN":"arn:aws:connect:<region>:<account>:instance/<inst>/agent/<userId>",
                     "AgentInteractionDuration":42}}'
# wait ~15-20s for the Kinesis trigger, then:
curl "<ContactHistoryEndpoint>?agentId=<userId>"
```

Delete the test item afterward with `aws dynamodb delete-item` so it doesn't linger
until TTL cleanup.

---

## Data model

DynamoDB item shape (one row per handled contact):

| Field                      | Type   | Description                                       |
|----------------------------|--------|---------------------------------------------------|
| `pk`                       | String | Amazon Connect user id (partition key)            |
| `sk`                       | Number | Event timestamp in epoch ms (sort key)            |
| `ContactId`                | String | Amazon Connect contact id                         |
| `CustomerEndpointAddress`  | String | Incoming / dialed customer phone number           |
| `AgentInteractionDuration` | Number | Agent interaction duration in seconds             |
| `DisconnectReason`         | String | Who disconnected (AGENT / CUSTOMER)               |
| `InitiationMethod`         | String | INBOUND / OUTBOUND / etc.                         |
| `QueueName`                | String | Inbound or outbound queue name                    |
| `Channel`                  | String | VOICE, CHAT, etc. (see `AllowedChannels`)         |
| `ExpirationTime`           | Number | Epoch seconds for DynamoDB TTL auto-cleanup       |

---

## Known gaps / security notes (lab defaults — harden before production)

- **`CorsAllowOrigin=*` by default.** This only affects browser-enforced CORS checks.
  It does **not** stop direct API calls (`curl`, Postman, server-to-server) — anyone
  who knows or guesses an `agentId` (a Connect user GUID) can call the API and get
  that agent's contact history with no credentials at all. Tighten this to the
  widget's exact HTTPS origin, e.g. the CloudFront `WidgetUrl`, before going beyond a
  lab.
- **No authentication on the API.** CORS tightening alone does not fix the point
  above — it only stops browser-based cross-origin abuse. The template has a
  commented-out JWT authorizer block (`Auth:` section) for `ContactHistoryApi`; enable
  it and validate against your IdP. Ideally also check server-side, in the
  `query-history` Lambda, that the token's subject matches the requested `agentId`,
  so one agent can't query another agent's history even with a valid token.
- **`AllowedChannels` drift.** `infrastructure/samconfig.toml` defaults to `VOICE`.
  If you override it on the deploy command line (e.g. `VOICE,CHAT`), the file and the
  live stack will disagree unless you also update the file.
- **UTC day boundary.** The query defaults to "since start of today in UTC", which may
  not match the agent's local day.
- **TTL is lazy.** DynamoDB TTL deletion can lag by hours after expiry; the query
  still bounds results by date, so this is cosmetic, not a correctness issue.

---

## Cleaning up

Tear down everything the stacks and manual steps created:

```bash
# 1. Remove the Connect integration association and the AppIntegrations application
aws connect list-integration-associations --instance-id <INSTANCE_ID> \
  --integration-type APPLICATION --region <region>
aws connect delete-integration-association --instance-id <INSTANCE_ID> \
  --integration-association-id <id> --region <region>
aws appintegrations delete-application --application-id <id> --region <region>

# 2. Turn off CTR data streaming on the Connect instance (console or
#    disassociate-instance-storage-config)

# 3. Empty and delete the widget hosting stack
aws s3 rm s3://<BucketName> --recursive --region <region>
aws cloudformation delete-stack --stack-name agent-contact-history-widget --region <region>

# 4. Delete the backend stack
aws cloudformation delete-stack --stack-name agent-contact-history --region <region>
# (or `sam delete` if you deployed with SAM)

# 5. Delete the CloudFormation artifact bucket, if one was created for packaging
aws s3 rb s3://<artifact-bucket> --force --region <region>
```

In the Connect admin website, also untick the app from any **Security profile →
Agent Applications** list you added it to.
