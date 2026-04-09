# Geospatial Dashboard Chatbot

A Next.js 16 application featuring an interactive geospatial dashboard with an integrated AI chatbot.

## Features
- **Interactive Map**: Built with Leaflet and React-Leaflet.
- **AI Chatbot**: Integrated via Vercel AI SDK (OpenAI GPT-4o-mini).
- **Modern UI**: Styled with Tailwind CSS and shadcn/ui.
- **Hurricane Harvey Data**: Visualizes pre/post disaster imagery with building damage overlays.

## Getting Started

### Prerequisites
- Node.js installed on your system.
- An OpenAI API Key.

### Installation

Due to some dependency version constraints between React 19 and certain UI libraries, you must use the `--legacy-peer-deps` flag when installing:

```bash
npm install --legacy-peer-deps
```

### Environment Setup

Create a `.env.local` file in the root directory and add your OpenAI, AWS Cognito, and CloudFront keys:

```env
OPENAI_API_KEY=your_api_key_here

# AWS Cognito Configuration
NEXT_PUBLIC_COGNITO_USER_POOL_ID=your_user_pool_id
NEXT_PUBLIC_COGNITO_CLIENT_ID=your_client_id
NEXT_PUBLIC_COGNITO_REGION=your_aws_region

# CloudFront URL for dataset (images and labels served from S3)
NEXT_PUBLIC_CLOUDFRONT_URL=https://d2nvreie41u08u.cloudfront.net
```

### Running the Project

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Project Structure
- `/app`: Next.js App Router (pages and API routes).
- `/components`: React components (UI and Map logic).
- `/content`: Local scripts and manifest (no large dataset files - hosted on S3).
- `/lib`: Utility functions and shared types.
- `/hooks`: Custom React hooks.
- `/public`: Static assets.

## Data Architecture

The dataset (images and labels) is hosted on **AWS S3 + CloudFront** rather than in the repository. This allows:
- Fast global content delivery via CDN
- No large file downloads for team members
- Easy updates without re-committing data

### For Team Members

To run the application:
1. Clone the repository
2. Set `NEXT_PUBLIC_CLOUDFRONT_URL` in your `.env.local` (see above)
3. Run `npm run dev`

The manifest (`content/manifest.json`) already contains all the CloudFront URLs - no additional setup needed.

### Updating the Dataset

If you need to regenerate the manifest (e.g., to add new patches or change the CloudFront URL):

```bash
# Set the CloudFront URL as an environment variable
export NEXT_PUBLIC_CLOUDFRONT_URL=https://your-cloudfront-url.cloudfront.net

# Regenerate the manifest
python3 content/generate_manifest.py
```

This requires `content/xview_geotransforms.json` which contains the geographic reference data for the patches.

## Dataset & Content

The application visualizes the **xBD Dataset** (Hurricane Harvey patches). Building damage classifications are shown as colored polygons:
- 🟢 Green: No Damage
- 🟡 Yellow: Minor Damage
- 🔴 Red: Major Damage
- 🟣 Purple: Destroyed

### Content Directory

The `content/` folder contains:
- `manifest.json` - Patch bounds and CloudFront URLs for all imagery
- `generate_manifest.py` - Script to regenerate the manifest
- `xview_geotransforms.json` - Geographic reference data for bounds calculation
- Various utility scripts (VLM testing, benchmarking, etc.)

Large dataset files (images/labels) are NOT in the repository - they're hosted on S3/CloudFront.