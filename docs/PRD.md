# Idaho PUC Research Assistant - Product Vision & Technical Architecture

## 1. Product Vision & Goals

### Problem Statement
Regulatory research at the Idaho Public Utilities Commission currently requires **weeks of manual effort** to discover, download, and analyze relevant case documents. Researchers must:
- Manually navigate complex government websites
- Scan hundreds of case descriptions individually
- Download and review dozens of PDF testimonies
- Synthesize findings across multiple cases and utilities
- Repeat this process for different utility types and time periods

This manual process creates significant bottlenecks, delays decision-making, and prevents teams from conducting comprehensive regulatory analysis at the speed business requires.

### Solution Vision
An intelligent research assistant that **reduces regulatory research time from weeks to hours or minutes** by automating document discovery, download, and analysis while providing an AI-powered chat interface for instant insights.

### Target Users
**Primary**: Internal regulatory analysts and researchers
**Secondary**: Cross-functional teams requiring regulatory insights (legal, strategy, compliance)

### Core Value Proposition
- **10x Time Reduction**: From weeks to hours/minutes for comprehensive regulatory research
- **Complete Coverage**: Automated scanning of all relevant cases across Electric and Natural Gas utilities
- **Intelligent Analysis**: AI-powered chat interface with accurate source citations
- **Always Current**: Real-time access to both open and closed regulatory cases

### Business Objectives
1. **Operational Efficiency**: Dramatically reduce time spent on manual regulatory research
2. **Decision Speed**: Enable faster regulatory analysis and strategic decision-making
3. **Team Productivity**: Free up expert analysts for higher-value analytical work
4. **Knowledge Accessibility**: Make regulatory insights accessible to non-expert team members

### Success Metrics
- **Time Saved**: Reduce research time from weeks to <15 minutes
- **Team Adoption**: Internal regulatory team actively using the system
- **Coverage**: >95% accuracy in finding relevant regulatory cases
- **User Satisfaction**: Positive feedback on research quality and ease of use

## 2. Product Requirements

### MVP Scope (Phase 1)
The minimum viable product includes the complete research workflow:

#### Core Features
1. **Intelligent Query Interface**
   - Natural language research queries
   - Utility type selection (Electric, Natural Gas, Both)
   - Date range filtering for case relevance

2. **Automated Document Discovery**
   - Smart scanning of case descriptions across 4 pathways (Electric/Gas × Open/Closed)
   - Intelligent matching of user queries to relevant cases
   - Automated date validation against user-specified ranges

3. **Selective Document Download**
   - Targeted download of Company testimonies and Staff documents
   - Exclusion of irrelevant document types (orders, public comments, etc.)
   - Proper source attribution and metadata tracking

4. **AI-Powered Research Assistant**
   - Chat interface for querying downloaded documents
   - Accurate source citations with case numbers, document types, and page references
   - Context-aware responses drawing from relevant regulatory materials

5. **Real-Time Progress Tracking**
   - Live updates during document discovery and processing
   - Clear visibility into research progress and results summary
   - Error handling and graceful degradation

#### User Stories
- **As a regulatory analyst**, I want to search for "general rate cases" and get all relevant documents from the past 2 years so I can analyze rate trends quickly
- **As a researcher**, I want to ask specific questions about downloaded documents and get answers with proper citations so I can build accurate reports
- **As a team member**, I want to see real-time progress of document processing so I know when my research will be ready

### Future Enhancements (Phase 2+)
- User authentication and session management (Clerk integration)
- Advanced search filters (company-specific, case types, document authors)
- Collaborative research sessions and shared findings
- Export capabilities for reports and presentations
- Integration with internal knowledge management systems

### Non-Functional Requirements
- **Performance**: Complete research jobs within 15 minutes
- **Reliability**: <5% failure rate for valid queries
- **Accuracy**: >95% success rate in finding relevant cases
- **Scalability**: Support multiple concurrent users
- **Security**: Secure handling of government documents and internal research

## 3. Technical Architecture

### System Overview
A full-stack research assistant that automates the discovery, download, and analysis of Idaho Public Utilities Commission documents, providing an intelligent chat interface for regulatory research.

### High-Level Architecture

#### Frontend (Completed)
- **Framework**: React/Next.js with modern UI components
- **Deployment**: Vercel hosting with GitHub integration
- **User Flow**: Query Input → Utility Selection → Date Range → Progress Monitoring → Results Summary → Chat Interface
- **Real-time Updates**: WebSocket connection for progress updates during processing

#### Backend Core Services

##### 1. API Gateway & Orchestration
- **Framework**: Next.js API Routes (for Vercel compatibility)
- **Responsibilities**:
  - Receive user queries and parameters
  - Orchestrate crawler and processing pipeline
  - Manage WebSocket connections for real-time updates
  - Serve chat interface and document retrieval
  - Session management with 30-day auto-cleanup

##### 2. Intelligent Web Crawler
- **Technology**: Puppeteer (Vercel-compatible) with serverless Chrome
- **Deployment**: Vercel serverless functions with extended timeout
- **Core Components**:
  - **Multi-Path Navigator**: 4 concurrent crawls (Electric/Gas × Open/Closed)
  - **Smart Case Matcher**: Semantic matching of queries to case descriptions
  - **Date Filter**: Validates "Date Filed" against user date range
  - **PDF Pipeline**: Navigate to PDF viewer → trigger download → handle file save
  - **Metadata Tracker**: Source, utility type, case status, document type

##### 3. Document Processing Pipeline
- **PDF Parser**: Extract text from downloaded PDFs (pdf-parse for Node.js)
- **Content Chunker**: Split documents into manageable chunks with overlap
- **Metadata Enrichment**: Add source attribution, page numbers, document context
- **Quality Filter**: Remove empty pages, headers/footers, irrelevant content

##### 4. Vector Database & RAG System
- **Vector Store**: Pinecone (Vercel-friendly)
- **Embeddings**: OpenAI text-embedding-ada-002
- **Retrieval**: Semantic search with metadata filtering
- **Response Generation**: OpenAI GPT-4 with retrieved context + citations

##### 5. Data Management
- **File Storage**: Vercel Blob Storage
- **Metadata Database**: Supabase PostgreSQL
- **Cache Layer**: Vercel KV (Redis) for session management
- **Session Cleanup**: Scheduled function for 30-day auto-deletion

### Technology Stack

#### Core Technologies
- **Frontend**: Next.js 14, React, TypeScript
- **Backend**: Next.js API Routes, TypeScript
- **Database**: Supabase PostgreSQL
- **Vector Store**: Pinecone
- **File Storage**: Vercel Blob Storage
- **Cache**: Vercel KV (Redis)
- **Web Scraping**: Puppeteer
- **AI**: OpenAI GPT-4 + Embeddings

#### Development Tools
- **Version Control**: GitHub
- **Deployment**: Vercel (auto-deploy from GitHub)
- **Environment**: Docker for local development
- **Monitoring**: Vercel Analytics + Custom logging

### Data Models

#### Research Job
```json
{
  "job_id": "uuid",
  "session_id": "uuid",
  "user_query": "string",
  "utilities": ["electric", "natural_gas"],
  "date_range": {"start": "date", "end": "date"},
  "status": "pending|processing|completed|failed",
  "progress": {"current_step": "string", "percentage": "number"},
  "results_summary": {"cases_found": "number", "documents_downloaded": "number"},
  "created_at": "timestamp",
  "expires_at": "timestamp"
}
```

#### Document Metadata
```json
{
  "document_id": "uuid",
  "job_id": "uuid",
  "case_number": "string",
  "utility_type": "electric|natural_gas",
  "case_status": "open|closed",
  "document_type": "company|staff",
  "date_filed": "date",
  "blob_url": "string",
  "page_count": "number",
  "processed": "boolean",
  "vector_indexed": "boolean"
}
```

### API Architecture

#### Core Endpoints
```
/api
├── /research
│   ├── start.js          - POST: Initialize research job
│   ├── [jobId]/status.js - GET: Job status
│   └── [jobId]/progress  - WebSocket endpoint
├── /chat
│   ├── [sessionId].js    - POST: Send message
│   └── history/[sessionId].js - GET: Chat history
├── /documents
│   └── [docId].js        - GET: Retrieve document
└── /cleanup
    └── sessions.js       - Scheduled cleanup function
```

### Crawler Architecture

#### Multi-Path Execution
```
CrawlerOrchestrator
├── ElectricCrawler
│   ├── OpenCasesCrawler  → https://puc.idaho.gov/case?util=1&closed=0
│   └── ClosedCasesCrawler → https://puc.idaho.gov/case?util=1&closed=1
└── NaturalGasCrawler
    ├── OpenCasesCrawler  → https://puc.idaho.gov/case?util=4&closed=0
    └── ClosedCasesCrawler → https://puc.idaho.gov/case?util=4&closed=1
```

#### Crawler Workflow
1. **Navigate** to cases listing page
2. **Scan** case descriptions for query matches
3. **Filter** by user-specified date range
4. **Extract** case URLs for matches
5. **Navigate** to case summary pages
6. **Validate** date filed against criteria
7. **Download** Company and Staff documents only
8. **Track** metadata and processing status

### Processing Pipeline

#### Document Processing Flow
```
DocumentProcessor
├── PDFExtractor      → Extract text from downloaded PDFs
├── TextCleaner       → Remove headers, footers, artifacts
├── ChunkGenerator    → Split into manageable pieces
├── MetadataEnricher  → Add source attribution
└── VectorIndexer     → Index for semantic search
```

#### RAG Query Pipeline
```
QueryProcessor
├── QueryAnalyzer     → Extract intent, entities, keywords
├── VectorRetriever   → Semantic search + metadata filtering
├── ContextAggregator → Combine relevant chunks
├── ResponseGenerator → LLM with citations
└── CitationValidator → Verify source accuracy
```

### Deployment Strategy

#### Development Workflow
1. **Local Development**: Docker compose with local PostgreSQL + Redis
2. **Staging**: Vercel preview deployments from feature branches
3. **Production**: Vercel production from main branch

#### Environment Configuration
```bash
# Core Services
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
PINECONE_API_KEY=
OPENAI_API_KEY=
VERCEL_BLOB_READ_WRITE_TOKEN=

# Session Management
SESSION_CLEANUP_INTERVAL=86400000  # 24 hours
SESSION_EXPIRY_DAYS=30
```

### Multi-User Architecture

#### Session Management
- Browser fingerprint-based identification (pre-auth)
- 30-day automatic session cleanup
- Concurrent job limits per session
- Rate limiting to prevent abuse

#### Scaling Considerations
- **Vercel Function Limits**: 15-minute max execution time
- **Concurrent Processing**: Job queue for multiple users
- **Memory Management**: Efficient chunking and streaming
- **Cold Start Optimization**: Function warming strategies

### Security & Reliability

#### Current Phase (Prototype)
- Session-based identification
- Input validation and sanitization
- Rate limiting per session
- Secure environment variable management
- Graceful error handling and retry logic

#### Future Phase (Enterprise)
- Clerk authentication integration
- Role-based access control
- Enhanced audit logging
- Compliance with government document handling

### Performance Requirements

#### System Performance
- **Research Job Completion**: <15 minutes end-to-end
- **Query Response Time**: <5 seconds for chat interactions
- **Concurrent Users**: Support 10+ simultaneous research jobs
- **Document Processing**: 500MB+ of PDFs per research session
- **Reliability**: <5% failure rate for valid queries

#### Quality Assurance
- **Case Discovery Accuracy**: >95% of relevant cases found
- **Document Download Success**: >98% success rate
- **Citation Accuracy**: Verified source attribution
- **Content Quality**: Clean text extraction and chunking

## 4. Development Roadmap

### Phase 1: MVP (Current Scope)
**Timeline**: 4-6 weeks
**Goal**: Complete end-to-end research workflow

#### Week 1-2: Core Infrastructure
- [ ] Set up Next.js project with TypeScript
- [ ] Configure Supabase database and Pinecone vector store
- [ ] Implement basic API routes structure
- [ ] Set up Vercel deployment pipeline

#### Week 3-4: Crawler Development
- [ ] Build Puppeteer-based web crawler
- [ ] Implement multi-path navigation (4 concurrent routes)
- [ ] Add intelligent case description matching
- [ ] Create PDF download and storage pipeline

#### Week 5-6: AI Integration & Testing
- [ ] Implement document processing and vectorization
- [ ] Build RAG system with OpenAI integration
- [ ] Add chat interface and citation system
- [ ] Comprehensive testing and bug fixes

### Phase 2: Enterprise Readiness
**Timeline**: 2-4 weeks after MVP
**Goal**: Production-ready deployment

- [ ] Implement Clerk authentication
- [ ] Add advanced search and filtering
- [ ] Create user dashboard and session management
- [ ] Performance optimization and monitoring
- [ ] Security audit and compliance review

### Phase 3: Advanced Features
**Timeline**: TBD based on user feedback
**Goal**: Enhanced research capabilities

- [ ] Collaborative research sessions
- [ ] Advanced analytics and insights
- [ ] Export and reporting features
- [ ] Integration with internal systems
- [ ] Mobile-responsive improvements

## 5. Success Criteria

### Technical Success Criteria
- [ ] **Functional MVP**: Complete research workflow from query to chat
- [ ] **Performance**: <15 minute research job completion
- [ ] **Accuracy**: >95% relevant case discovery rate
- [ ] **Reliability**: <5% failure rate for valid queries
- [ ] **Scalability**: Support multiple concurrent users

### Business Success Criteria
- [ ] **Time Reduction**: Demonstrate weeks-to-minutes improvement
- [ ] **User Adoption**: Internal regulatory team actively using system
- [ ] **Feedback Quality**: Positive user feedback on research quality
- [ ] **Knowledge Access**: Non-experts successfully conducting research

### Delivery Milestones
- [ ] **Week 2**: Core infrastructure and database setup complete
- [ ] **Week 4**: Working crawler with document download capability
- [ ] **Week 6**: Complete MVP with AI chat interface
- [ ] **Week 8**: Production deployment and user testing
- [ ] **Week 10**: Performance optimization and enterprise features

---

## Getting Started

This document serves as the North Star for the Idaho PUC Research Assistant project. For implementation details, see:

- `/docs/api-specification.md` - Detailed API documentation
- `/docs/crawler-implementation.md` - Web scraping technical details
- `/docs/deployment-guide.md` - Setup and deployment instructions
- `README.md` - Quick start guide for developers

For questions or clarifications, refer to the project requirements or technical architecture sections above.