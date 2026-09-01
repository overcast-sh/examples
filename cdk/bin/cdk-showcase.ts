#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { EventPipelineStack } from "../lib/event-pipeline-stack";
import { NetworkStack } from "../lib/network-stack";
import { ServerlessApiStack } from "../lib/serverless-api-stack";
import { StorageStack } from "../lib/storage-stack";

const app = new cdk.App();

// Four independent stacks — each deployable on its own
// (`cdk deploy <StackName>`) or all together (`cdk deploy --all`). Shared
// env/tags live in one place: lib/overcast-env.ts.
new ServerlessApiStack(app, "ServerlessApiStack");
new EventPipelineStack(app, "EventPipelineStack");
new StorageStack(app, "StorageStack");
new NetworkStack(app, "NetworkStack");
