# cdk-showcase

A TypeScript AWS CDK (`aws-cdk-lib` v2) app with four independent stacks, each demonstrating a coherent Overcast scenario. Every stack deploys standalone (`cdk deploy <StackName>`) or together (`cdk deploy --all`).

## Stacks

| Stack                | File                             | Resources                                                                                        | Demonstrates                                                                                     |
| --------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ServerlessApiStack` | `lib/serverless-api-stack.ts`   | API Gateway (`LambdaRestApi`), Lambda (Node.js, asset code), DynamoDB table                     | A small CRUD notes API — `GET/POST /notes`, `GET/PUT/DELETE /notes/{id}`.                       |
| `EventPipelineStack` | `lib/event-pipeline-stack.ts`   | SNS topic, SQS queue + DLQ, Lambda consumer (SQS event source), EventBridge rule, Scheduler schedule | Async messaging: two independent producers (an event-pattern rule and a cron schedule) both publish to one topic, which fans out to a queue a Lambda drains. |
| `StorageStack`       | `lib/storage-stack.ts`          | Two S3 buckets (one versioned, one with lifecycle rules) + bucket policies                       | S3 storage patterns.                                                                             |
| `NetworkStack`       | `lib/network-stack.ts`          | VPC (public + private subnets, 2 AZs), security group, EC2 instance                              | Core networking primitives.                                                                      |

Shared config (tags, the environment-agnostic stance explained below) lives in one place: `lib/overcast-env.ts`. Nothing else in the app duplicates it.

## Pointing CDK at Overcast

This follows the [overcast `docs/cdk.md`](https://github.com/overcast-sh/overcast/blob/main/docs/cdk.md) quick start exactly:

1. **Endpoint + credentials** — CDK (and the AWS SDK it uses under the hood) needs `AWS_ENDPOINT_URL` pointed at Overcast and *some* credentials (Overcast doesn't validate them):
   ```bash
   export AWS_ENDPOINT_URL=http://localhost:4566
   export AWS_ACCESS_KEY_ID=test
   export AWS_SECRET_ACCESS_KEY=test
   export AWS_DEFAULT_REGION=us-east-1
   ```
   `scripts/with-overcast-env.js` sets exactly these four (only if not already set) before running whatever command follows it, cross-platform — a plain shell `export ... && ...` doesn't work in PowerShell/cmd. The `bootstrap`/`deploy`/`destroy` npm scripts all run through it; see `package.json`.

2. **Bootstrap (one-time)** — creates the CDK asset bucket, SSM parameters and IAM roles Overcast needs to provision stacks:
   ```bash
   npm run bootstrap
   ```
   This targets `aws://000000000000/us-east-1`, Overcast's default account/region (`OVERCAST_ACCOUNT_ID` / `OVERCAST_DEFAULT_REGION`).

3. **Deploy**:
   ```bash
   npm run deploy:all              # every stack
   npm run deploy -- ServerlessApiStack   # one stack — extra args pass through npm's `--`
   ```

4. **Destroy**:
   ```bash
   npm run destroy:all
   npm run destroy -- ServerlessApiStack
   ```

### Why the stacks have no explicit `env`

`lib/overcast-env.ts`'s `baseStackProps` deliberately omits `env`, the same way the doc's own example (`new cdk.Stack(app, "MyStack")`) does. Setting a concrete `env: { account: "000000000000", region: "us-east-1" }` — tempting, since that's exactly the account `cdk bootstrap` targets — breaks offline `cdk synth`: `ec2.Vpc` (used in `NetworkStack`) resolves its availability zones by asking a CDK context provider to assume a lookup role in that account, and that role only exists once Overcast has actually been bootstrapped, not in whatever real AWS credentials happen to be active on the machine running `cdk synth`. Leaving the stacks environment-agnostic sidesteps the lookup entirely — CDK emits `Fn::GetAZs` intrinsics instead, which Overcast's CloudFormation engine evaluates directly (see the overcast [`docs/services/cloudformation.md`](https://github.com/overcast-sh/overcast/blob/main/docs/services/cloudformation.md) intrinsic-function table). At deploy time, CDK still resolves the real target account/region from whichever credentials are active — Overcast's dummy `test`/`test` creds answer `sts:GetCallerIdentity` with its configured account and region (cdk.md § How it works), which is `000000000000` / `us-east-1` by default.

`NetworkStack` creates its own VPC rather than importing one, so it doesn't need the local-VPC provider pattern from overcast [`docs/cdk/local-vpc.md`](https://github.com/overcast-sh/overcast/blob/main/docs/cdk/local-vpc.md) — that pattern (`Vpc.fromVpcAttributes` + a provider interface) exists for stacks that import a VPC created *outside* CDK, where torn-down/recreated local VPCs get new `vpc-*`/`subnet-*` IDs between deploys. A stack that owns the VPC it creates has no stale-ID problem to work around.

## Known trade-offs (Overcast-specific)

- **`NetworkStack`'s EC2 instance uses a hardcoded AMI id** instead of `ec2.MachineImage.latestAmazonLinux2023()`. Overcast's EC2 support is metadata-only (`RunInstances` records state, nothing actually boots), so the AMI content is irrelevant — but `latestAmazonLinux2023()` resolves through a CloudFormation `{{resolve:ssm:...}}` dynamic reference against a *real* public SSM parameter, which only genuine AWS serves. A hardcoded id avoids that dependency.
- **`StorageStack` doesn't seed its buckets** with `aws-cdk-lib/aws-s3-deployment`'s `BucketDeployment` (or set `autoDeleteObjects`). Both are implemented as Lambda-backed CloudFormation custom resources, and per overcast `docs/cdk.md` § Limitations, custom resource invocation requires Docker — without it the handler degrades to a stub and no objects actually move. Upload manually instead: `aws s3 cp ./somefile s3://<bucket-name>/ --endpoint-url http://localhost:4566`.

## Local development

```bash
npm install
npm run build        # tsc type-check
npm run synth         # cdk synth --all — no running emulator needed
```

`npm run synth` (and any `cdk synth`) works without Overcast running at all — it's pure template generation. Only `bootstrap`/`deploy`/`destroy` need the container up.

## Project layout

```
cdk/
  bin/cdk-showcase.ts        # app entrypoint — instantiates all four stacks
  lib/overcast-env.ts        # shared stack props (tags; see "no explicit env" above)
  lib/*-stack.ts             # one file per stack
  lambda/notes/               # ServerlessApiStack's CRUD handler (asset code)
  lambda/event-consumer/      # EventPipelineStack's SQS consumer (asset code)
  scripts/with-overcast-env.js
```
