// Consumes messages delivered by the SQS event source mapping. Each SQS
// record wraps the original SNS notification (topic -> queue fan-out), so
// Records[].body is the SNS envelope JSON, and Records[].body.Message is
// whatever was published to the topic (by the EventBridge rule, the
// Scheduler schedule, or a manual `sns publish`).
"use strict";

exports.handler = async (event) => {
  for (const record of event.Records ?? []) {
    let snsEnvelope;
    try {
      snsEnvelope = JSON.parse(record.body);
    } catch {
      snsEnvelope = { Message: record.body };
    }

    console.log(
      JSON.stringify({
        messageId: record.messageId,
        subject: snsEnvelope.Subject,
        message: snsEnvelope.Message,
      })
    );
  }

  return { batchItemFailures: [] };
};
