# MariaDB + Node.js RAG Demo

This project provides Docker configurations for running a Node.js application with MariaDB 11.8 database.

## Docker Configurations

### Docker Compose (Recommended)

The `docker-compose.yml` file provides a multi-service setup with separate containers for MariaDB and the Node.js application.

**Services:**
- **MariaDB 11.8**: Database server with vector support on port 3306
- **Node.js LTS (v20)**: Application server on port 3000 with AI endpoints
- **Ollama**: Local AI inference server on port 11434 with embedding and text generation models

**To use:**
```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Stop and remove volumes (data will be lost)
docker-compose down -v
```

## Database Configuration

**Default Database Settings:**
- **Host**: localhost (or `mariadb` in Docker Compose)
- **Port**: 3306
- **Database**: rag_demo
- **Root Password**: rootpassword
- **Application User**: app_user
- **Application Password**: app_password

**Database Tables:**
- **walmart_products**: Complete product data with JSON fields (44 columns)
- **products**: Simplified product table for easier querying and full-text search

**Data Import:**
The project automatically imports Walmart product data from `walmart-products.csv` (1,011 products) using **native MariaDB CSV import** during database initialization. The import process:

1. **`01-create-tables.sql`** - Creates database schema with proper indexes
2. **`02-import-csv-data.sql`** - Native SQL LOAD DATA INFILE for CSV import

**Data includes:**
- Product details (name, description, brand, category)
- Pricing information with scientific notation handling (2.290000000000000e+01 → $22.90)
- JSON fields (specifications, reviews, images, colors, sizes)
- Customer reviews and ratings
- Boolean flags (delivery/pickup availability)

## Vector Embeddings Setup

This project supports vector embeddings using both **local Ollama models** and Google's Vertex AI. The embedding system enables semantic search and RAG (Retrieval-Augmented Generation) applications with AI-powered product recommendations.

### Option 1: Local Ollama Models (Recommended)

The project includes **Ollama** service in Docker Compose for local AI model inference, providing privacy and faster response times.

#### Prerequisites
- Docker and Docker Compose
- At least 4GB RAM allocated to Docker (8GB recommended for larger models)

#### Available Models
The system automatically uses the `nomic-embed-text` model for embeddings and supports multiple text generation models:

**Embedding Models:**
- `nomic-embed-text` (274MB, 768 dimensions) - **Default for embeddings**

**Text Generation Models:**
- `llama3.2:1b` (1.3GB) - Lightweight text generation
- `gemma2:2b` (1.6GB) - Google's efficient model
- `mistral:7b` (4.1GB) - Good general purpose
- `codellama:7b` (3.8GB) - Code generation specialist

#### Quick Setup with Ollama

1. **Start all services including Ollama**:
   ```bash
   docker compose up -d
   ```

2. **Pull additional models** (optional):
   ```bash
   # Pull lightweight text generation model
   docker exec ollama-rag-demo ollama pull llama3.2:1b
   
   # Pull Google's efficient model
   docker exec ollama-rag-demo ollama pull gemma2:2b
   
   # Pull Mistral for better text generation
   docker exec ollama-rag-demo ollama pull mistral:7b
   
   # Pull CodeLlama for code-related queries
   docker exec ollama-rag-demo ollama pull codellama:7b
   ```

3. **Check available models**:
   ```bash
   docker exec ollama-rag-demo ollama list
   ```

4. **Test a model**:
   ```bash
   docker exec ollama-rag-demo ollama run llama3.2:1b "Hello, can you help me choose a product?"
   ```

5. **Generate Embeddings**
   ```bash
   # Pull llama3.2:1b for the Smart Product Recommendation
   docker exec ollama-rag-demo ollama pull llama3.2:1b

   # Pull nomic-embed-text for application Semantic Search Results
   docker exec ollama-rag-demo ollama pull nomic-embed-text
   # Generate the embeddings for database elements.
   docker exec nodejs-rag-demo node generate_embeddings.js
   ```

6. **Search Application**

   Use URL https:/localhost:3000 corresponding to nodejs-rag-demo.

#### Generate Embeddings with Local Ollama

1. **Generate embeddings for all products**:
   ```bash
   cd app
   node generate_embeddings.js
   ```

The script automatically uses the local Ollama `nomic-embed-text` model when `USE_LOCAL_EMBEDDINGS=true` (default in Docker).

#### Ollama API Endpoints

Once Ollama is running, you can use these endpoints:

```bash
# Generate text with different models
curl http://localhost:11434/api/generate -d '{
  "model": "llama3.2:1b",
  "prompt": "Write a short product recommendation:",
  "stream": false
}'

# Generate embeddings
curl http://localhost:11434/api/embed -d '{
  "model": "nomic-embed-text",
  "input": "wireless headphones"
}'

# List available models
curl http://localhost:11434/api/tags
```

### API Integration

Once embeddings are generated, you can use them for:
- **Semantic search** across product descriptions
- **Product recommendations** based on similarity
- **RAG applications** for product question-answering
- **Hybrid search** combining full-text and vector search

## Project Structure

```
mariadb-nodejs-rag-demo/
├── app/                          # Node.js application
│   ├── Dockerfile               # App container
│   ├── package.json            # Dependencies
│   ├── server.js               # 🤖 Enhanced API server with AI endpoints
│   └── generate_embeddings.js  # 🔥 Vector embedding generation (Local + Google)
├── init-db/                     # Database initialization
│   ├── 01-create-tables.sql    # Schema with VECTOR support
│   ├── 02-import-csv-data.sql  # Native CSV import
│   └── walmart-products.csv    # Product data (1,011 records)
├── docker-compose.yml          # 🔥 Multi-service: MariaDB + Node.js + Ollama
├── ollama-init.sh             # Ollama model initialization script
└── README.md                  # This documentation
```

## Environment Variables

**For Node.js application:**
```env
NODE_ENV=development
DB_HOST=localhost
DB_PORT=3306
DB_NAME=rag_demo
DB_USER=app_user
DB_PASSWORD=app_password
USE_LOCAL_EMBEDDINGS=true     # Use Ollama instead of Google API
OLLAMA_URL=http://ollama:11434
GOOGLE_API_KEY=your-api-key   # Fallback when Ollama unavailable
```

**For Ollama service:**
```env
OLLAMA_HOST=0.0.0.0          # Allow external connections
```

**For embedding generation:**
```env
GOOGLE_API_KEY=your-vertex-ai-api-key  # Optional: fallback only
DB_HOST=localhost          # Optional - defaults provided
DB_PORT=3306              # Optional
DB_USER=app_user          # Optional
DB_PASSWORD=app_password  # Optional
DB_NAME=rag_demo         # Optional
```

## Getting Started

1. **Choose your preferred option** (Docker Compose is recommended for development)

2. **Create or verify package.json** in the `app` directory:
```bash
cd app
```

The `package.json` should look like this:
```json
{
  "name": "mariadb-nodejs-rag-demo",
  "version": "1.0.0",
  "description": "RAG demo with MariaDB and Node.js",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "mysql2": "^3.6.5"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}
```

3. **The server.js file** is already configured in the `app` directory with:
```javascript
// Basic Express.js server with MariaDB connection
// Health check endpoint at /health
// Sample REST API endpoints for products
```

4. **Start the services**:
```bash
# From the root directory
docker-compose up -d
```

## Notes

- The MariaDB data is persisted in a Docker volume named `mariadb_data`
- The application code is mounted as a volume from `./app` for development (hot reload)
- All containers are connected via a custom network `rag-network`
- Health checks are configured for all services
- The Node.js container waits for MariaDB to be healthy before starting

## License

This project is licensed under the MIT License.
