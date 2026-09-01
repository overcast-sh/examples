import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "node:path";
import type { Construct } from "constructs";
import { baseStackProps } from "./overcast-env";

/**
 * A small CRUD notes API: API Gateway (REST) -> Lambda -> DynamoDB.
 *
 * Independent and self-contained — `cdk deploy ServerlessApiStack` stands
 * this whole stack up on its own.
 */
export class ServerlessApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id, baseStackProps);

    const table = new dynamodb.Table(this, "NotesTable", {
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const handler = new lambda.Function(this, "NotesHandler", {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "lambda", "notes")),
      environment: {
        NOTES_TABLE_NAME: table.tableName,
      },
    });
    table.grantReadWriteData(handler);

    const api = new apigw.LambdaRestApi(this, "NotesApi", {
      handler,
      // Every path/method is proxied to the one Lambda, which does its own
      // routing on event.httpMethod / event.pathParameters — see
      // lambda/notes/index.js. Overcast's API Gateway support doesn't
      // evaluate VTL request/response templates, so proxy integration
      // (values passed through as-is) is the right shape here regardless.
      proxy: true,
      deployOptions: { stageName: "prod" },
    });

    new cdk.CfnOutput(this, "ApiUrl", { value: api.url });
    new cdk.CfnOutput(this, "TableName", { value: table.tableName });
  }
}
