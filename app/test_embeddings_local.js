#!/usr/bin/env node

const mysql = require('mysql2/promise');
const http = require('http');

/**
 * Test script for the Node.js Embedding Generation System with Local Ollama
 * 
 * This script validates:
 * 1. Environment variables are set correctly
 * 2. Database connection and table structure
 * 3. Local Ollama connectivity and model availability
 * 4. Sample embedding generation using nomic-embed-text
 */

class EmbeddingSystemTest {
    constructor() {
        this.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
        this.model = 'nomic-embed-text';
        
        this.dbConfig = {
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 3306,
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || 'rootpassword',
            database: process.env.DB_NAME || 'walmart_db',
            charset: 'utf8mb4'
        };
        
        this.connection = null;
    }

    /**
     * Test 1: Environment Variables
     */
    testEnvironment() {
        console.log('🧪 Test 1: Environment Variables');
        
        console.log('✅ Using Local Ollama Model');
        console.log(`   Ollama URL: ${this.ollamaUrl}`);
        console.log(`   Model: ${this.model}`);
        
        console.log('✅ Database configuration:');
        console.log(`   Host: ${this.dbConfig.host}:${this.dbConfig.port}`);
        console.log(`   Database: ${this.dbConfig.database}`);
        console.log(`   User: ${this.dbConfig.user}`);
        
        return true;
    }

    /**
     * Test 2: Database Connection
     */
    async testDatabase() {
        console.log('\n🧪 Test 2: Database Connection');
        
        try {
            this.connection = await mysql.createConnection(this.dbConfig);
            console.log('✅ Connected to MariaDB database');
            
            // Test basic query
            const [rows] = await this.connection.execute('SELECT 1 as test');
            console.log('✅ Database query test passed');
            
            // Check if walmart_products table exists
            const [tables] = await this.connection.execute(
                "SHOW TABLES LIKE 'walmart_products'"
            );
            
            if (tables.length === 0) {
                console.log('❌ walmart_products table not found');
                return false;
            }
            
            console.log('✅ walmart_products table found');
            
            // Check table structure
            const [columns] = await this.connection.execute(
                "SHOW COLUMNS FROM walmart_products LIKE 'embedding'"
            );
            
            if (columns.length === 0) {
                console.log('❌ embedding column not found in walmart_products table');
                return false;
            }
            
            console.log('✅ embedding column found');
            
            // Count total products
            const [countResult] = await this.connection.execute(
                'SELECT COUNT(*) as total FROM walmart_products'
            );
            const totalProducts = countResult[0].total;
            console.log(`✅ Total products in database: ${totalProducts}`);
            
            // Count products with embeddings
            const [embeddingCountResult] = await this.connection.execute(
                'SELECT COUNT(*) as with_embeddings FROM walmart_products WHERE embedding IS NOT NULL'
            );
            const withEmbeddings = embeddingCountResult[0].with_embeddings;
            console.log(`✅ Products with embeddings: ${withEmbeddings}`);
            
            const needEmbeddings = totalProducts - withEmbeddings;
            console.log(`📊 Products needing embeddings: ${needEmbeddings}`);
            
            return true;
            
        } catch (error) {
            console.log('❌ Database connection failed:', error.message);
            return false;
        }
    }

    /**
     * Test 3: Ollama API Connection
     */
    async testOllamaAPI() {
        console.log('\n🧪 Test 3: Ollama API Connection');
        
        try {
            const testText = "This is a test product for embedding generation.";
            console.log(`Testing with text: "${testText}"`);
            
            const embedding = await this.generateTestEmbedding(testText);
            
            if (Array.isArray(embedding) && embedding.length > 0) {
                console.log(`✅ Successfully generated embedding`);
                console.log(`✅ Embedding dimensions: ${embedding.length}`);
                console.log(`✅ First few values: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);
                return true;
            } else {
                console.log('❌ Invalid embedding response');
                return false;
            }
            
        } catch (error) {
            console.log('❌ Ollama API test failed:', error.message);
            return false;
        }
    }

    /**
     * Generate test embedding using Ollama
     */
    async generateTestEmbedding(text) {
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
     * Test 4: Sample Product Embedding
     */
    async testSampleProduct() {
        console.log('\n🧪 Test 4: Sample Product Embedding');
        
        try {
            // Get a sample product
            const [products] = await this.connection.execute(
                'SELECT id, product_name, category_name, root_category_name, final_price, rating, description FROM walmart_products LIMIT 1'
            );
            
            if (products.length === 0) {
                console.log('❌ No products found in database');
                return false;
            }
            
            const product = products[0];
            console.log(`✅ Sample product: ID ${product.id} - "${product.product_name}"`);
            
            // Create product summary
            const summary = `${product.product_name} (Category: ${product.category_name}, ${product.root_category_name} - Price: €${product.final_price} - Rating: ${product.rating}). ${product.description}.`;
            console.log(`✅ Product summary created (${summary.length} characters)`);
            
            // Generate embedding
            const embedding = await this.generateTestEmbedding(summary);
            console.log(`✅ Embedding generated successfully (${embedding.length} dimensions)`);
            
            return true;
            
        } catch (error) {
            console.log('❌ Sample product test failed:', error.message);
            return false;
        }
    }

    /**
     * Clean up
     */
    async cleanup() {
        if (this.connection) {
            await this.connection.end();
            console.log('\n✅ Database connection closed');
        }
    }

    /**
     * Run all tests
     */
    async runTests() {
        console.log('🧪 Node.js Embedding System Test Suite (Local Ollama)');
        console.log('=' .repeat(60));
        
        let allPassed = true;
        
        // Test 1: Environment
        if (!this.testEnvironment()) {
            allPassed = false;
        }
        
        // Test 2: Database
        if (!await this.testDatabase()) {
            allPassed = false;
        }
        
        // Test 3: Ollama API
        if (!await this.testOllamaAPI()) {
            allPassed = false;
        }
        
        // Test 4: Sample Product
        if (!await this.testSampleProduct()) {
            allPassed = false;
        }
        
        // Final results
        console.log('\n' + '='.repeat(60));
        console.log('🧪 TEST RESULTS');
        console.log('='.repeat(60));
        
        if (allPassed) {
            console.log('✅ All tests passed! Your system is ready for embedding generation.');
            console.log('\n🚀 Next steps:');
            console.log('   Run: node generate_embeddings.js');
        } else {
            console.log('❌ Some tests failed. Please check the errors above.');
            console.log('\n🔧 Common solutions:');
            console.log('   1. Ensure Docker containers are running: docker compose up -d');
            console.log('   2. Check Ollama model is pulled: docker exec ollama-rag-demo ollama list');
            console.log('   3. Verify Ollama API: curl http://localhost:11434/api/tags');
        }
        
        console.log('='.repeat(60));
        
        await this.cleanup();
        
        return allPassed;
    }
}

// Run tests if executed directly
if (require.main === module) {
    const tester = new EmbeddingSystemTest();
    tester.runTests().catch(error => {
        console.error('Unhandled error:', error);
        process.exit(1);
    });
}

module.exports = EmbeddingSystemTest;