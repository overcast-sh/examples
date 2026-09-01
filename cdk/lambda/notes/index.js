// CRUD handler for the notes API, invoked via API Gateway's Lambda proxy
// integration (LambdaRestApi with default proxy: true — every method and
// path is forwarded here, so this one function does its own routing).
//
// Uses the AWS SDK v3 clients bundled with the Node.js 20.x Lambda runtime,
// so no dependencies need to be packaged into the asset.
"use strict";

const {
  DynamoDBClient,
} = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const { randomUUID } = require("node:crypto");

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.NOTES_TABLE_NAME;

const json = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  const method = event.httpMethod;
  const id = event.pathParameters && event.pathParameters.id;

  try {
    if (method === "GET" && !id) {
      const { Items } = await client.send(new ScanCommand({ TableName: TABLE_NAME }));
      return json(200, { notes: Items ?? [] });
    }

    if (method === "GET" && id) {
      const { Item } = await client.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { id } })
      );
      return Item ? json(200, Item) : json(404, { message: `Note ${id} not found` });
    }

    if (method === "POST") {
      const payload = event.body ? JSON.parse(event.body) : {};
      const note = {
        id: randomUUID(),
        title: payload.title ?? "Untitled",
        body: payload.body ?? "",
        createdAt: new Date().toISOString(),
      };
      await client.send(new PutCommand({ TableName: TABLE_NAME, Item: note }));
      return json(201, note);
    }

    if (method === "PUT" && id) {
      const payload = event.body ? JSON.parse(event.body) : {};
      const note = {
        id,
        title: payload.title ?? "Untitled",
        body: payload.body ?? "",
        updatedAt: new Date().toISOString(),
      };
      await client.send(new PutCommand({ TableName: TABLE_NAME, Item: note }));
      return json(200, note);
    }

    if (method === "DELETE" && id) {
      await client.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { id } }));
      return json(204, {});
    }

    return json(404, { message: "Not found" });
  } catch (err) {
    console.error(err);
    return json(500, { message: "Internal error", detail: String(err && err.message) });
  }
};
