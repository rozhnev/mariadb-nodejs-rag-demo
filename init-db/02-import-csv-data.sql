-- Native CSV import for Walmart products data
-- This file will be executed automatically by MariaDB during initialization

-- Set proper SQL modes and enable local file loading
SET sql_mode = '';
SET GLOBAL local_infile = 1;

-- Create temporary staging table with all columns as TEXT for flexible import
CREATE TEMPORARY TABLE temp_walmart_import (
    timestamp_str TEXT,
    url TEXT,
    final_price_str TEXT,
    sku TEXT,
    currency TEXT,
    gtin TEXT,
    specifications TEXT,
    image_urls TEXT,
    top_reviews TEXT,
    rating_stars TEXT,
    related_pages TEXT,
    available_for_delivery_str TEXT,
    available_for_pickup_str TEXT,
    brand TEXT,
    breadcrumbs TEXT,
    category_ids TEXT,
    review_count_str TEXT,
    description TEXT,
    product_id TEXT,
    product_name TEXT,
    review_tags TEXT,
    category_url TEXT,
    category_name TEXT,
    category_path TEXT,
    root_category_url TEXT,
    root_category_name TEXT,
    upc TEXT,
    tags TEXT,
    main_image TEXT,
    rating_str TEXT,
    unit_price_str TEXT,
    unit TEXT,
    aisle TEXT,
    free_returns TEXT,
    sizes TEXT,
    colors TEXT,
    seller TEXT,
    other_attributes TEXT,
    customer_reviews TEXT,
    ingredients TEXT,
    initial_price_str TEXT,
    discount_str TEXT,
    ingredients_full TEXT,
    categories TEXT
);

-- Import CSV data with proper handling of quoted fields and escapes
LOAD DATA LOCAL INFILE '/docker-entrypoint-initdb.d/walmart-products.csv'
INTO TABLE temp_walmart_import
FIELDS TERMINATED BY ','
OPTIONALLY ENCLOSED BY '"'
ESCAPED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 ROWS;

-- Insert cleaned data into walmart_products table
INSERT IGNORE INTO walmart_products (
    timestamp, url, final_price, sku, currency, gtin, specifications, image_urls,
    top_reviews, rating_stars, related_pages, available_for_delivery, available_for_pickup,
    brand, breadcrumbs, category_ids, review_count, description, product_id, product_name,
    review_tags, category_url, category_name, category_path, root_category_url,
    root_category_name, upc, tags, main_image, rating, unit_price, unit, aisle,
    free_returns, sizes, colors, seller, other_attributes, customer_reviews, ingredients,
    initial_price, discount, ingredients_full, categories
)
SELECT 
    -- Convert timestamp
    CASE 
        WHEN TRIM(timestamp_str) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}' 
        THEN STR_TO_DATE(LEFT(TRIM(timestamp_str), 19), '%Y-%m-%d %H:%i:%s')
        ELSE NULL 
    END as timestamp,
    
    -- Clean URL
    NULLIF(TRIM(url), '') as url,
    
    -- Convert final_price (handle scientific notation)
    CASE 
        WHEN TRIM(final_price_str) REGEXP '^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?$'
        THEN CAST(TRIM(final_price_str) AS DECIMAL(10,2))
        ELSE NULL 
    END as final_price,
    
    -- Clean and validate SKU
    TRIM(sku) as sku,
    
    NULLIF(TRIM(currency), '') as currency,
    NULLIF(TRIM(gtin), '') as gtin,
    
    -- Handle JSON fields (keep as text for now)
    CASE WHEN TRIM(specifications) IN ('', '{}', 'null') THEN NULL ELSE specifications END,
    CASE WHEN TRIM(image_urls) IN ('', '[]', 'null') THEN NULL ELSE image_urls END,
    CASE WHEN TRIM(top_reviews) IN ('', '{}', 'null') THEN NULL ELSE top_reviews END,
    CASE WHEN TRIM(rating_stars) IN ('', '{}', 'null') THEN NULL ELSE rating_stars END,
    CASE WHEN TRIM(related_pages) IN ('', '[]', 'null') THEN NULL ELSE related_pages END,
    
    -- Convert booleans
    CASE 
        WHEN LOWER(TRIM(available_for_delivery_str)) IN ('true', '1') THEN 1
        WHEN LOWER(TRIM(available_for_delivery_str)) IN ('false', '0') THEN 0
        ELSE NULL 
    END as available_for_delivery,
    
    CASE 
        WHEN LOWER(TRIM(available_for_pickup_str)) IN ('true', '1') THEN 1
        WHEN LOWER(TRIM(available_for_pickup_str)) IN ('false', '0') THEN 0
        ELSE NULL 
    END as available_for_pickup,
    
    NULLIF(TRIM(brand), '') as brand,
    CASE WHEN TRIM(breadcrumbs) IN ('', '[]', 'null') THEN NULL ELSE breadcrumbs END,
    NULLIF(TRIM(category_ids), '') as category_ids,
    
    -- Convert review count
    CASE 
        WHEN TRIM(review_count_str) REGEXP '^[0-9]+$' 
        THEN CAST(TRIM(review_count_str) AS UNSIGNED)
        ELSE 0 
    END as review_count,
    
    NULLIF(TRIM(description), '') as description,
    NULLIF(TRIM(product_id), '') as product_id,
    NULLIF(TRIM(product_name), '') as product_name,
    
    CASE WHEN TRIM(review_tags) IN ('', '[]', 'null') THEN NULL ELSE review_tags END,
    NULLIF(TRIM(category_url), '') as category_url,
    NULLIF(TRIM(category_name), '') as category_name,
    NULLIF(TRIM(category_path), '') as category_path,
    NULLIF(TRIM(root_category_url), '') as root_category_url,
    NULLIF(TRIM(root_category_name), '') as root_category_name,
    NULLIF(TRIM(upc), '') as upc,
    
    CASE WHEN TRIM(tags) IN ('', '[]', 'null') THEN NULL ELSE tags END,
    
    -- Clean main image (remove extra quotes)
    NULLIF(TRIM(BOTH '"' FROM TRIM(main_image)), '') as main_image,
    
    -- Convert rating
    CASE 
        WHEN TRIM(rating_str) REGEXP '^[0-9]+\.?[0-9]*$' 
        THEN CAST(TRIM(rating_str) AS DECIMAL(3,2))
        ELSE NULL 
    END as rating,
    
    -- Convert unit_price (handle scientific notation)
    CASE 
        WHEN TRIM(unit_price_str) REGEXP '^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?$'
        THEN CAST(TRIM(unit_price_str) AS DECIMAL(10,2))
        ELSE NULL 
    END as unit_price,
    
    NULLIF(TRIM(unit), '') as unit,
    NULLIF(TRIM(aisle), '') as aisle,
    NULLIF(TRIM(free_returns), '') as free_returns,
    
    CASE WHEN TRIM(sizes) IN ('', '[]', 'null') THEN NULL ELSE sizes END,
    CASE WHEN TRIM(colors) IN ('', '[]', 'null') THEN NULL ELSE colors END,
    
    NULLIF(TRIM(seller), '') as seller,
    
    CASE WHEN TRIM(other_attributes) IN ('', '[]', 'null') THEN NULL ELSE other_attributes END,
    CASE WHEN TRIM(customer_reviews) IN ('', '[]', 'null') THEN NULL ELSE customer_reviews END,
    
    NULLIF(TRIM(ingredients), '') as ingredients,
    
    -- Convert initial_price (handle scientific notation)
    CASE 
        WHEN TRIM(initial_price_str) REGEXP '^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?$'
        THEN CAST(TRIM(initial_price_str) AS DECIMAL(10,2))
        ELSE NULL 
    END as initial_price,
    
    -- Convert discount (handle scientific notation)
    CASE 
        WHEN TRIM(discount_str) REGEXP '^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?$'
        THEN CAST(TRIM(discount_str) AS DECIMAL(10,2))
        ELSE NULL 
    END as discount,
    
    CASE WHEN TRIM(ingredients_full) IN ('', '[]', 'null') THEN NULL ELSE ingredients_full END,
    CASE WHEN TRIM(categories) IN ('', '[]', 'null') THEN NULL ELSE categories END
    
FROM temp_walmart_import
WHERE TRIM(sku) IS NOT NULL AND TRIM(sku) != '';

-- Create simplified products table entries
INSERT IGNORE INTO products (
    sku, name, description, brand, category, price, original_price, discount,
    rating, review_count, main_image, url, available_for_delivery, available_for_pickup
)
SELECT DISTINCT
    w.sku,
    w.product_name,
    CASE 
        WHEN CHAR_LENGTH(w.description) > 1000 
        THEN CONCAT(LEFT(w.description, 997), '...')
        ELSE w.description 
    END,
    w.brand,
    w.category_name,
    w.final_price,
    w.initial_price,
    CASE 
        WHEN w.initial_price > 0 AND w.final_price > 0 AND w.initial_price > w.final_price
        THEN w.initial_price - w.final_price 
        ELSE COALESCE(w.discount, 0)
    END,
    CASE WHEN w.rating BETWEEN 0 AND 5 THEN w.rating ELSE NULL END,
    w.review_count,
    w.main_image,
    w.url,
    COALESCE(w.available_for_delivery, 1),
    COALESCE(w.available_for_pickup, 0)
FROM walmart_products w
WHERE w.sku IS NOT NULL AND w.product_name IS NOT NULL;

-- Display import statistics
SELECT 'CSV Import Complete' as Status;
SELECT COUNT(*) as 'Total Walmart Products Imported' FROM walmart_products;
SELECT COUNT(*) as 'Total Simplified Products Created' FROM products;
SELECT COUNT(*) as 'Products with Valid Ratings' FROM products WHERE rating > 0;
SELECT ROUND(AVG(price), 2) as 'Average Product Price' FROM products WHERE price > 0;
SELECT COUNT(DISTINCT brand) as 'Unique Brands' FROM products WHERE brand IS NOT NULL;
SELECT COUNT(DISTINCT category) as 'Unique Categories' FROM products WHERE category IS NOT NULL;