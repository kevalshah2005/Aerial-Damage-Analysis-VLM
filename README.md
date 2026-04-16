# Geospatial Dashboard Chatbot

A Next.js 16 application featuring an interactive geospatial dashboard with an integrated AI chatbot.

## Features
- **Interactive Map**: Built with Leaflet and React-Leaflet.
- **AI Chatbot**: Integrated via Vercel AI SDK with Amazon Bedrock (Claude Haiku).
- **Modern UI**: Styled with Tailwind CSS and shadcn/ui.
- **Hurricane Harvey Data**: Visualizes pre/post disaster imagery with building damage overlays.

## Getting Started

### Prerequisites
- Node.js installed on your system.
- AWS credentials with Bedrock and DynamoDB permissions.

### Installation

Due to some dependency version constraints between React 19 and certain UI libraries, you must use the `--legacy-peer-deps` flag when installing:

```bash
npm install --legacy-peer-deps
```

### Environment Setup

Create a `.env.local` file in the root directory and add your AWS Bedrock, AWS Cognito, and AWS CloudFront values:

```env
# AWS Bedrock Chat Configuration
AWS_REGION=us-east-2
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
BEDROCK_MODEL_ID=your_inference_profile_id_or_arn
DDB_CONVERSATIONS_TABLE=chat_conversations
DDB_MESSAGES_TABLE=chat_messages

# AWS Cognito Configuration
NEXT_PUBLIC_COGNITO_USER_POOL_ID=your_user_pool_id
NEXT_PUBLIC_COGNITO_CLIENT_ID=your_client_id
NEXT_PUBLIC_COGNITO_REGION=us-east-2

# AWS CloudFront Configuration
NEXT_PUBLIC_CLOUDFRONT_URL=https://d2nvreie41u08u.cloudfront.net
```

### AWS Setup

1. In IAM -> Users -> *your user* -> Security credentials, create an access key (Local code), then copy:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
2. In Bedrock -> Inference profiles, copy the application inference profile ID or ARN and set it as:
   - `BEDROCK_MODEL_ID`
3. In Cognito -> User pools -> Test User Pool, copy:
   - User pool ID -> `NEXT_PUBLIC_COGNITO_USER_POOL_ID`
   - App Clients -> Client ID -> `NEXT_PUBLIC_COGNITO_CLIENT_ID`
4. In DynamoDB -> Tables, copy the ARN from each table and set is as:
   - chat_conversations -> `DDB_CONVERSATIONS_TABLE`
   - chat_messages -> `DDB_MESSAGES_TABLE`

### Running the Project

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Project Structure
- `/app`: Next.js App Router (pages, API routes, and layouts).
- `/components`: React components (UI and Map logic).
- `/content`: Scripts, manifest, and config (dataset is on S3).
- `/lib`: Utility functions, Amplify config, and shared types.
- `/hooks`: Custom React hooks (mobile detection, toast notifications).
- `/styles`: Global CSS styles.

