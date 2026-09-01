#!/usr/bin/env node
// Seeds sample data into whichever of the four stacks are deployed:
//   - ServerlessApiStack: 4 notes (via the API when Lambda execution works,
//     falling back to a direct DynamoDB put-item when it's stubbed)
//   - StorageStack: 5 small sample files uploaded to both buckets
//   - EventPipelineStack: ~10 SNS publishes + a few EventBridge put-events
//
// Resource names/ARNs are discovered from each stack's CloudFormation
// Outputs — nothing is hardcoded — so this script works regardless of which
// stacks you deployed. Run it through with-overcast-env.js, same as the
// other npm scripts, so it inherits AWS_ENDPOINT_URL / dummy credentials:
//
//   npm run seed
//
// Idempotent: every note uses a fixed id (PUT upserts), every S3 object uses
// a fixed key (PutObject overwrites), so re-running never accumulates
// duplicates. The SNS publishes and EventBridge put-events are transient
// messages, not stored resources — re-running just fires another round of
// them, which is the point (there's nothing to de-dupe).
"use strict";

import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

const REGION = process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || "us-east-1";
const ENDPOINT = process.env.AWS_ENDPOINT_URL || "http://localhost:4566";
const CREDENTIALS = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
};
const AWS_CLIENT_CONFIG = { region: REGION, endpoint: ENDPOINT, credentials: CREDENTIALS };

const STACKS = ["ServerlessApiStack", "EventPipelineStack", "StorageStack", "NetworkStack"];

const log = (...args) => console.log("[seed]", ...args);
const warn = (...args) => console.warn("[seed]", ...args);

/** Fetches every stack's Outputs, keyed by stack name then OutputKey. Stacks
 * that don't exist (not deployed) are skipped with a warning, not a crash —
 * this script works with whatever subset of the four stacks is up. */
async function collectOutputs() {
  const cfn = new CloudFormationClient(AWS_CLIENT_CONFIG);
  const outputs = {};

  for (const stackName of STACKS) {
    try {
      const { Stacks } = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
      const stack = Stacks && Stacks[0];
      const byKey = {};
      for (const o of stack?.Outputs ?? []) {
        byKey[o.OutputKey] = o.OutputValue;
      }
      outputs[stackName] = byKey;
      log(`${stackName}: found (${Object.keys(byKey).length} output(s))`);
    } catch (err) {
      outputs[stackName] = null;
      warn(`${stackName}: not deployed, skipping its resources (${err.name ?? err.message})`);
    }
  }

  return outputs;
}

// ---------------------------------------------------------------------------
// ServerlessApiStack: seed notes via the API, falling back to DynamoDB.
// ---------------------------------------------------------------------------

const SEED_NOTES = [
  { id: "seed-welcome", title: "Welcome", body: "This note was created by npm run seed." },
  {
    id: "seed-overcast",
    title: "About Overcast",
    body: "A fast, local AWS emulator — see https://github.com/overcast-sh/overcast.",
  },
  {
    id: "seed-stacks",
    title: "The four stacks",
    body: "ServerlessApiStack, EventPipelineStack, StorageStack, NetworkStack.",
  },
  {
    id: "seed-idempotent",
    title: "Re-run me",
    body: "Every seeded note uses a fixed id, so running `npm run seed` again just upserts these.",
  },
];

/** PUTs one note through API Gateway -> Lambda -> DynamoDB. Returns true on
 * success, false on a 502 (the signature of a stubbed Lambda — see
 * overcast docs/cdk.md § Limitations) so the caller can fall back. */
async function putNoteViaApi(apiUrl, note) {
  const url = new URL(`notes/${encodeURIComponent(note.id)}`, apiUrl);
  const res = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: note.title, body: note.body }),
  });
  if (res.status === 502) return false;
  if (!res.ok) {
    warn(`  PUT ${url} -> HTTP ${res.status}; treating as unavailable, falling back`);
    return false;
  }
  return true;
}

/** Writes one note straight into the notes table, bypassing the API. Mirrors
 * the item shape lambda/notes/index.js's PUT handler stores. */
async function putNoteDirect(ddb, tableName, note) {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: { id: note.id, title: note.title, body: note.body, updatedAt: new Date().toISOString() },
    })
  );
}

async function seedNotes(outputs) {
  const apiOutputs = outputs.ServerlessApiStack;
  if (!apiOutputs) return;

  const apiUrl = apiOutputs.ApiUrl;
  const tableName = apiOutputs.TableName;
  if (!apiUrl || !tableName) {
    warn("ServerlessApiStack: missing ApiUrl/TableName output, skipping notes");
    return;
  }

  log(`Seeding ${SEED_NOTES.length} notes into ${tableName}...`);

  // Probe once against the first note: if the API round-trips cleanly, use
  // it for the rest; if it 502s (stub Lambda, no Docker socket mounted),
  // switch to direct DynamoDB writes for all of them rather than retrying
  // the API note by note.
  const [probe, ...rest] = SEED_NOTES;
  const apiWorked = await putNoteViaApi(apiUrl, probe).catch((err) => {
    warn(`  API unreachable (${err.message}), falling back to DynamoDB`);
    return false;
  });

  if (apiWorked) {
    log("  path: API Gateway -> Lambda -> DynamoDB");
    for (const note of rest) {
      await putNoteViaApi(apiUrl, note);
    }
  } else {
    log("  path: direct DynamoDB put-item (Lambda execution unavailable — see cdk/README.md § Real Lambda execution)");
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(AWS_CLIENT_CONFIG));
    for (const note of SEED_NOTES) {
      await putNoteDirect(ddb, tableName, note);
    }
  }

  log(`Notes seeded: ${SEED_NOTES.map((n) => n.id).join(", ")}`);
}

// ---------------------------------------------------------------------------
// StorageStack: upload a handful of preview-friendly sample files.
// ---------------------------------------------------------------------------

function sampleFiles() {
  const now = new Date().toISOString();
  return [
    {
      key: "samples/README.md",
      contentType: "text/markdown",
      body: `# Sample data\n\nUploaded by \`npm run seed\` on ${now}.\n\nThese files exist so Overcast's web console has something to preview — see\n[\`cdk/README.md\`](../../README.md) for how they got here.\n`,
    },
    {
      key: "samples/data.json",
      contentType: "application/json",
      body: JSON.stringify(
        { project: "cdk-showcase", seededAt: now, stacks: STACKS, note: "See cdk/scripts/seed.mjs" },
        null,
        2
      ),
    },
    {
      key: "samples/metrics.csv",
      contentType: "text/csv",
      body: [
        "date,requests,errors,latency_ms",
        "2026-08-28,1240,3,112",
        "2026-08-29,1310,1,108",
        "2026-08-30,980,0,115",
        "2026-08-31,1420,5,121",
      ].join("\n") + "\n",
    },
    {
      key: "samples/badge.svg",
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40">
  <rect width="120" height="40" rx="6" fill="#2563eb"/>
  <text x="60" y="24" font-family="monospace" font-size="13" fill="#ffffff" text-anchor="middle">overcast</text>
</svg>
`,
    },
    {
      key: "samples/server.log",
      contentType: "text/plain",
      body: [
        `${now} INFO  starting cdk-showcase sample workload`,
        `${now} INFO  connected to notes table`,
        `${now} WARN  cold start took 812ms`,
        `${now} INFO  heartbeat published`,
        `${now} INFO  request handled ok`,
      ].join("\n") + "\n",
    },
  ];
}

async function seedBucket(s3, bucketName, files) {
  for (const file of files) {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: file.key,
        Body: file.body,
        ContentType: file.contentType,
      })
    );
  }
}

async function seedStorage(outputs) {
  const storageOutputs = outputs.StorageStack;
  if (!storageOutputs) return;

  const buckets = [storageOutputs.VersionedBucketName, storageOutputs.ArchiveBucketName].filter(Boolean);
  if (buckets.length === 0) {
    warn("StorageStack: no bucket outputs found, skipping uploads");
    return;
  }

  // forcePathStyle: true — Overcast's S3 defaults to path-style addressing;
  // see overcast docs/migration-from-localstack.md § S3.
  const s3 = new S3Client({ ...AWS_CLIENT_CONFIG, forcePathStyle: true });
  const files = sampleFiles();

  for (const bucketName of buckets) {
    log(`Uploading ${files.length} sample files to s3://${bucketName}...`);
    await seedBucket(s3, bucketName, files);
  }
  log(`Storage seeded: ${buckets.join(", ")}`);
}

// ---------------------------------------------------------------------------
// EventPipelineStack: publish sample SNS messages + EventBridge events.
// ---------------------------------------------------------------------------

async function seedEvents(outputs) {
  const pipelineOutputs = outputs.EventPipelineStack;
  if (!pipelineOutputs) return;

  const topicArn = pipelineOutputs.TopicArn;
  if (!topicArn) {
    warn("EventPipelineStack: missing TopicArn output, skipping SNS/EventBridge seeding");
    return;
  }

  const sns = new SNSClient(AWS_CLIENT_CONFIG);
  const messageCount = 10;
  log(`Publishing ${messageCount} SNS messages to ${topicArn}...`);
  for (let i = 1; i <= messageCount; i++) {
    await sns.send(
      new PublishCommand({
        TopicArn: topicArn,
        Subject: `Sample message ${i}`,
        Message: JSON.stringify({ message: `sample-${i}`, seededAt: new Date().toISOString() }),
      })
    );
  }

  const eventbridge = new EventBridgeClient(AWS_CLIENT_CONFIG);
  const eventCount = 4;
  log(`Putting ${eventCount} EventBridge events (source: com.overcast-sh.examples, detail-type: OrderPlaced)...`);
  await eventbridge.send(
    new PutEventsCommand({
      Entries: Array.from({ length: eventCount }, (_, i) => ({
        Source: "com.overcast-sh.examples",
        DetailType: "OrderPlaced",
        Detail: JSON.stringify({ orderId: `seed-order-${i + 1}`, seededAt: new Date().toISOString() }),
      })),
    })
  );

  log("Events seeded: 10 SNS publishes, 4 EventBridge put-events");
}

// ---------------------------------------------------------------------------

async function main() {
  log(`Discovering stack outputs (endpoint: ${ENDPOINT}, region: ${REGION})...`);
  const outputs = await collectOutputs();

  await seedNotes(outputs);
  await seedStorage(outputs);
  await seedEvents(outputs);

  log("Done. Browse the results at http://localhost:4567 (Overcast's web console).");
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
