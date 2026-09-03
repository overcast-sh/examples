#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { EventPipelineStack } from "../lib/event-pipeline-stack";
import { NetworkStack } from "../lib/network-stack";
import { ServerlessApiStack } from "../lib/serverless-api-stack";
import { StorageStack } from "../lib/storage-stack";

const app = new cdk.App();

// EventPipelineStack's Scheduler schedule is on by default. It used to 501
// and roll back the whole stack — AWS::Scheduler::Schedule's CloudFormation
// handler didn't auto-generate a name when the template omitted one, which
// is exactly what CDK's CfnSchedule does when you don't pass `name` — but
// that's fixed upstream (overcast#1518, shipped in 0.0.1-alpha.39). Pass
// `-c scheduler=false` to opt back out. See lib/event-pipeline-stack.ts and
// cdk/README.md for details.
const schedulerEnabled = app.node.tryGetContext("scheduler") !== "false";

// Four independent stacks — each deployable on its own
// (`cdk deploy <StackName>`) or all together (`cdk deploy --all`). Shared
// env/tags live in one place: lib/overcast-env.ts.
new ServerlessApiStack(app, "ServerlessApiStack");
new EventPipelineStack(app, "EventPipelineStack", { schedulerEnabled });
new StorageStack(app, "StorageStack");
new NetworkStack(app, "NetworkStack");
