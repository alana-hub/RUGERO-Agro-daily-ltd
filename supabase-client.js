(function () {
  const cfg = window.__SHOP_ENV__ || {};
  const url = (cfg.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (cfg.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  const REQUEST_TIMEOUT_MS = 12000;
  const DEBUG_STOREFRONT = String(cfg.DEBUG_STOREFRONT || "true").toLowerCase() !== "false";

  window.appConfig = {
    businessName: cfg.BUSINESS_NAME || "Aboubakar Collection Online Shop",
    adminPhone: cfg.NEXT_PUBLIC_ADMIN_PHONE || "",
    whatsappPhone: cfg.NEXT_PUBLIC_WHATSAPP_PHONE || "",
    supabaseUrl: url,
    supabaseAnonKey: key
  };

  function debugLog(...args) {
    if (!DEBUG_STOREFRONT) return;
    console.log("[storefront:data]", ...args);
  }

  window.createSupabaseClientOrFail = function () {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabase SDK not loaded.");
    }
    if (!url || !key) {
      throw new Error("Missing Supabase config. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in env.js.");
    }
    return window.supabase.createClient(url, key);
  };

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

  function isMissingColumn(error, columnName) {
    return new RegExp(`column .*${columnName}.* does not exist`, "i").test(String(error?.message || ""));
  }

  function extractRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.products)) return payload.products;
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.rows)) return payload.rows;
    return [payload];
  }

  function normalizeProducts(rows) {
    return extractRows(rows)
      .map((row, index) => {
        if (!row || typeof row !== "object") return null;

        const id = row.id ?? row.product_id ?? row.productId ?? row.uuid ?? row.code ?? `row_${index}`;
        const rawQty = row.product_quantity ?? row.stock ?? row.quantity ?? 0;
        const parsedQty = Number(rawQty);
        const name = row.name || row.product_name || row.productName || row.title || "Unnamed product";

        return {
          ...row,
          id,
          name,
          image: row.image || row.image_url || "",
          status: row.status || "",
          product_quantity: Number.isFinite(parsedQty) ? parsedQty : 0
        };
      })
      .filter(Boolean);
  }

  async function queryProductsFallback(sb, sourceLabel = "fallback") {
    const SELECTS = [
      "id, name, image, status, created_at, product_quantity, stock, units_per_box, price_per_unit, price_per_box",
      "id, name, image, status, created_at, product_quantity, units_per_box, price_per_unit, price_per_box",
      "id, name, image, status, created_at, product_quantity, stock, units_per_box",
      "id, name, image, status, created_at, product_quantity, units_per_box",
      "id, name, image, status, created_at",
      "*"
    ];

    let lastError = null;

    for (const selectClause of SELECTS) {
      const result = await withTimeout(
        sb.from("products").select(selectClause).order("created_at", { ascending: false }),
        "Products query"
      );

      if (!result.error) {
        const normalized = normalizeProducts(result.data);
        debugLog(`${sourceLabel} products query success`, { selectClause, rows: normalized.length });
        return normalized;
      }

      lastError = result.error;
      debugLog(`${sourceLabel} products query failed`, { selectClause, error: result.error?.message || result.error });

      if (!isMissingColumn(result.error, "stock") && !isMissingColumn(result.error, "price_per_unit") && !isMissingColumn(result.error, "price_per_box")) {
        break;
      }
    }

    throw lastError || new Error("Products query failed.");
  }

  window.listStorefrontProducts = async function (client) {
    const sb = client || window.createSupabaseClientOrFail();
    debugLog("listStorefrontProducts:start");

    try {
      const rpcResponse = await withTimeout(sb.rpc("get_storefront_products"), "get_storefront_products RPC");
      const { data, error } = rpcResponse || {};

      if (!error) {
        const normalized = normalizeProducts(data);
        debugLog("listStorefrontProducts:rpc-success", { rows: normalized.length, sample: normalized[0] || null });
        if (normalized.length > 0) return normalized;
        debugLog("listStorefrontProducts:rpc-empty -> fallback-table");
        return queryProductsFallback(sb, "rpc-empty");
      }

      debugLog("listStorefrontProducts:rpc-error -> fallback-table", { error: error?.message || error });
      return queryProductsFallback(sb, "rpc-error");
    } catch (rpcTransportError) {
      debugLog("listStorefrontProducts:rpc-transport-error -> fallback-table", { error: rpcTransportError?.message || rpcTransportError });
      return queryProductsFallback(sb, "rpc-transport-error");
    }
  };

  window.getStorefrontProduct = async function (client, productId) {
    const sb = client || window.createSupabaseClientOrFail();
    debugLog("getStorefrontProduct:start", { productId });

    try {
      const rpcResponse = await withTimeout(
        sb.rpc("get_storefront_product", { p_product_id: productId }),
        "get_storefront_product RPC"
      );

      const { data, error } = rpcResponse || {};
      if (!error) {
        const rows = normalizeProducts(data);
        debugLog("getStorefrontProduct:rpc-success", { rows: rows.length });
        if (rows[0]) return rows[0];
      } else {
        debugLog("getStorefrontProduct:rpc-error -> fallback-table", { error: error?.message || error });
      }
    } catch (rpcTransportError) {
      debugLog("getStorefrontProduct:rpc-transport-error -> fallback-table", { error: rpcTransportError?.message || rpcTransportError });
    }

    const SELECTS = [
      "id, name, image, status, created_at, product_quantity, stock, price_per_unit, price_per_box, units_per_box",
      "id, name, image, status, created_at, product_quantity, price_per_unit, price_per_box, units_per_box",
      "id, name, image, status, created_at, product_quantity, stock, units_per_box",
      "id, name, image, status, created_at, product_quantity, units_per_box",
      "id, name, image, status, created_at",
      "*"
    ];

    let lastError = null;

    for (const selectClause of SELECTS) {
      const result = await withTimeout(
        sb.from("products").select(selectClause).eq("id", productId).maybeSingle(),
        "Product query"
      );

      if (!result.error) {
        if (!result.data) return null;
        const normalized = normalizeProducts([result.data]);
        debugLog("getStorefrontProduct:fallback-success", { selectClause, rows: normalized.length });
        return normalized[0] || null;
      }

      lastError = result.error;
      debugLog("getStorefrontProduct:fallback-failed", { selectClause, error: result.error?.message || result.error });

      if (!isMissingColumn(result.error, "stock") && !isMissingColumn(result.error, "price_per_unit") && !isMissingColumn(result.error, "price_per_box")) {
        break;
      }
    }

    throw lastError || new Error("Product query failed.");
  };
})();
