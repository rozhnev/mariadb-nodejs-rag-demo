const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const https = require('https');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'app_user',
  password: process.env.DB_PASSWORD || 'app_password',
  database: process.env.DB_NAME || 'rag_demo',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

/**
 * Generate vector embedding using local Ollama nomic-embed-text model
 * @param {string} query - The input text to generate embedding for
 * @returns {Promise<number[]>} - Array of embedding values
 */
async function generateVectorOllama(query) {
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('Query must be a non-empty string');
  }

  try {
    const response = await fetch('http://ollama:11434/api/embed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'nomic-embed-text',
        input: query.trim()
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.embeddings && data.embeddings[0]) {
      return data.embeddings[0];
    } else {
      throw new Error('Invalid response format from Ollama');
    }
  } catch (error) {
    console.error('Ollama embedding error:', error);
    throw new Error(`Ollama embedding failed: ${error.message}`);
  }
}

/**
 * Generate vector embedding for input text using Google's Gemini Embedding API
 * @param {string} query - The input text to generate embedding for
 * @returns {Promise<number[]>} - Array of embedding values
 */
async function generateVector(query) {
  // Try Ollama first, fallback to Google API
  const useLocal = process.env.USE_LOCAL_EMBEDDINGS === 'true';
  
  if (useLocal) {
    try {
      console.log('Using local Ollama embedding model...');
      return await generateVectorOllama(query);
    } catch (error) {
      console.log('Ollama failed, falling back to Google API:', error.message);
    }
  }

  return new Promise((resolve, reject) => {
    const apiKey = process.env.GOOGLE_API_KEY;
    
    if (!apiKey) {
      reject(new Error('GOOGLE_API_KEY environment variable is required'));
      return;
    }

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      reject(new Error('Query must be a non-empty string'));
      return;
    }

    const postData = JSON.stringify({
      model: 'models/gemini-embedding-001',
      content: {
        parts: [{ text: query.trim() }]
      }
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: `/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          
          if (res.statusCode === 200) {
            if (response.embedding && response.embedding.values) {
              resolve(response.embedding.values);
            } else {
              reject(new Error('Invalid response format: missing embedding values'));
            }
          } else {
            reject(new Error(`API Error ${res.statusCode}: ${response.error?.message || data}`));
          }
        } catch (parseError) {
          reject(new Error(`JSON parse error: ${parseError.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Request error: ${error.message}`));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Find the 5 most similar embedding vectors in the database
 * @param {number[]} queryVector - The input vector to compare against
 * @param {number} limit - Number of results to return (default: 5)
 * @returns {Promise<Array>} - Array of products with similarity scores
 */
async function findSimilarVectors(queryVector, limit = 5) {
  if (!Array.isArray(queryVector) || queryVector.length === 0) {
    throw new Error('Query vector must be a non-empty array');
  }

  if (!queryVector.every(val => typeof val === 'number')) {
    throw new Error('Query vector must contain only numbers');
  }

  try {
    // Convert query vector to the format expected by MariaDB
    const vectorString = JSON.stringify(queryVector);
    
    // Use MariaDB's vector similarity search with cosine distance
    const query = `
      SELECT 
        wp.id,
        wp.product_name,
        wp.category_name,
        wp.root_category_name,
        wp.final_price,
        wp.rating,
        wp.description,
        wp.url,
        CONCAT(
          wp.product_name, " (",
          "Category: ", wp.category_name, ", ", wp.root_category_name,
          " - Price: €", wp.final_price,
          " - Rating: ", wp.rating,
          "). ", wp.description, "."
        ) AS product_summary,
        VEC_DISTANCE_COSINE(wp.embedding, VEC_FromText(?)) as vector_distance
      FROM walmart_products wp
      WHERE wp.embedding IS NOT NULL
      ORDER BY vector_distance ASC
      LIMIT ?
    `;

    const [rows] = await pool.execute(query, [vectorString, limit]);
    
    // Transform similarity score (lower distance = higher similarity)
    const results = rows.map(row => ({
      ...row,
      vector_distance: parseFloat(row.vector_distance),
      similarity_percentage: ((1 - parseFloat(row.vector_distance)) * 100).toFixed(2)
    }));

    return results;
  } catch (error) {
    console.error('Error in findSimilarVectors:', error);
    throw new Error(`Vector similarity search failed: ${error.message}`);
  }
}

/**
 * Generate AI response using local LLaMA model for product recommendations
 * @param {string} userQuery - User's search query
 * @param {Array} products - Array of similar products to recommend from
 * @returns {Promise<string>} - AI-generated product recommendation
 */
async function getResponse(userQuery, products) {
  if (!userQuery || typeof userQuery !== 'string' || userQuery.trim().length === 0) {
    throw new Error('User query must be a non-empty string');
  }

  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('Products array must be provided and non-empty');
  }

  try {
    // Format products for the prompt
    const productsText = products.map((product, index) => {
      return `${index + 1}. ${product.name || product.product_name} (${product.brand || 'No brand'})
   Category: ${product.category || product.category_name || 'N/A'}
   Price: $${product.price || product.final_price || 'N/A'}
   Rating: ${product.rating || 'N/A'}/5.0
   Description: ${product.description || 'No description available'}`;
    }).join('\n\n');

    // Create the prompt
    const prompt = `You are an expert sales assistant. Help me choose the best product for my needs.
Recommend only one product from the list below and explain why it's the best choice in one short paragraph.

I'm looking for ${userQuery}.

Available products:

${productsText}`;

    // Try different models in order of preference
    const modelOrder = ['gemma2:2b', 'llama3.2:1b', 'nomic-embed-text'];
    
    for (const model of modelOrder) {
      try {
        console.log(`🤖 Trying model: ${model}`);
        
        // Call local model
        const response = await fetch('http://ollama:11434/api/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: model,
            prompt: prompt,
            stream: false,
            options: {
              temperature: 0.7,
              num_predict: 150,
              top_p: 0.9
            }
          })
        });

        if (response.ok) {
          const data = await response.json();
          if (data.response && data.response.trim()) {
            console.log(`✅ Successfully used model: ${model}`);
            return data.response.trim();
          }
        }
        
        console.log(`❌ Model ${model} failed or returned empty response`);
      } catch (modelError) {
        console.log(`❌ Model ${model} error:`, modelError.message);
      }
    }
    
    throw new Error('All models failed');
  } catch (error) {
    console.error('LLaMA generation error:', error);
    
    // Enhanced fallback with product analysis
    const topProduct = products[0];
    const productFeatures = [];
    
    // Analyze product features
    if (topProduct.rating && parseFloat(topProduct.rating) >= 4.5) {
      productFeatures.push('highly rated');
    }
    if (topProduct.description && topProduct.description.toLowerCase().includes('organic')) {
      productFeatures.push('organic');
    }
    if (topProduct.description && topProduct.description.toLowerCase().includes('natural')) {
      productFeatures.push('natural');
    }
    if (topProduct.category_name && topProduct.category_name.toLowerCase().includes('kids')) {
      productFeatures.push('kid-friendly');
    }
    
    const featuresText = productFeatures.length > 0 
      ? ` It stands out for being ${productFeatures.join(', ')}.`
      : '';
    
    return `Based on your search for "${userQuery}", I recommend the **${topProduct.name || topProduct.product_name}**. This product has a ${topProduct.rating || 'good'}/5.0 rating and is priced at $${topProduct.price || topProduct.final_price || 'N/A'}.${featuresText} Among the available options, it appears to be the best match for your specific needs with excellent customer satisfaction.`;
  }
}


// Test database connection
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Connected to MariaDB successfully!');
    
    // Create a sample table if it doesn't exist
    await connection.execute(`SELECT VERSION() AS Version;`);
    
    connection.release();
  } catch (error) {
    console.error('❌ Error connecting to MariaDB:', error.message);
    // Don't exit in Docker, keep trying
    setTimeout(testConnection, 5000);
  }
}

// Routes
app.get('/', async (req, res) => {
  const query = req.query.q || '';
  let queryVector = null;
  let similarItems = [];
  let aiRecommendation = null;
  if (query) {
    queryVector = await generateVector(query);
    similarItems = await findSimilarVectors(queryVector, 5);
    aiRecommendation = await getResponse(query, similarItems);

  }
  const htmlPage = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Walmart Products Search - RAG Demo</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #004c91;
            text-align: center;
            margin-bottom: 30px;
        }
        .search-form {
            margin-bottom: 30px;
        }
        label {
            display: block;
            margin-bottom: 10px;
            font-weight: bold;
            color: #333;
        }
        input[type="text"] {
            width: 100%;
            padding: 12px;
            border: 2px solid #ddd;
            border-radius: 4px;
            font-size: 16px;
            box-sizing: border-box;
        }
        input[type="text"]:focus {
            border-color: #004c91;
            outline: none;
        }
        button {
            background-color: #004c91;
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 4px;
            font-size: 16px;
            cursor: pointer;
            margin-top: 10px;
        }
        button:hover {
            background-color: #003d73;
        }
        .search-results {
            margin: 20px 0;
        }
        .result-card {
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 15px;
            background-color: #fff;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .result-card:hover {
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
            transform: translateY(-1px);
            transition: all 0.2s ease;
        }
        .product-title {
            font-size: 18px;
            font-weight: bold;
            color: #004c91;
            margin-bottom: 8px;
            text-decoration: none;
        }
        .product-title:hover {
            color: #003d73;
            text-decoration: underline;
        }
        .product-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
            flex-wrap: wrap;
            gap: 10px;
        }
        .price {
            font-size: 20px;
            font-weight: bold;
            color: #e47911;
        }
        .rating {
            background-color: #f0f8ff;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 14px;
            color: #004c91;
        }
        .similarity {
            background-color: #d4edda;
            color: #155724;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
        }
        .category {
            color: #666;
            font-size: 14px;
            background-color: #f8f9fa;
            padding: 2px 6px;
            border-radius: 3px;
        }
        .description {
            color: #555;
            line-height: 1.4;
            margin-top: 10px;
        }
        .description.truncated {
            max-height: 60px;
            overflow: hidden;
            position: relative;
        }
        .description.truncated::after {
            content: "...";
            position: absolute;
            bottom: 0;
            right: 0;
            background: white;
            padding-left: 20px;
        }
        .no-results {
            text-align: center;
            color: #666;
            padding: 20px;
            background-color: #f8f9fa;
            border-radius: 4px;
            margin: 20px 0;
        }
        .ai-recommendation {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 25px;
            border-radius: 12px;
            margin: 20px 0;
            box-shadow: 0 8px 32px rgba(102, 126, 234, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.2);
            position: relative;
            overflow: hidden;
        }
        .ai-recommendation::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(45deg, rgba(255,255,255,0.1) 0%, transparent 50%, rgba(255,255,255,0.1) 100%);
            pointer-events: none;
        }
        .ai-recommendation h4 {
            margin: 0 0 15px 0;
            font-size: 20px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 10px;
            position: relative;
            z-index: 1;
        }
        .ai-recommendation .ai-icon {
            font-size: 24px;
            background: rgba(255, 255, 255, 0.2);
            padding: 8px;
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 40px;
            height: 40px;
        }
        .ai-recommendation p {
            margin: 0;
            font-size: 16px;
            line-height: 1.6;
            position: relative;
            z-index: 1;
            background: rgba(255, 255, 255, 0.1);
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid rgba(255, 255, 255, 0.5);
        }
        .ai-recommendation .ai-badge {
            position: absolute;
            top: 15px;
            right: 15px;
            background: rgba(255, 255, 255, 0.2);
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            z-index: 1;
        }
        .ai-recommendation:hover {
            transform: translateY(-2px);
            box-shadow: 0 12px 40px rgba(102, 126, 234, 0.4);
            transition: all 0.3s ease;
        }
        .ai-recommendation .ai-icon {
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); }
        }
        .search-results h3 {
            color: #004c91;
            border-bottom: 2px solid #e1e8ed;
            padding-bottom: 10px;
            margin-bottom: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🛒 Walmart Products Search</h1>
        <p style="text-align: center; color: #666; margin-bottom: 30px;">
            MariaDB + Node.js RAG Demo - Search through 1,011 products
        </p>
        
        <form class="search-form" action="/" method="get">
            <label for="product-search">Find product:</label>
            <input 
                type="text" 
                id="product-search" 
                name="q" 
                placeholder="Enter product name, brand, or description..."
                value="${query}"
                required
            >
            <button type="submit">Search</button>
        </form>
        
        ${similarItems.length > 0 ? `
        <div class="search-results">
            ${aiRecommendation ? `
            <div class="ai-recommendation">
                <div class="ai-badge">AI Powered</div>
                <h4>
                    <span class="ai-icon">🤖</span>
                    Smart Product Recommendation
                </h4>
                <p>${aiRecommendation}</p>
            </div>
            ` : ''}
            <h3>🔍 Semantic Search Results for "${query}" (${similarItems.length} items found)</h3>
            ${similarItems.map(item => `
                <div class="result-card">
                    <a href="${item.url}" target="_blank" class="product-title">
                        ${item.product_name}
                    </a>
                    <div class="product-meta">
                        <span class="price">€${item.final_price}</span>
                        <span class="rating">⭐ ${item.rating}</span>
                        <span class="similarity">${item.similarity_percentage}% match</span>
                    </div>
                    <div class="category">
                        📂 ${item.category_name} → ${item.root_category_name}
                    </div>
                    <div class="description truncated">
                        ${item.description}
                    </div>
                </div>
            `).join('')}
        </div>
        ` : query ? `
        <div class="no-results">
            <h3>🔍 No results found for "${query}"</h3>
            <p>Try a different search term or check if embeddings are generated for the products.</p>
        </div>
        ` : ''}
    </div>
</body>
</html>
  `;
  
  res.send(htmlPage);
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    
    res.json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      database: 'connected'
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'unhealthy', 
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error.message
    });
  }
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️  Database: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
  
  // Test database connection on startup
  testConnection();
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});