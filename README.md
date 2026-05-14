# Geospatial Dashboard Chatbot

A Next.js 16 application featuring an interactive geospatial dashboard with an integrated AI chatbot. Visit the deployed website here: http://geoview.jumpingcrab.com:3000/

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

# Optional Dataset Manifest Generation (S3-backed)
S3_BUCKET=your_dataset_bucket_name
S3_LABELS_PREFIX=labels
S3_IMAGES_PREFIX=images
DATASET_DISASTER_PREFIX=joplin-tornado
DATASET_IMAGE_EXTENSION=webp
GEOTRANSFORM_IMAGE_EXTENSION=png
```

### AWS Setup

1. In IAM -> Users -> *your user* -> Security credentials, create an access key (Local code), then copy:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
2. In Bedrock -> Inference profiles -> Application, copy the inference profile ID or ARN and set it as:
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

### Regenerate Dataset Manifest

The manifest generator reads label JSON files from S3 and writes `content/manifest.json`.

```bash
python content/generate_manifest.py
```

### Chatbot Disaster Context

The chat API injects local disaster context into the model system prompt from:

- `content/manifest.json` (auto-generated summary)
- `content/chat-context/disaster_damages.json` (structured damage stats)
- `content/chat-context/reference_notes.md` (curated website notes and facts)

To regenerate structured damage stats from S3 labels:

```bash
python content/generate_disaster_damages.py
```

## Project Structure
- `/app`: Next.js App Router (pages, API routes, and layouts).
- `/components`: React components (UI and Map logic).
- `/content`: Scripts, manifest, and config (dataset is on S3).
- `/lib`: Utility functions, Amplify config, and shared types.
- `/hooks`: Custom React hooks (mobile detection, toast notifications).
- `/styles`: Global CSS styles.

