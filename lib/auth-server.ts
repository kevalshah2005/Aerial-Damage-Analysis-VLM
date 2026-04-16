import { CognitoJwtVerifier } from "aws-jwt-verify"

function getCognitoConfig() {
  const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID
  if (!userPoolId || !clientId) {
    throw new Error(
      "Missing Cognito environment variables: NEXT_PUBLIC_COGNITO_USER_POOL_ID and NEXT_PUBLIC_COGNITO_CLIENT_ID"
    )
  }
  return { userPoolId, clientId }
}

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null

function getVerifier() {
  if (verifier) return verifier
  const { userPoolId, clientId } = getCognitoConfig()
  verifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: "id",
    clientId,
  })
  return verifier
}

function getBearerToken(req: Request): string {
  const authHeader = req.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing or invalid Authorization header")
  }
  return authHeader.slice("Bearer ".length).trim()
}

export async function getAuthenticatedUserId(req: Request): Promise<string> {
  const token = getBearerToken(req)
  const payload = await getVerifier().verify(token)
  const userId = payload.sub
  if (!userId) {
    throw new Error("Authenticated token missing sub claim")
  }
  return userId
}
