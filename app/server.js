const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const https = require('https');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const ollamaUrl = process.env.OLLAMA_URL || 'http://ollama:11434';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
async function generateVector(query) {
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('Query must be a non-empty string');
  }

  try {
    const response = await fetch(`${ollamaUrl}/api/embed`, {
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
      const model ='llama3.2:1b'; //'gemma2:2b',
      const options = {
        temperature: 0.7,
        num_predict: 150,
        top_p: 0.9
      };
      try {
        console.log(`🤖 Trying model: ${model}, path: ${ollamaUrl}/api/generate`);
        
        // Call local model
        const response = await fetch(`${ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            prompt,
            stream: false,
            options
          })
        });

        if (response.ok) {
          const data = await response.json();
          if (data.response && data.response.trim()) {
            console.log(`✅ Successfully used model: ${model}`);
            return data.response.trim();
          }
        }
        
        console.log(`❌ Model ${model} failed or returned empty response :(`);
      } catch (modelError) {
        console.log(`❌ Model ${model} error:`, modelError.message);
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

/**
 * Simple template rendering function
 * @param {string} templatePath - Path to the HTML template
 * @param {Object} data - Data to render in template
 * @returns {Promise<string>} - Rendered HTML
 */
async function renderTemplate(templatePath, data = {}) {
  try {
    let template = await fs.readFile(templatePath, 'utf8');
    
    // Replace simple variables
    template = template.replace(/\{\{query\}\}/g, data.query || '');
    
    // Build results section
    let resultsHtml = '';
    
    if (data.hasResults && data.similarItems && data.similarItems.length > 0) {
      // AI Recommendation section
      let aiSection = '';
      if (data.aiRecommendation) {
        aiSection = `
          <div class="ai-recommendation">
            <div class="ai-badge">AI Powered</div>
            <h4>
              <span class="ai-icon">🤖</span>
              Smart Product Recommendation
            </h4>
            <p>${data.aiRecommendation}</p>
          </div>
        `;
      }
      
      // Products section
      const productsHtml = data.similarItems.map(item => `
        <div class="result-card">
          <a href="${item.url || '#'}" target="_blank" class="product-title">
            ${item.product_name || 'Unknown Product'}
          </a>
          <div class="product-meta">
            <span class="price">€${item.final_price || 'N/A'}</span>
            <span class="rating">⭐ ${item.rating || 'N/A'}</span>
            <span class="similarity">${item.similarity_percentage || '0'}% match</span>
          </div>
          <div class="category">
            📂 ${item.category_name || 'N/A'} → ${item.root_category_name || 'N/A'}
          </div>
          <div class="description truncated">
            ${item.description || 'No description available'}
          </div>
        </div>
      `).join('');
      
      resultsHtml = `
        <div class="search-results">
          ${aiSection}
          <h3>🔍 Semantic Search Results for "${data.query}" (${data.resultCount} items found)</h3>
          ${productsHtml}
        </div>
      `;
    } else if (data.query) {
      resultsHtml = `
        <div class="no-results">
          <h3>🔍 No results found for "${data.query}"</h3>
          <p>Try a different search term or check if embeddings are generated for the products.</p>
        </div>
      `;
    }
    
    // Replace results section
    template = template.replace('<!-- RESULTS_SECTION -->', resultsHtml);
    
    return template;
  } catch (error) {
    console.error('Template rendering error:', error);
    return `<h1>Template Error</h1><p>${error.message}</p>`;
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
  try {
    const query = req.query.q || '';
    let queryVector = null;
    let similarItems = [];
    let aiRecommendation = null;
    
    if (query) {
      queryVector = await generateVector(query);
      similarItems = await findSimilarVectors(queryVector, 5);
      if (similarItems.length > 0) {
        aiRecommendation = await getResponse(query, similarItems);
      }
    }
    
    // Prepare template data
    const templateData = {
      query,
      similarItems,
      aiRecommendation,
      hasResults: similarItems.length > 0,
      resultCount: similarItems.length
    };
    
    // Render template
    const templatePath = path.join(__dirname, 'templates', 'index.html');
    const html = await renderTemplate(templatePath, templateData);
    
    res.send(html);
  } catch (error) {
    console.error('Route error:', error);
    res.status(500).send(`<h1>Server Error</h1><p>${error.message}</p>`);
  }
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