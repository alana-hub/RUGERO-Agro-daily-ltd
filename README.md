# Aboubakar Collection Upgraded Shop

This version keeps existing features and adds production-focused inventory + profit tracking.

## Kept Features
- choose file upload for product image
- sales dashboard
- sales reports

## New Features
- stock merge when adding existing product
- quantity + units-per-box + unit/box pricing
- automatic stock deduction on sale
- manual "mark as sold" action in admin inventory
- out-of-stock status handling
- revenue/cost/profit tracking
- daily/monthly/total profit metrics
- smart alerts (loss, low margin, low stock)
- WhatsApp + Call actions on product cards, product page, and floating mobile buttons
- secure admin route with `admin_users` check

## Environment Setup
Use these environment variables (values intentionally blank):

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

For this static build:
- Put only browser-safe runtime values in `env.js`.
- Do not place `SUPABASE_SERVICE_ROLE_KEY` in `env.js` or any browser-served file.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only for future backend/admin tooling if ever needed.

Current browser runtime config in `env.js` should contain only:

```js
window.__SHOP_ENV__ = {
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  NEXT_PUBLIC_ADMIN_PHONE: "",
  NEXT_PUBLIC_WHATSAPP_PHONE: "",
  BUSINESS_NAME: ""
};
```

## Supabase Setup
Run [schema.sql](./supabase/schema.sql) on each business database before using the admin dashboard.
Each business should deploy with its own Supabase project credentials.

The schema now provisions:
- `products`, `sales`, `price_change_logs`, and `admin_users`
- `alert_settings` for optional smart-alert threshold overrides
- duplicate protection by normalized product name
- the `update_product_price_with_log` RPC used by price edits
- the `products` Storage bucket
- Storage policies for public image reads and admin image writes/deletes

## Deployment Checklist
1. Create a Supabase project for the business.
2. Run [schema.sql](./supabase/schema.sql) in the Supabase SQL editor.
3. Confirm the `products` Storage bucket exists after running the schema.
4. Create at least one Supabase Auth user for admin login.
5. Insert that user into `public.admin_users`.
6. Fill in `env.js` with only browser-safe values.
7. Deploy the static files.

## Admin Bootstrap
After creating an admin user in Supabase Auth, add the user ID to `public.admin_users`:

```sql
insert into public.admin_users (user_id, is_active)
values ('YOUR_AUTH_USER_ID', true)
on conflict (user_id) do update
set is_active = excluded.is_active;
```

## Migration Notes
- If old data already contains duplicate product names after trimming and lowercasing, clean those rows before relying on the unique normalized-name index.
- Price editing in the admin dashboard depends on the `update_product_price_with_log` function created by [schema.sql](./supabase/schema.sql).
- File uploads depend on the `products` Storage bucket and Storage policies created by [schema.sql](./supabase/schema.sql).
- Apply schema changes in Supabase before deploying new frontend files.

## Smart Alert Settings
Smart alerts still default to the original built-in thresholds:

- low stock: `5`
- low margin: `10%`
- quarter stock: `25%`
- notification limit: `6`

After applying the latest [schema.sql](./supabase/schema.sql), you can optionally tune those values in `public.alert_settings` without changing the frontend code. The seeded `default` row is used automatically.

## Mark Sold
The admin inventory table includes a `Mark as Sold` action. It asks the admin for the quantity sold, records that many completed unit sales, subtracts the quantity from current stock, updates the product status when stock reaches `0`, and refreshes the sales dashboard. When the atomic sale RPC is unavailable, the frontend falls back to a guarded insert/update flow with sale rollback if the stock update fails.

## Files
- `index.html`: storefront + search/sort + direct communication buttons
- `product.html`: product details page
- `login.html`: admin login
- `admin.html`: admin dashboard UI
- `admin.sales-upgrades.js`: stock merge, selling logic, profit dashboard, reports
- `env.js`: runtime env config template
- `supabase-client.js`: shared Supabase client loader
