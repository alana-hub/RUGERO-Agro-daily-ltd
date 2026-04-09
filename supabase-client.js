(function () {
  const cfg = window.__SHOP_ENV__ || {};
  const url = (cfg.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (cfg.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  const REQUEST_TIMEOUT_MS = 12000;

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

  function isMissingColumn(error, columnName) {
    return new RegExp(`column .*${columnName}.* does not exist`, "i").test(String(error?.message || ""));
  }

  function withTimeout(promise, label) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(new Error(`${label} timed out after ${Math.floor(REQUEST_TIMEOUT_MS / 1000)}s`));
      }, REQUEST_TIMEOUT_MS);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timeoutId) window.clearTimeout(timeoutId);
    });
  }

  function normalizeProducts(rows) {
    return (Array.isArray(rows) ? rows : [])
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const id = row.id ?? row.product_id ?? "";
        if (!id) return null;

        const rawQty = row.product_quantity ?? row.stock ?? 0;
        const parsedQty = Number(rawQty);

        return {
          ...row,
          id,
          name: row.name || row.product_name || "",
          image: row.image || "",
          status: row.status || "",
          product_quantity: Number.isFinite(parsedQty) ? parsedQty : 0
        };
      })
      .filter(Boolean);
  }

  async function queryProductsFallback(sb) {
    const richFallback = await withTimeout(
      sb
        .from("products")
        .select("id, name, image, status, created_at, product_quantity, stock, units_per_box, price_per_unit, price_per_box")
        .order("created_at", { ascending: false }),
      "Products query"
    );

    if (!richFallback.error) {
      return normalizeProducts(richFallback.data);
    }

    if (!isMissingColumn(richFallback.error, "price_per_unit") && !isMissingColumn(richFallback.error, "price_per_box")) {
      throw richFallback.error;
    }

    const basicFallback = await withTimeout(
      sb
        .from("products")
        .select("id, name, image, status, created_at, product_quantity, stock, units_per_box")
        .order("created_at", { ascending: false }),
      "Products query (basic columns)"
    );

    if (basicFallback.error) throw basicFallback.error;
    return normalizeProducts(basicFallback.data);
  }

  window.listStorefrontProducts = async function (client) {
    const sb = client || window.createSupabaseClientOrFail();
    let rpcResponse;

    try {
      rpcResponse = await withTimeout(sb.rpc("get_storefront_products"), "get_storefront_products RPC");
    } catch (transportError) {
      return queryProductsFallback(sb);
    }

    const { data, error } = rpcResponse;

    if (!error) {
      const normalized = normalizeProducts(data);
      if (normalized.length > 0) return normalized;
      return queryProductsFallback(sb);
    }

    if (!isMissingRpc(error, "get_storefront_products")) {
      throw error;
    }

    return queryProductsFallback(sb);
  };

  window.getStorefrontProduct = async function (client, productId) {
    const sb = client || window.createSupabaseClientOrFail();
    let rpcResponse = null;

    try {
      rpcResponse = await withTimeout(
        sb.rpc("get_storefront_product", { p_product_id: productId }),
        "get_storefront_product RPC"
      );
    } catch (transportError) {
      rpcResponse = null;
    }

    if (rpcResponse) {
      const { data, error } = rpcResponse;
      if (!error) {
        const rows = normalizeProducts(Array.isArray(data) ? data : [data]);
        if (rows[0]) return rows[0];
      } else if (!isMissingRpc(error, "get_storefront_product")) {
        throw error;
      }
    }

    const richFallback = await withTimeout(
      sb
        .from("products")
        .select("id, name, image, status, created_at, product_quantity, stock, price_per_unit, price_per_box, units_per_box")
        .eq("id", productId)
        .maybeSingle(),
      "Product query"
    );

    if (!richFallback.error) return richFallback.data || null;

    if (!isMissingColumn(richFallback.error, "price_per_unit") && !isMissingColumn(richFallback.error, "price_per_box")) {
      throw richFallback.error;
    }

    const basicFallback = await withTimeout(
      sb
        .from("products")
        .select("id, name, image, status, created_at, product_quantity, stock, units_per_box")
        .eq("id", productId)
        .maybeSingle(),
      "Product query (basic columns)"
    );

    if (basicFallback.error) throw basicFallback.error;
    return basicFallback.data || null;
  };
})();
