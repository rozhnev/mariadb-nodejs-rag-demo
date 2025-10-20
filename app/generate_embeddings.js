#!/usr/bin/env node

const mysql = require('mysql2/promise');
const http = require('http');
const fs = require('fs');
const path = require('path');

/**
 * Walmart Product Embeddings Generator - Node.js Version with Local Ollama
 * 
 * This script connects to MariaDB, fetches all products from walmart_products table,
 * generates embeddings using local Ollama nomic-embed-text model,
 * and stores them in the database for RAG applications.
 */

class WalmartProductEmbeddings {
    constructor() {
        this.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
        this.model = 'nomic-embed-text';
        this.batchSize = 10;
        this.maxRetries = 3;
        this.retryDelay = 1000;
        
        // Database configuration
        this.dbConfig = {
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 3306,
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || 'rootpassword',
            database: process.env.DB_NAME || 'walmart_db',
            charset: 'utf8mb4'
        };
        
        this.connection = null;
        this.stats = {
            total: 0,
            processed: 0,
            successful: 0,
            failed: 0,
            skipped: 0,
            startTime: null,
            endTime: null
        };
    }

    /**
     * Validate required environment variables
     */
    validateEnvironment() {
        console.log('✓ Using local Ollama embedding model');
        console.log(`✓ Ollama URL: ${this.ollamaUrl}`);
        console.log(`✓ Model: ${this.model}`);
    }

    /**
     * Connect to MariaDB database
     */
    async connectDatabase() {
        try {
            this.connection = await mysql.createConnection(this.dbConfig);
            console.log('✓ Connected to MariaDB database');
            
            // Test the connection
            await this.connection.execute('SELECT 1');
            console.log('✓ Database connection verified');
            
        } catch (error) {
            throw new Error(`Database connection failed: ${error.message}`);
        }
    }

    /**
     * Make HTTP request to local Ollama embedding API
     */
    async makeRequest(text) {
        return new Promise((resolve, reject) => {
            const postData = JSON.stringify({
                model: this.model,
                input: text
            });

            const url = new URL(`${this.ollamaUrl}/api/embed`);
            const options = {
                hostname: url.hostname,
                port: url.port || 11434,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = http.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        
                        if (res.statusCode === 200) {
                            if (response.embeddings && response.embeddings[0]) {
                                resolve(response.embeddings[0]);
                            } else {
                                reject(new Error('Invalid response format from Ollama: missing embeddings'));
                            }
                        } else {
                            reject(new Error(`Ollama API Error ${res.statusCode}: ${response.error || data}`));
                        }
                    } catch (parseError) {
                        reject(new Error(`JSON parse error: ${parseError.message}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Ollama request error: ${error.message}`));
            });

            req.write(postData);
            req.end();
        });
    }

    /**
     * Generate embedding for a single text with retry logic
     */
    async generateEmbedding(text, retryCount = 0) {
        try {
            const embedding = await this.makeRequest(text);
            return embedding;
        } catch (error) {
            if (retryCount < this.maxRetries) {
                console.log(`  Retry ${retryCount + 1}/${this.maxRetries} after error: ${error.message}`);
                await this.sleep(this.retryDelay * (retryCount + 1));
                return this.generateEmbedding(text, retryCount + 1);
            } else {
                throw error;
            }
        }
    }

    /**
     * Create product summary for embedding
     */
    createProductSummary(product) {
        return product.product_summary;
    }

    /**
     * Get products that need embeddings
     */
    async getProductsForEmbedding() {
        const query = `
            SELECT id, CONCAT(
                product_name, " (",
                "Category: ", category_name, ", ", root_category_name,
                " - Price: €", final_price,
                " - Rating: ", rating,
                "). ", description, "."
            ) AS product_summary
            FROM walmart_products
            WHERE embedding IS NULL;
        `;
        
        const [rows] = await this.connection.execute(query);
        return rows;
    }

    /**
     * Update product with embedding
     */
    async updateProductEmbedding(productId, embedding) {
        const embeddingJson = JSON.stringify(embedding);
        const query = `
            UPDATE walmart_products 
            SET embedding = Vec_FromText(?)
            WHERE id = ?
        `;
        
        await this.connection.execute(query, [embeddingJson, productId]);
    }

    /**
     * Process products in batches
     */
    async processBatch(products) {
        const results = [];
        
        for (const product of products) {
            try {
                const summary = this.createProductSummary(product);
                
                if (!summary.trim()) {
                    console.log(`  Product ${product.id}: Skipping (no content)`);
                    this.stats.skipped++;
                    continue;
                }

                console.log(`  Product ${product.id}: Generating embedding...`);
                const embedding = await this.generateEmbedding(summary);
                
                await this.updateProductEmbedding(product.id, embedding);
                
                console.log(`  Product ${product.id}: ✓ Embedding saved (${embedding.length} dimensions)`);
                this.stats.successful++;
                
                results.push({
                    id: product.id,
                    success: true,
                    embedding: embedding
                });
                
            } catch (error) {
                console.log(`  Product ${product.id}: ✗ Failed - ${error.message}`);
                this.stats.failed++;
                
                results.push({
                    id: product.id,
                    success: false,
                    error: error.message
                });
            }
            
            this.stats.processed++;
            
            // Progress update
            const progress = ((this.stats.processed / this.stats.total) * 100).toFixed(1);
            console.log(`  Progress: ${this.stats.processed}/${this.stats.total} (${progress}%)`);
        }
        
        return results;
    }

    /**
     * Main processing function
     */
    async processAllProducts() {
        console.log('\n🔄 Starting embedding generation...');
        this.stats.startTime = new Date();
        
        // Get products that need embeddings
        const products = await this.getProductsForEmbedding();
        this.stats.total = products.length;
        
        console.log(`📊 Found ${this.stats.total} products needing embeddings`);
        
        if (this.stats.total === 0) {
            console.log('✅ All products already have embeddings!');
            return;
        }
        
        // Process in batches
        for (let i = 0; i < products.length; i += this.batchSize) {
            const batch = products.slice(i, i + this.batchSize);
            const batchNum = Math.floor(i / this.batchSize) + 1;
            const totalBatches = Math.ceil(products.length / this.batchSize);
            
            console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} products):`);
            
            await this.processBatch(batch);
            
            // Small delay between batches to be respectful to API
            if (i + this.batchSize < products.length) {
                await this.sleep(500);
            }
        }
        
        this.stats.endTime = new Date();
    }

    /**
     * Print comprehensive statistics
     */
    printStatistics() {
        console.log('\n' + '='.repeat(60));
        console.log('📈 EMBEDDING GENERATION STATISTICS');
        console.log('='.repeat(60));
        
        const duration = this.stats.endTime - this.stats.startTime;
        const minutes = Math.floor(duration / 60000);
        const seconds = Math.floor((duration % 60000) / 1000);
        
        console.log(`⏱️  Total time: ${minutes}m ${seconds}s`);
        console.log(`📊 Total products: ${this.stats.total}`);
        console.log(`✅ Successful: ${this.stats.successful}`);
        console.log(`❌ Failed: ${this.stats.failed}`);
        console.log(`⏭️  Skipped: ${this.stats.skipped}`);
        
        if (this.stats.total > 0) {
            const successRate = ((this.stats.successful / this.stats.total) * 100).toFixed(1);
            console.log(`📈 Success rate: ${successRate}%`);
            
            if (this.stats.successful > 0) {
                const avgTime = duration / this.stats.successful;
                console.log(`⚡ Average time per embedding: ${avgTime.toFixed(0)}ms`);
            }
        }
        
        console.log('='.repeat(60));
    }

    /**
     * Sleep utility function
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Clean up database connection
     */
    async cleanup() {
        if (this.connection) {
            await this.connection.end();
            console.log('✓ Database connection closed');
        }
    }

    /**
     * Run the complete embedding generation process
     */
    async run() {
        try {
            console.log('🚀 Walmart Product Embeddings Generator');
            console.log('🔧 Using Local Ollama nomic-embed-text model\n');
            
            this.validateEnvironment();
            await this.connectDatabase();
            await this.processAllProducts();
            
            this.printStatistics();
            
            if (this.stats.successful > 0) {
                console.log('\n✅ Embedding generation completed successfully!');
                console.log('🔍 Your products are now ready for semantic search and RAG applications.');
            } else {
                console.log('\n⚠️  No embeddings were generated successfully.');
            }
            
        } catch (error) {
            console.error('\n❌ Error during embedding generation:');
            console.error(error.message);
            process.exit(1);
        } finally {
            await this.cleanup();
        }
    }
}

// Run the script if executed directly
if (require.main === module) {
    const generator = new WalmartProductEmbeddings();
    generator.run().catch(error => {
        console.error('Unhandled error:', error);
        process.exit(1);
    });
}

module.exports = WalmartProductEmbeddings;