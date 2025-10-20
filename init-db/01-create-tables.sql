-- Create walmart_products table with optimized schema
DROP TABLE IF EXISTS walmart_products;

CREATE TABLE walmart_products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    timestamp DATETIME,
    url TEXT,
    final_price DECIMAL(10, 2),
    sku VARCHAR(50) UNIQUE,
    currency VARCHAR(10),
    gtin VARCHAR(50),
    specifications JSON,
    image_urls JSON,
    top_reviews JSON,
    rating_stars JSON,
    related_pages JSON,
    available_for_delivery BOOLEAN,
    available_for_pickup BOOLEAN,
    brand VARCHAR(255),
    breadcrumbs JSON,
    category_ids TEXT,
    review_count INT,
    description TEXT,
    product_id VARCHAR(50),
    product_name TEXT,
    review_tags JSON,
    category_url TEXT,
    category_name VARCHAR(255),
    category_path VARCHAR(500),
    root_category_url TEXT,
    root_category_name VARCHAR(255),
    upc VARCHAR(50),
    tags JSON,
    main_image TEXT,
    rating DECIMAL(3, 2),
    unit_price DECIMAL(10, 2),
    unit VARCHAR(50),
    aisle VARCHAR(255),
    free_returns TEXT,
    sizes JSON,
    colors JSON,
    seller VARCHAR(255),
    other_attributes JSON,
    customer_reviews JSON,
    ingredients TEXT,
    initial_price DECIMAL(10, 2),
    discount DECIMAL(10, 2),
    ingredients_full JSON,
    categories JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    embedding VECTOR(768),

    -- Indexes for better query performance
    INDEX idx_sku (sku),
    INDEX idx_brand (brand),
    INDEX idx_category_name (category_name),
    INDEX idx_product_name (product_name(100)),
    INDEX idx_final_price (final_price),
    INDEX idx_rating (rating),
    INDEX idx_timestamp (timestamp)
);

-- Create a simplified products table for easier querying
DROP TABLE IF EXISTS products;

CREATE TABLE products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sku VARCHAR(50) UNIQUE,
    name TEXT,
    description TEXT,
    brand VARCHAR(255),
    category VARCHAR(255),
    price DECIMAL(10, 2),
    original_price DECIMAL(10, 2),
    discount DECIMAL(10, 2),
    rating DECIMAL(3, 2),
    review_count INT,
    main_image TEXT,
    url TEXT,
    available_for_delivery BOOLEAN DEFAULT TRUE,
    available_for_pickup BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Full-text search index
    FULLTEXT(name, description, brand, category),
    
    -- Regular indexes
    INDEX idx_brand (brand),
    INDEX idx_category (category),
    INDEX idx_price (price),
    INDEX idx_rating (rating),
    INDEX idx_sku (sku)
);

-- Grant permissions to app user
GRANT SELECT, INSERT, UPDATE, DELETE ON rag_demo.walmart_products TO 'app_user'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON rag_demo.products TO 'app_user'@'%';
FLUSH PRIVILEGES;