-- Full e-commerce schema and catalog seed (idempotent)
-- Tables: products, customers, orders, order_items, carts, cart_items

BEGIN;

-- Products (with category)
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  category TEXT NOT NULL DEFAULT 'Accessories'
);

-- If an earlier version created products without category, add it now
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Accessories';

-- Helpful indexes for search and uniqueness
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);
CREATE INDEX IF NOT EXISTS idx_products_lower_name ON products ((lower(name)));

-- Auto-fix for older databases: remove duplicate product names before enforcing uniqueness
WITH keep AS (
  SELECT LOWER(name) AS lname, MIN(id) AS keep_id
  FROM products
  GROUP BY LOWER(name)
),
dups AS (
  SELECT p.id
  FROM products p
  JOIN keep k ON LOWER(p.name) = k.lname
  WHERE p.id <> k.keep_id
)
DELETE FROM products p
USING dups d
WHERE p.id = d.id;

-- Enforce uniqueness (prevents future duplicates and makes inserts idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_name_ci ON products ((lower(name)));

-- Customers
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- Order items
CREATE TABLE IF NOT EXISTS order_items (
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  PRIMARY KEY (order_id, product_id)
);

-- Shopping cart tables
CREATE TABLE IF NOT EXISTS carts (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active', -- active, checked_out, abandoned
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- Ensure at most one active cart per customer
CREATE UNIQUE INDEX IF NOT EXISTS ux_carts_active_per_customer ON carts (customer_id) WHERE (status = 'active');

CREATE TABLE IF NOT EXISTS cart_items (
  cart_id INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  PRIMARY KEY (cart_id, product_id)
);

-- Seed a demo customer
INSERT INTO customers (name, email)
VALUES ('Alice Example', 'alice@example.com')
ON CONFLICT DO NOTHING;

-- Categorize any legacy seed items if present
UPDATE products SET category = 'T-Shirts' WHERE name ILIKE 'T-Shirt%';
UPDATE products SET category = 'Hoodies' WHERE name ILIKE 'Hoodie%';
UPDATE products SET category = 'Accessories' WHERE name ILIKE 'Sticker Pack%';

-- Full catalog (~50 SKUs), idempotent via unique name index
-- T-Shirts (8)
INSERT INTO products (name, description, price_cents, stock, category) VALUES
  ('Classic Tee', '100% cotton classic t-shirt', 1799, 120, 'T-Shirts'),
  ('Graphic Tee Mountain', 'Graphic tee with mountain print', 2199, 80, 'T-Shirts'),
  ('Graphic Tee Wave', 'Graphic tee with ocean wave print', 2199, 90, 'T-Shirts'),
  ('Pocket Tee', 'Soft tee with chest pocket', 1999, 70, 'T-Shirts'),
  ('Long Sleeve Tee', 'Comfy long sleeve t-shirt', 2499, 60, 'T-Shirts'),
  ('Vintage Wash Tee', 'Garment-dyed vintage wash', 2399, 65, 'T-Shirts'),
  ('Athletic Tee', 'Moisture-wicking training tee', 2599, 75, 'T-Shirts'),
  ('Ringer Tee', 'Retro ringer t-shirt', 2099, 55, 'T-Shirts')
ON CONFLICT DO NOTHING;

-- Hoodies (5)
INSERT INTO products (name, description, price_cents, stock, category) VALUES
  ('Fleece Hoodie', 'Warm fleece-lined hoodie', 4499, 40, 'Hoodies'),
  ('Zip Hoodie', 'Full-zip midweight hoodie', 4299, 50, 'Hoodies'),
  ('Lightweight Hoodie', 'Breathable hoodie for layering', 3899, 65, 'Hoodies'),
  ('Oversized Hoodie', 'Relaxed fit oversized hoodie', 4599, 30, 'Hoodies'),
  ('Tech Hoodie', 'Water-resistant hoodie', 4999, 25, 'Hoodies')
ON CONFLICT DO NOTHING;

-- Shoes (8)
INSERT INTO products (name, description, price_cents, stock, category) VALUES
  ('Canvas Sneakers', 'Low-top canvas sneakers', 5499, 100, 'Shoes'),
  ('Runner 200', 'Lightweight running shoes', 7999, 70, 'Shoes'),
  ('Trail Hiker', 'All-terrain hiking shoes', 8999, 45, 'Shoes'),
  ('Slip-On Loafers', 'Casual loafers for everyday', 6999, 50, 'Shoes'),
  ('Court Classics', 'Retro court sneakers', 7499, 60, 'Shoes'),
  ('City Boots', 'Weather-ready ankle boots', 9999, 35, 'Shoes'),
  ('Everyday Slides', 'Comfort slides for home and out', 2999, 120, 'Shoes'),
  ('Studio Trainers', 'Cross-training studio shoes', 8299, 55, 'Shoes')
ON CONFLICT DO NOTHING;

-- Hats (6)
INSERT INTO products (name, description, price_cents, stock, category) VALUES
  ('Classic Cap', 'Adjustable cotton baseball cap', 1999, 150, 'Hats'),
  ('Dad Hat', 'Relaxed fit cotton twill hat', 1899, 130, 'Hats'),
  ('Trucker Hat', 'Mesh back trucker cap', 2099, 140, 'Hats'),
  ('Beanie', 'Rib knit beanie', 1599, 160, 'Hats'),
  ('Bucket Hat', 'Reversible bucket hat', 2299, 90, 'Hats'),
  ('Visor', 'Sun visor for sports', 1499, 80, 'Hats')
ON CONFLICT DO NOTHING;

-- Socks (4)
INSERT INTO products (name, description, price_cents, stock, category) VALUES
  ('Ankle Socks 3-Pack', 'Breathable ankle socks', 1299, 200, 'Socks'),
  ('Crew Socks 3-Pack', 'Soft cotton crew socks', 1399, 220, 'Socks'),
  ('Wool Hikers', 'Merino wool hiking socks', 1999, 90, 'Socks'),
  ('No-Show Socks 3-Pack', 'Invisible socks for low shoes', 1299, 210, 'Socks')
ON CONFLICT DO NOTHING;

-- Jackets (4)
INSERT INTO products (name, description, price_cents, stock, category) VALUES
  ('Denim Jacket', 'Classic denim jacket', 8999, 40, 'Jackets'),
  ('Windbreaker', 'Packable windbreaker', 6999, 60, 'Jackets'),
  ('Puffer Jacket', 'Light puffer with recycled fill', 11999, 30, 'Jackets'),
  ('Rain Shell', 'Waterproof breathable shell', 10999, 35, 'Jackets')
ON CONFLICT DO NOTHING;

-- Pants (5)
INSERT INTO products (name, description, price_cents, stock, category) VALUES
  ('Chino Pants', 'Slim-fit chinos', 4999, 80, 'Pants'),
  ('Joggers', 'Comfy knit joggers', 4499, 90, 'Pants'),
  ('Denim Jeans', 'Straight-leg jeans', 5999, 70, 'Pants'),
  ('Tech Pants', 'Stretch water-repellent pants', 6499, 60, 'Pants'),
  ('Linen Trousers', 'Breathable linen blend', 6999, 40, 'Pants')
ON CONFLICT DO NOTHING;

-- Shorts (4)
INSERT INTO products (name, description, price_cents, stock, category) VALUES
  ('Chino Shorts', 'Casual chino shorts', 3999, 100, 'Shorts'),
  ('Athletic Shorts', 'Moisture-wicking shorts', 3499, 110, 'Shorts'),
  ('Denim Shorts', 'Classic denim shorts', 4299, 80, 'Shorts'),
  ('Swim Trunks', 'Quick-dry swim shorts', 3699, 90, 'Shorts')
ON CONFLICT DO NOTHING;

-- Accessories (6)
INSERT INTO products (name, description, price_cents, stock, category) VALUES
  ('Leather Belt', 'Full-grain leather belt', 3499, 70, 'Accessories'),
  ('Canvas Tote', 'Durable everyday tote', 2499, 100, 'Accessories'),
  ('Daypack', 'Compact day backpack', 5499, 60, 'Accessories'),
  ('Wool Scarf', 'Soft wool scarf', 2999, 80, 'Accessories'),
  ('Sunglasses Classic', 'UV400 classic frame', 3599, 90, 'Accessories'),
  ('Beanie with Pom', 'Cozy beanie with pom', 1699, 100, 'Accessories')
ON CONFLICT DO NOTHING;

COMMIT;
