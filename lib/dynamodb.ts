import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

function getRegion() {
  const region = process.env.AWS_REGION
  if (!region) {
    throw new Error("Missing AWS_REGION environment variable")
  }
  return region
}

let cachedClient: DynamoDBDocumentClient | null = null

export function getDdbClient() {
  if (cachedClient) return cachedClient
  const client = new DynamoDBClient({ region: getRegion() })
  cachedClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  })
  return cachedClient
}
