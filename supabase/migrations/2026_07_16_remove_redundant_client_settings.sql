-- client_products / client_target_markets duplicated the Product Offerings
-- library and fed the AI almost nothing (planning.md D2). The prompt context
-- block now derives products from product_offerings directly.
-- theme / theme_mode moved to user_settings (per user) in the same release.

delete from public.settings
 where key in ('client_products', 'client_target_markets', 'theme', 'theme_mode');
