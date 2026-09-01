#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { EventPipelineStack } from "../lib/event-pipeline-stack";
import { NetworkStack } from "../lib/network-stack";
import { ServerlessApiStack } from "../lib/serverless-api-stack";
import { StorageStack } from "../lib/storage-stack";

const app = new cdk.App();

// EventPipelineStack's Scheduler schedule is opt-in (`-c scheduler=true`).
// As of the `:alpha` image, AWS::Scheduler::Schedule's CloudFormation
// handler doesn't auto-generate a name when the template omits one — which
// is exactly what CDK's CfnSchedule does when you don't pass `name` — so the
// create request 501s and CloudFormation rolls back the *whole* stack (all
// resources are one unit). Defaulting the flag off keeps
// `cdk deploy EventPipelineStack` working out of the box; pass
// `-c scheduler=true` once that gap is fixed upstream. See
// lib/event-pipeline-stack.ts and cdk/README.md for details.
const schedulerEnabled = app.node.tryGetContext("scheduler") === "true";

// Four independent stacks — each deployable on its own
// (`cdk deploy <StackName>`) or all together (`cdk deploy --all`). Shared
// env/tags live in one place: lib/overcast-env.ts.
new ServerlessApiStack(app, "ServerlessApiStack");
new EventPipelineStack(app, "EventPipelineStack", { schedulerEnabled });
new StorageStack(app, "StorageStack");
new NetworkStack(app, "NetworkStack");
