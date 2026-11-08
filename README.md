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

### 1. Deploy the backend (SAM)

```bash
cd infrastructure
sam build
sam deploy --guided
```

The stack creates: the DynamoDB table, both Lambda functions, the Kinesis stream
(optional), the API Gateway, and all IAM roles.

Note the `ContactHistoryApiUrl` output — you'll use it in the frontend.

### 2. Associate the Kinesis stream with your Amazon Connect instance

In the Amazon Connect console, enable **data streaming** for Contact Trace Records
and point it at the Kinesis stream created by the stack (or an existing one).

### 3. Run the frontend widget

```bash
cd frontend
cp .env.example .env         # set VITE_API_ENDPOINT to the API Gateway URL
npm install
npm run dev
```

### 4. Register the widget as a 3P app

In the Amazon Connect console, under **Agent Applications**, register the deployed
widget URL as a third-party application and grant it access to the API endpoint.

---

## Testing

```bash
cd backend && npm install && npm test        # Lambda unit tests
cd frontend && npm install && npm run build   # Type-check + build the widget
```

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
| `ExpirationTime`           | Number | Epoch seconds for DynamoDB TTL auto-cleanup       |

---

## Cleaning up

Tear down everything the stack created:

```bash
cd infrastructure
sam delete
```

Then, in the Amazon Connect console, remove the 3P app from **Agent Application
Settings** and (if you created a dedicated one) delete the Kinesis stream.
