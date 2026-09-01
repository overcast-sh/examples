/**
 * Shared config for every stack in this app.
 *
 * Deliberately environment-agnostic: `baseStackProps` carries no `env`. The
 * overcast docs/cdk.md quick-start example does the same (`new
 * cdk.Stack(app, "MyStack")`, no env prop) — with no explicit env, CDK
 * leaves `stack.account` / `stack.region` as CloudFormation pseudo
 * parameters (`AWS::AccountId` / `AWS::Region`) instead of concrete values,
 * so `cdk deploy` resolves them from whatever credentials are active at
 * deploy time (Overcast's dummy `test`/`test` creds, whose
 * `sts:GetCallerIdentity` answers with `OVERCAST_ACCOUNT_ID` /
 * `OVERCAST_DEFAULT_REGION` — see cdk.md § How it works).
 *
 * Setting a *concrete* env of account 000000000000 here — tempting, since
 * that's the account `cdk bootstrap aws://000000000000/us-east-1` targets —
 * backfires at synth time instead: constructs like `ec2.Vpc` resolve their
 * availability zones by asking a CDK context provider to assume a lookup
 * role in that account, which only exists in a *bootstrapped Overcast*, not
 * in whatever real AWS credentials happen to be active on the machine doing
 * `cdk synth`. Staying agnostic sidesteps that lookup entirely: AZs are
 * emitted as `Fn::GetAZs` intrinsics, which Overcast's CloudFormation
 * engine evaluates directly (no context provider round-trip needed).
 */
import type { StackProps } from "aws-cdk-lib";

export const OVERCAST_ACCOUNT_ID = "000000000000";
export const OVERCAST_REGION = "us-east-1";

/** Base props every stack extends — keeps shared tags in exactly one place. */
export const baseStackProps: StackProps = {
  tags: {
    project: "cdk-showcase",
    repo: "overcast-sh/examples",
  },
};
