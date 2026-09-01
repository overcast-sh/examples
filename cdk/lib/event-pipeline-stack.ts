import * as cdk from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as eventTargets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as path from "node:path";
import type { Construct } from "constructs";
import { baseStackProps } from "./overcast-env";

export interface EventPipelineStackProps {
  /**
   * Whether to provision the Scheduler producer (`HeartbeatSchedule`).
   * Defaults to `false` — see the comment on the schedule below and
   * cdk/README.md § Known trade-offs.
   */
  readonly schedulerEnabled?: boolean;
}

/**
 * Async messaging showcase: two producers — an EventBridge rule matching a
 * custom event pattern, and (opt-in) an EventBridge Scheduler schedule on a
 * cron — both publish to one SNS topic. The topic fans out to an SQS queue
 * backed by a dead-letter queue, and a Lambda consumer drains the queue.
 *
 * Independent and self-contained — `cdk deploy EventPipelineStack` stands
 * this whole stack up on its own.
 */
export class EventPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EventPipelineStackProps = {}) {
    super(scope, id, baseStackProps);

    const topic = new sns.Topic(this, "NotificationsTopic");

    const deadLetterQueue = new sqs.Queue(this, "NotificationsDlq", {
      retentionPeriod: cdk.Duration.days(14),
    });

    const queue = new sqs.Queue(this, "NotificationsQueue", {
      visibilityTimeout: cdk.Duration.seconds(30),
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 3,
      },
    });

    topic.addSubscription(new subscriptions.SqsSubscription(queue));

    const consumer = new lambda.Function(this, "EventConsumer", {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "..", "lambda", "event-consumer")
      ),
    });
    consumer.addEventSource(new SqsEventSource(queue, { batchSize: 10 }));

    // Producer 1: an EventBridge rule matching a custom event pattern.
    // Publish a matching event with, e.g.:
    //   aws events put-events --entries '[{"Source":"com.overcast-sh.examples","DetailType":"OrderPlaced","Detail":"{}"}]'
    new events.Rule(this, "OrderPlacedRule", {
      eventPattern: {
        source: ["com.overcast-sh.examples"],
        detailType: ["OrderPlaced"],
      },
      targets: [new eventTargets.SnsTopic(topic)],
    });

    // Producer 2: an EventBridge Scheduler schedule on a cron expression.
    // The L2 scheduler constructs (`@aws-cdk/aws-scheduler-alpha`) are still
    // pre-release, so this uses the stable L1 CfnSchedule directly — it maps
    // 1:1 onto AWS::Scheduler::Schedule, which Overcast provisions for real
    // (see overcast docs/cdk.md § Supported resource types).
    //
    // Opt-in behind `-c scheduler=true` (see bin/cdk-showcase.ts). This
    // CfnSchedule deliberately has no `name` — CDK leaves it to
    // CloudFormation to mint one, the common pattern every L2 construct
    // relies on. As of the `:alpha` image, Overcast's
    // AWS::Scheduler::Schedule handler doesn't fall back to a generated name
    // the way its sibling AWS::Scheduler::ScheduleGroup (and most other
    // resource types) do, so the create 501s and takes the whole stack down
    // with it (CloudFormation is all-or-nothing). Flip the flag on once
    // that's fixed upstream; see cdk/README.md § Known trade-offs.
    if (props.schedulerEnabled) {
      const schedulerRole = new iam.Role(this, "SchedulerRole", {
        assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
      });
      topic.grantPublish(schedulerRole);

      new scheduler.CfnSchedule(this, "HeartbeatSchedule", {
        flexibleTimeWindow: { mode: "OFF" },
        scheduleExpression: "rate(5 minutes)",
        target: {
          arn: topic.topicArn,
          roleArn: schedulerRole.roleArn,
          input: JSON.stringify({ message: "heartbeat" }),
        },
      });
    }

    new cdk.CfnOutput(this, "TopicArn", { value: topic.topicArn });
    new cdk.CfnOutput(this, "QueueUrl", { value: queue.queueUrl });
    new cdk.CfnOutput(this, "DeadLetterQueueUrl", { value: deadLetterQueue.queueUrl });
  }
}
