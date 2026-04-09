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
    return new RegExp(`Could not find the function|${functionName}`, "i").test(String(error?.message || error || ""));
  }

  window.listStorefrontProducts = async function (client) {
    const sb = client || window.createSupabaseClientOrFail();
    const { data, error } = await sb.rpc("get_storefront_products");
    if (!error) {
      return Array.isArray(data) ? data : [];
    }

    if (!isMissingRpc(error, "get_storefront_products")) {
      throw error;
    }

    const fallback = await sb
      .from("products")
      .select("id, name, image, status, created_at, product_quantity, units_per_box, price_per_unit, price_per_box")
      .in("status", ["available", "out_of_stock"])
      .order("created_at", { ascending: false });

    if (fallback.error) throw fallback.error;
    return Array.isArray(fallback.data) ? fallback.data : [];
  };

  window.getStorefrontProduct = async function (client, productId) {
    const sb = client || window.createSupabaseClientOrFail();
    const { data, error } = await sb.rpc("get_storefront_product", { p_product_id: productId });
    if (!error) {
      const rows = Array.isArray(data) ? data : [];
      return rows[0] || null;
    }

    if (!isMissingRpc(error, "get_storefront_product")) {
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
