import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

let cachedClient: S3Client | null = null

function getS3Client() {
  if (cachedClient) return cachedClient
  cachedClient = new S3Client({ region: process.env.AWS_REGION ?? "us-east-2" })
  return cachedClient
}

export async function uploadImageToS3(
  base64: string,
  mediaType: string,
  conversationId: string,
  index: number
): Promise<string> {
  const bucket = process.env.S3_BUCKET ?? "aerial-damage-images"
  const cloudfront = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? ""
  const ext = mediaType.split("/")[1] ?? "jpg"
  const key = `vlm-uploads/${conversationId}/${Date.now()}_${index}.${ext}`

  const body = Buffer.from(base64, "base64")
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: mediaType,
    })
  )

  return cloudfront ? `${cloudfront}/${key}` : `https://${bucket}.s3.amazonaws.com/${key}`
}
