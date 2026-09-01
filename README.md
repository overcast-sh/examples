# overcast-sh/examples

Example projects showing how to build against [Overcast](https://github.com/overcast-sh/overcast) — a fast, local AWS emulator (`ghcr.io/overcast-sh/overcast`, API on port `4566`, web console on port `4567`).

| Example                | What it shows                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------- |
| [`cdk/`](./cdk) | An AWS CDK (TypeScript) app with four independent, individually-deployable stacks. |

More examples (non-CDK SDK usage, Terraform, etc.) can live alongside `cdk/` as this repo grows — each as its own top-level directory with its own README.

## Prerequisites

- [Docker](https://www.docker.com/) — to run the Overcast container
- [Node.js](https://nodejs.org/) 24+ and npm — to run the CDK app

## Quickstart

**1. Start Overcast** (full image, with the web console):

```bash
docker run --rm -p 4566:4566 -p 4567:4567 ghcr.io/overcast-sh/overcast:latest
```

Leave this running in its own terminal. The AWS API is now live at `http://localhost:4566`, and the web console — useful for browsing whatever the examples below create — is at [http://localhost:4567](http://localhost:4567).

**2. Install and deploy the CDK example**:

```bash
cd cdk
npm install
npm run bootstrap    # one-time: creates the CDK bootstrap bucket/roles in Overcast
npm run deploy:all   # deploys all four stacks
```

Or deploy stacks one at a time:

```bash
npm run deploy -- ServerlessApiStack
npm run deploy -- EventPipelineStack
npm run deploy -- StorageStack
npm run deploy -- NetworkStack
```

`npm run bootstrap` and `npm run deploy*` set the environment variables CDK needs to target Overcast instead of real AWS (endpoint override + dummy credentials) automatically — see [`cdk/README.md`](./cdk/README.md#pointing-cdk-at-overcast) for exactly what's set and why. When you're done:

```bash
npm run destroy:all
```

## Exploring what got deployed

Open [http://localhost:4567](http://localhost:4567) after deploying — Overcast's web console lists every resource each stack created (the DynamoDB table, the S3 buckets, the SQS queues, the running EC2 instance metadata, etc.) without needing the AWS CLI or SDK.

## The stacks

See [`cdk/README.md`](./cdk/README.md) for a full description of each stack. In short:

| Stack                  | Demonstrates                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `ServerlessApiStack`   | API Gateway + Lambda + DynamoDB — a small CRUD notes API.                                       |
| `EventPipelineStack`   | SNS → SQS (+ DLQ) → Lambda, fed by both an EventBridge rule and a Scheduler schedule.           |
| `StorageStack`         | S3: a versioned bucket, a bucket with lifecycle rules, and explicit bucket policies.             |
| `NetworkStack`         | A VPC (public + private subnets across two AZs), a security group, and an EC2 instance.         |

## License

[MIT](./LICENSE)
