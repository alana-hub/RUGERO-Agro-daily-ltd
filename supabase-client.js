(function () {
  const cfg = window.__SHOP_ENV__ || {};
  const url = (cfg.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (cfg.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

  window.appConfig = {
    businessName: cfg.BUSINESS_NAME || "Aboubakar Collection Online Shop",
    adminPhone: cfg.NEXT_PUBLIC_ADMIN_PHONE || "",
    whatsappPhone: cfg.NEXT_PUBLIC_WHATSAPP_PHONE || "",
    supabaseUrl: url,
    supabaseAnonKey: key
  };

  window.createSupabaseClientOrFail = function () {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabase SDK not loaded.");
    }
    if (!url || !key) {
      throw new Error("Missing Supabase config. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in env.js.");
    }
    return window.supabase.createClient(url, key);
  };

  function isMissingRpc(error, functionName) {
    const message = String(error?.message || error || "");
    return new RegExp(`Could not find the function|function .* does not exist|${functionName}`, "i").test(message);
  }

  function normalizeProducts(rows) {
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => row && row.id)
      .map((row) => ({
        ...row,
        name: row.name || "",
        image: row.image || "",
        product_quantity: Number.isFinite(Number(row.product_quantity)) ? Number(row.product_quantity) : 0
      }));
  }

  async function fetchProductsFallback(sb) {
    const fallback = await sb
      .from("products")
      .select("id, name, image, status, created_at, product_quantity, units_per_box, price_per_unit, price_per_box")
      .order("created_at", { ascending: false });

    if (fallback.error) throw fallback.error;
    return normalizeProducts(fallback.data);
  }

  window.listStorefrontProducts = async function (client) {
    const sb = client || window.createSupabaseClientOrFail();
    const { data, error } = await sb.rpc("get_storefront_products");

    if (!error) {
      const rows = normalizeProducts(data);
      if (rows.length > 0) return rows;
      return fetchProductsFallback(sb);
    }

    if (!isMissingRpc(error, "get_storefront_products")) {
      throw error;
    }

    return fetchProductsFallback(sb);
  };

  window.getStorefrontProduct = async function (client, productId) {
    const sb = client || window.createSupabaseClientOrFail();
    const { data, error } = await sb.rpc("get_storefront_product", { p_product_id: productId });

    if (!error) {
      const rows = normalizeProducts(data);
      if (rows[0]) return rows[0];
    } else if (!isMissingRpc(error, "get_storefront_product")) {
      throw error;
    }

    const fallback = await sb
      .from("products")
      .select("id, name, image, status, created_at, product_quantity, price_per_unit, price_per_box, units_per_box")
      .eq("id", productId)
      .maybeSingle();

    if (fallback.error) throw fallback.error;
    return fallback.data || null;
  };
})();
