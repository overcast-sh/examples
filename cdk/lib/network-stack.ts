import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import type { Construct } from "constructs";
import { baseStackProps } from "./overcast-env";

/**
 * Infra primitives: a VPC (public + private-with-egress subnets across two
 * AZs), a security group, and an EC2 instance.
 *
 * Independent and self-contained — `cdk deploy NetworkStack` creates its own
 * VPC rather than importing one, so it does not need the local-VPC provider
 * pattern from overcast docs/cdk/local-vpc.md (that pattern is for stacks
 * that import a VPC created *outside* CDK; a stack that owns the VPC it
 * creates has no stale-ID problem to work around).
 */
export class NetworkStack extends cdk.Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id, baseStackProps);

    const vpc = new ec2.Vpc(this, "Vpc", {
      // maxAzs (rather than an explicit availabilityZones list) is safe
      // here specifically because this stack is environment-agnostic (see
      // lib/overcast-env.ts) — CDK emits Fn::GetAZs instead of resolving
      // AZs through a context provider, and Overcast's CloudFormation
      // engine evaluates that intrinsic directly.
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: "Public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        {
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    const webSecurityGroup = new ec2.SecurityGroup(this, "WebSecurityGroup", {
      vpc,
      description: "Allow inbound HTTP/HTTPS from within the VPC",
      allowAllOutbound: true,
    });
    webSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(80),
      "HTTP from within the VPC"
    );
    webSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      "HTTPS from within the VPC"
    );

    // Overcast's EC2 support is metadata-only: RunInstances records
    // pending -> running state (and emits the matching EventBridge
    // notifications) without ever booting a real machine, so the AMI
    // content doesn't matter. `MachineImage.latestAmazonLinux2023()` is
    // deliberately avoided here — it resolves via a CloudFormation
    // `{{resolve:ssm:...}}` dynamic reference against a *real* public SSM
    // parameter, which only genuine AWS serves. A hardcoded id sidesteps
    // that lookup entirely.
    const instance = new ec2.Instance(this, "WebInstance", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroup: webSecurityGroup,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.genericLinux({
        "us-east-1": "ami-0c101f26f147fa7fd",
      }),
    });

    new cdk.CfnOutput(this, "VpcId", { value: vpc.vpcId });
    new cdk.CfnOutput(this, "InstanceId", { value: instance.instanceId });
  }
}
