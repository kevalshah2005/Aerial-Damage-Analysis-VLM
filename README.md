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
Create a `.env.local` file in the root directory and add your OpenAI API key:

```env
OPENAI_API_KEY=your_api_key_here
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
- `/lib`: Utility functions.
- `/hooks`: Custom React hooks.
- `/public`: Static assets.
