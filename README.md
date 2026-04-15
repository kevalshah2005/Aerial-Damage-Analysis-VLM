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

Create a `.env.local` file in the root directory and add your OpenAI, AWS Cognito, and local dataset path:

```env
OPENAI_API_KEY=your_api_key_here

# AWS Cognito Configuration
NEXT_PUBLIC_COGNITO_USER_POOL_ID=your_user_pool_id
NEXT_PUBLIC_COGNITO_CLIENT_ID=your_client_id
NEXT_PUBLIC_COGNITO_REGION=your_aws_region

# Local dataset root (absolute path). Required for manifest generation metadata
# and for local /api/dataset/* file-serving routes.
# Example (Windows): DATASET_LOCAL_ROOT=D:\\datasets\\harvey-geo
# Required folders:
#   <DATASET_LOCAL_ROOT>/images/*.png
#   <DATASET_LOCAL_ROOT>/labels/*.json
DATASET_LOCAL_ROOT=your_absolute_dataset_path
```

After updating dataset settings, regenerate the manifest:

```bash
python content/generate_manifest.py
```

### Running the Project

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Project Structure
- `/app`: Next.js App Router (pages, API routes, and layouts).
- `/components`: React components (UI and Map logic).
- `/content`: Scripts, manifest, and geospatial config.
- `/lib`: Utility functions, Amplify config, and shared types.
- `/hooks`: Custom React hooks (mobile detection, toast notifications).
- `/styles`: Global CSS styles.

