# Idaho PUC Research Assistant

> **Reduce regulatory research time from weeks to minutes with AI-powered document discovery and analysis.**

An intelligent research assistant that automates the discovery, download, and analysis of Idaho Public Utilities Commission documents, providing an AI-powered chat interface for instant regulatory insights.

## 🎯 Problem & Solution

**Problem**: Regulatory research currently takes weeks of manual effort - scanning case descriptions, downloading PDFs, and synthesizing findings across multiple utilities and time periods.

**Solution**: Automated research workflow that discovers relevant cases, downloads documents, and provides an AI chat interface for instant insights with proper citations.

## ✨ Key Features

- **🔍 Intelligent Discovery**: Automatically finds relevant cases across Electric and Natural Gas utilities
- **📅 Smart Filtering**: Date range filtering with automatic validation
- **⚡ Rapid Processing**: Complete research jobs in <15 minutes vs weeks of manual work
- **💬 AI Chat Interface**: Ask questions about downloaded documents with accurate citations
- **📊 Real-time Progress**: Live updates during document processing
- **📁 Selective Download**: Only downloads relevant Company and Staff testimonies

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker (for local development)
- Environment variables (see `.env.example`)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/idaho-puc-research-assistant
cd idaho-puc-research-assistant

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your API keys

# Start development server
npm run dev
```

Visit `http://localhost:3000` to start researching!

### Docker Development

```bash
# Start local services (PostgreSQL, Redis)
docker-compose up -d

# Run the application
npm run dev
```

## 📖 How It Works

1. **Enter Research Query**: "general rate cases", "energy efficiency programs", etc.
2. **Select Utilities**: Electric, Natural Gas, or Both
3. **Set Date Range**: Filter cases by filing date
4. **Automated Processing**: 
   - Scans 4 case listing pages (Electric/Gas × Open/Closed)
   - Matches descriptions to your query
   - Downloads relevant Company and Staff documents
5. **AI Chat Interface**: Ask questions about your research with cited sources

## 🏗️ Architecture

### Tech Stack
- **Frontend**: Next.js 14, React, TypeScript
- **Backend**: Next.js API Routes
- **Database**: Supabase PostgreSQL
- **Vector Store**: Pinecone
- **AI**: OpenAI GPT-4 + Embeddings
- **Storage**: Vercel Blob Storage
- **Deployment**: Vercel

### Key Components
- **Intelligent Crawler**: Puppeteer-based document discovery
- **Document Processor**: PDF text extraction and chunking
- **RAG System**: Vector search with citation generation
- **Session Manager**: 30-day auto-cleanup

## 📁 Project Structure

```
├── src/
│   ├── app/                 # Next.js 14 app router
│   ├── components/          # React components
│   ├── lib/                 # Utilities and configurations
│   └── types/               # TypeScript definitions
├── api/                     # API routes
│   ├── research/            # Research job management
│   ├── chat/                # AI chat interface
│   └── crawler/             # Web scraping logic
├── docs/                    # Documentation
└── docker-compose.yml       # Local development services
```

## 🔧 Development

### Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run test         # Run test suite
npm run lint         # Lint code
npm run type-check   # TypeScript checking
```

### Environment Variables

```bash
# Core Services
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_key
PINECONE_API_KEY=your_pinecone_key
OPENAI_API_KEY=your_openai_key
VERCEL_BLOB_READ_WRITE_TOKEN=your_blob_token

# Optional
SESSION_CLEANUP_INTERVAL=86400000  # 24 hours
SESSION_EXPIRY_DAYS=30
```

## 🚢 Deployment

### Vercel (Recommended)

1. Connect GitHub repository to Vercel
2. Set environment variables in Vercel dashboard
3. Deploy automatically on push to `main`

### Manual Deployment

```bash
npm run build
npm start
```

## 📊 Performance

- **Research Job Completion**: <15 minutes
- **Case Discovery Accuracy**: >95%
- **Chat Response Time**: <5 seconds
- **Concurrent Users**: 10+ supported
- **Document Processing**: 500MB+ PDFs per session

## 🔒 Security

- Session-based identification (pre-authentication phase)
- Input validation and sanitization
- Rate limiting per session
- Secure environment variable management
- 30-day automatic data cleanup

## 📋 Roadmap

### ✅ Phase 1: MVP (Current)
- Core research workflow
- AI chat interface
- Document discovery and processing

### 🔄 Phase 2: Enterprise (Next)
- User authentication (Clerk)
- Advanced search filters
- Performance optimization
- Production monitoring

### 📅 Phase 3: Advanced (Future)
- Collaborative research sessions
- Export capabilities
- Internal system integrations
- Mobile optimization

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## 📚 Documentation

- **[Product Vision & Architecture](docs/north-star.md)** - Complete project overview
- **[API Documentation](docs/api-specification.md)** - Detailed API reference
- **[Crawler Implementation](docs/crawler-implementation.md)** - Web scraping details
- **[Deployment Guide](docs/deployment-guide.md)** - Setup instructions

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙋‍♂️ Support

For questions, issues, or feature requests:

1. Check existing [Issues](https://github.com/your-org/idaho-puc-research-assistant/issues)
2. Create a new issue with detailed description
3. Contact the development team

---

**Built with ❤️ for faster regulatory research**