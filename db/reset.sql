-- Reset demo data: clear orders, carts, and restore product stock from a baseline
BEGIN;
-- Recompute stock by resetting to initial max(stock, 0) and then optional top-ups
-- For demo simplicity, we restore stock to a fixed baseline per category
UPDATE products SET stock = CASE
  WHEN category = 'T-Shirts' THEN 120
  WHEN category = 'Hoodies' THEN 65
  WHEN category = 'Shoes' THEN 100
  WHEN category = 'Hats' THEN 160
  WHEN category = 'Socks' THEN 220
  WHEN category = 'Jackets' THEN 60
  WHEN category = 'Pants' THEN 90
  WHEN category = 'Shorts' THEN 110
  WHEN category = 'Accessories' THEN 100
  ELSE 100
END;

-- Clear transactional tables
TRUNCATE TABLE order_items RESTART IDENTITY CASCADE;
TRUNCATE TABLE orders RESTART IDENTITY CASCADE;
TRUNCATE TABLE cart_items RESTART IDENTITY CASCADE;
TRUNCATE TABLE carts RESTART IDENTITY CASCADE;
COMMIT;
