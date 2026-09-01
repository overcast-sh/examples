# cdk-showcase

A TypeScript AWS CDK (`aws-cdk-lib` v2) app with four independent stacks, each demonstrating a coherent Overcast scenario. Every stack deploys standalone (`cdk deploy <StackName>`) or together (`cdk deploy --all`).

## Stacks

| Stack                | File                             | Resources                                                                                        | Demonstrates                                                                                     |
| --------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ServerlessApiStack` | `lib/serverless-api-stack.ts`   | API Gateway (`LambdaRestApi`), Lambda (Node.js, asset code), DynamoDB table                     | A small CRUD notes API — `GET/POST /notes`, `GET/PUT/DELETE /notes/{id}`.                       |
| `EventPipelineStack` | `lib/event-pipeline-stack.ts`   | SNS topic, SQS queue + DLQ, Lambda consumer (SQS event source), EventBridge rule, Scheduler schedule (opt-in, see below) | Async messaging: two producers (an event-pattern rule, and — behind `-c scheduler=true` — a cron schedule) publish to one topic, which fans out to a queue a Lambda drains. |
| `StorageStack`       | `lib/storage-stack.ts`          | Two S3 buckets (one versioned, one with lifecycle rules) + bucket policies                       | S3 storage patterns.                                                                             |
| `NetworkStack`       | `lib/network-stack.ts`          | VPC (public + private subnets, 2 AZs), security group, EC2 instance                              | Core networking primitives.                                                                      |

Shared config (tags, the environment-agnostic stance explained below) lives in one place: `lib/overcast-env.ts`. Nothing else in the app duplicates it.

## Pointing CDK at Overcast

This follows the [overcast `docs/cdk.md`](https://github.com/overcast-sh/overcast/blob/main/docs/cdk.md) quick start exactly:

1. **Endpoint + credentials** — CDK (and the AWS SDK it uses under the hood) needs `AWS_ENDPOINT_URL` pointed at Overcast and *some* credentials (Overcast doesn't validate them):
   ```bash
   export AWS_ENDPOINT_URL=http://localhost.overcast.sh:4566
   export AWS_ACCESS_KEY_ID=test
   export AWS_SECRET_ACCESS_KEY=test
   export AWS_DEFAULT_REGION=us-east-1
   ```
   `scripts/with-overcast-env.js` sets exactly these four (only if not already set) before running whatever command follows it, cross-platform — a plain shell `export ... && ...` doesn't work in PowerShell/cmd. The `bootstrap`/`deploy`/`destroy`/`seed` npm scripts all run through it; see `package.json`.

   The endpoint uses `localhost.overcast.sh` (a public wildcard-DNS domain resolving to `127.0.0.1`), not plain `localhost`: CDK's S3 asset publisher addresses buckets virtual-hosted style (`<bucket>.<endpoint-host>`), and Overcast needs a hostname it recognizes to rewrite that to path-style — pair this with `docker run`'s `-e OVERCAST_HOSTNAME=localhost.overcast.sh` (see the top-level README). Without both, `cdk deploy`/`cdk bootstrap` fail publishing assets.

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
- **`StorageStack` doesn't seed its buckets** with `aws-cdk-lib/aws-s3-deployment`'s `BucketDeployment` (or set `autoDeleteObjects`). Both are implemented as Lambda-backed CloudFormation custom resources; per overcast `docs/cdk.md` § Limitations, the `ServiceToken` Lambda runs for real when Docker is available to the Overcast container, and degrades to a stub physical ID (no objects moved, stack still deploys) when it isn't — see "Real Lambda execution" below. Run `npm run seed` instead, or upload manually: `aws s3 cp ./somefile s3://<bucket-name>/ --endpoint-url $AWS_ENDPOINT_URL`.
- **`EventPipelineStack`'s Scheduler producer is opt-in** (`-c scheduler=true`, default off). As of the `:alpha` image, `AWS::Scheduler::Schedule`'s CloudFormation handler doesn't auto-generate a name when the template omits one (the pattern CDK's `CfnSchedule` uses), so the create 501s and CloudFormation rolls back the whole stack. See the comment above `HeartbeatSchedule` in `lib/event-pipeline-stack.ts`.

## Real Lambda execution (optional)

By default Overcast's Lambda invocations (and CloudFormation custom resources) degrade to a stub response — no container runs, no code executes. To get real execution, mount the Docker socket into the Overcast container so it can launch Lambda's own runtime containers:

```bash
docker run --rm -p 4566:4566 -p 4567:4567 \
  -e OVERCAST_HOSTNAME=localhost.overcast.sh \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ghcr.io/overcast-sh/overcast:latest
```

With that mounted, `ServerlessApiStack`'s notes API and `EventPipelineStack`'s SQS consumer actually run your handler code (and `StorageStack`'s custom resources, if you add any) instead of returning a 502 stub. Without it, everything still deploys — Lambda-backed responses are just stubbed.

## Seed sample data (optional)

```bash
npm run seed
```

Populates whatever stacks are deployed: a few notes in `ServerlessApiStack`'s table (via the API if Lambda execution is available, otherwise a direct DynamoDB write), five small sample files in each `StorageStack` bucket, and ~10 SNS messages plus a few EventBridge events through `EventPipelineStack`. Resource names are read from each stack's CloudFormation outputs, so it works with any subset of the four stacks deployed. Safe to re-run — see `cdk/scripts/seed.mjs`.

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
  scripts/seed.mjs            # npm run seed — see "Seed sample data" above
```
