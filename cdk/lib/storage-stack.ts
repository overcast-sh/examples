import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { baseStackProps } from "./overcast-env";

/**
 * S3 storage patterns: a versioned bucket and a lifecycle-managed bucket,
 * each with a bucket policy.
 *
 * Independent and self-contained — `cdk deploy StorageStack` stands this
 * whole stack up on its own.
 *
 * Note: this stack deliberately does not seed either bucket with
 * `aws-cdk-lib/aws-s3-deployment`'s BucketDeployment. That construct's
 * custom resource invokes a Lambda to run the actual sync, and per overcast
 * docs/cdk.md § Limitations, custom resource invocation requires Docker —
 * without it the handler degrades to a stub physical ID and no objects are
 * actually written. Rather than depend on the deploying machine having
 * Docker wired up for CloudFormation custom resources, this stack ships
 * empty buckets; upload with `aws s3 cp` after deploying instead.
 */
export class StorageStack extends cdk.Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id, baseStackProps);

    const versionedBucket = new s3.Bucket(this, "VersionedBucket", {
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const archiveBucket = new s3.Bucket(this, "ArchiveBucket", {
      lifecycleRules: [
        {
          id: "transition-then-expire",
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
          expiration: cdk.Duration.days(365),
        },
        {
          id: "abort-incomplete-uploads",
          enabled: true,
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Note: `autoDeleteObjects` is deliberately not set on either bucket.
    // CDK implements it as a Lambda-backed custom resource, and per
    // overcast docs/cdk.md § Limitations, custom resource invocation
    // requires Docker; without it the handler degrades to a stub and the
    // objects are left behind, so `cdk destroy` would need the bucket
    // emptied by hand first regardless. Skipping it keeps that constraint
    // explicit instead of implying a cleanup guarantee Overcast can't back.

    // Explicit bucket policy (in addition to the two above): deny any
    // request that arrives without TLS. `enforceSSL: true` on the bucket
    // props generates the same statement — spelled out here so the
    // resulting AWS::S3::BucketPolicy resource is visible in the template.
    for (const bucket of [versionedBucket, archiveBucket]) {
      bucket.addToResourcePolicy(
        new iam.PolicyStatement({
          sid: "DenyInsecureTransport",
          effect: iam.Effect.DENY,
          principals: [new iam.AnyPrincipal()],
          actions: ["s3:*"],
          resources: [bucket.bucketArn, bucket.arnForObjects("*")],
          conditions: { Bool: { "aws:SecureTransport": "false" } },
        })
      );
    }

    new cdk.CfnOutput(this, "VersionedBucketName", { value: versionedBucket.bucketName });
    new cdk.CfnOutput(this, "ArchiveBucketName", { value: archiveBucket.bucketName });
  }
}
