# Geospatial Dashboard Chatbot

A Next.js 16 application featuring an interactive geospatial dashboard with an integrated AI chatbot.

## Features
- **Interactive Map**: Built with Leaflet and React-Leaflet.
- **AI Chatbot**: Integrated via Vercel AI SDK (OpenAI GPT-4o-mini).
- **Modern UI**: Styled with Tailwind CSS and shadcn/ui.

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
Create a `.env.local` file in the root directory and add your OpenAI and AWS Cognito keys:

```env
OPENAI_API_KEY=your_api_key_here

# AWS Cognito Configuration
NEXT_PUBLIC_COGNITO_USER_POOL_ID=your_user_pool_id
NEXT_PUBLIC_COGNITO_CLIENT_ID=your_client_id
NEXT_PUBLIC_COGNITO_REGION=your_aws_region
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
- `/content`: Local dataset storage (Hurricane Harvey xBD patches).
- `/lib`: Utility functions and shared types.
- `/hooks`: Custom React hooks.
- `/public`: Static assets.

## Dataset & Content

The application is designed to process and visualize the **xBD Dataset** (specifically Hurricane Harvey patches). The `content/` folder is used as a local repository for these files.

### Required File Pairs
For the dashboard to correctly align imagery on the map, you should upload/include pairs of files:
1.  **Imagery (.png)**: 1024x1024 orthorectified image patches (e.g., `hurricane-harvey_00000037_post_disaster.png`).
2.  **Metadata/Labels (.json)**: Contains building polygons in both pixel (`xy`) and geographic (`lng_lat`) coordinates.

### How it works
The system automatically pairs `.png` and `.json` files by their filename. It parses the **WKT (Well-Known Text)** building polygons from the JSON to calculate a precise geographic scale and offset, allowing the images to be "draped" accurately over the Leaflet map as `ImageOverlays`.
