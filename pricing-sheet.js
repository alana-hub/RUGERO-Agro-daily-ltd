(() => {
  const sheetStatus = document.getElementById("sheetStatus");
  const sheetBody = document.getElementById("sheetBody");
  const refreshBtn = document.getElementById("refreshBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const correctionModeToggle = document.getElementById("correctionModeToggle");
  const correctionBanner = document.getElementById("correctionBanner");

  let supabaseClient;
  let canEdit = false;
  let correctionModeEnabled = false;
  let hasLegacyStockColumn = true;

  function setStatus(message, type = "") {
    if (!sheetStatus) return;
    sheetStatus.textContent = message;
    sheetStatus.classList.remove("error", "warn", "success");
    if (type) sheetStatus.classList.add(type);
  }

  function formatRwf(value) {
    return new Intl.NumberFormat("en-RW", {
      style: "currency",
      currency: "RWF",
      maximumFractionDigits: 0
    }).format(Number(value) || 0);
  }

  function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function roundMoney(value) {
    return Math.round(toNumber(value, 0) * 100) / 100;
  }

  function toInputMoney(value) {
    const n = roundMoney(toNumber(value, 0));
    return Number.isFinite(n) ? String(n) : "0";
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function avgCostPerUnit(row) {
    const qty = Math.max(0, toNumber(row.product_quantity, 0));
    if (!qty) return 0;
    return toNumber(row.purchase_price, 0) / qty;
  }

  function effectiveUnitCost(purchasePrice, quantity) {
    const safeQty = Math.max(0, toNumber(quantity, 0));
    const safePurchasePrice = Math.max(0, toNumber(purchasePrice, 0));
    if (safeQty <= 0) return safePurchasePrice;
    return safePurchasePrice / safeQty;
  }

  function rowStatusByQty(qty) {
    return qty > 0 ? "available" : "out_of_stock";
  }

  function isMissingFunctionError(error, fnName) {
    const message = String(error?.message || "");
    return new RegExp(`Could not find the function|function .* does not exist|${fnName}`, "i").test(message);
  }

  function isMissingColumnError(error, columnName) {
    const message = String(error?.message || "");
    return new RegExp(`column\\s+.*${columnName}.*does not exist`, "i").test(message);
  }

  function updateSaveButtonLabels() {
    if (!sheetBody) return;
    const label = correctionModeEnabled ? "Save & Recalculate System" : "Save";
    sheetBody.querySelectorAll("button[data-action='save']").forEach((button) => {
      if (!button.disabled) button.textContent = label;
      button.dataset.mode = correctionModeEnabled ? "correction" : "normal";
    });
  }

  function applyCorrectionModeUi() {
    if (correctionBanner) correctionBanner.hidden = !correctionModeEnabled;
    updateSaveButtonLabels();
  }

  function setButtonsDisabled(disabled) {
    if (refreshBtn) refreshBtn.disabled = disabled;
    if (!sheetBody) return;
    sheetBody.querySelectorAll("button[data-action='save']").forEach((button) => {
      button.disabled = disabled || !canEdit;
    });
  }

  function getUnitsPerBox(row) {
    return Math.max(1, Math.floor(toNumber(row.units_per_box, 1)));
  }

  function toBoxUnit(totalUnits, unitsPerBox) {
    const qty = Math.max(0, Math.floor(toNumber(totalUnits, 0)));
    const upb = Math.max(1, Math.floor(toNumber(unitsPerBox, 1)));
    const box = Math.floor(qty / upb);
    const unit = qty % upb;
    return { box, unit };
  }

  function computeTotalUnits(box, unit, unitsPerBox) {
    const cleanBox = Math.max(0, Math.floor(toNumber(box, 0)));
    const cleanUnit = Math.max(0, Math.floor(toNumber(unit, 0)));
    const upb = Math.max(1, Math.floor(toNumber(unitsPerBox, 1)));
    return (cleanBox * upb) + cleanUnit;
  }

  function stockPillClass(totalUnits) {
    const n = Math.max(0, Math.floor(toNumber(totalUnits, 0)));
    if (n <= 0) return "stock-pill out";
    if (n < 10) return "stock-pill low";
    return "stock-pill";
  }

  function setRowComputedStock(rowEl) {
    const unitsPerBox = Math.max(1, Math.floor(toNumber(rowEl.dataset.unitsPerBox, 1)));
    const boxInput = rowEl.querySelector('input[data-field="box_qty"]');
    const unitInput = rowEl.querySelector('input[data-field="unit_qty"]');
    const stockInput = rowEl.querySelector('input[data-field="product_quantity"]');
    const stockDisplay = rowEl.querySelector('[data-role="stock_display"]');
    const statusCell = rowEl.querySelector('[data-role="status"]');

    if (!boxInput || !unitInput || !stockInput || !stockDisplay || !statusCell) return;

    let box = Math.max(0, Math.floor(toNumber(boxInput.value, 0)));
    let unit = Math.max(0, Math.floor(toNumber(unitInput.value, 0)));

    if (unit >= unitsPerBox) {
      box += Math.floor(unit / unitsPerBox);
      unit = unit % unitsPerBox;
      boxInput.value = String(box);
      unitInput.value = String(unit);
    }

    const total = computeTotalUnits(box, unit, unitsPerBox);
    stockInput.value = String(total);
    stockDisplay.textContent = String(total);
    stockDisplay.className = stockPillClass(total);
    statusCell.textContent = rowStatusByQty(total);
  }

  function refreshCostPreview(rowEl) {
    const quantityInput = rowEl.querySelector('input[data-field="product_quantity"]');
    const purchaseInput = rowEl.querySelector('input[data-field="purchase_price"]');
    const purchasePerUnitInput = rowEl.querySelector('input[data-field="purchase_per_unit"]');
    const avgCell = rowEl.querySelector('[data-role="avg_cost"]');
    if (!quantityInput || !purchaseInput || !purchasePerUnitInput || !avgCell) return;

    const qty = Math.max(0, Math.floor(toNumber(quantityInput.value, 0)));
    const pool = Math.max(0, toNumber(purchaseInput.value, 0));
    const perUnit = Math.max(0, toNumber(purchasePerUnitInput.value, 0));

    if (document.activeElement === purchasePerUnitInput) {
      rowEl.dataset.costSource = "unit";
      const nextPool = roundMoney(perUnit * qty);
      purchaseInput.value = toInputMoney(nextPool);
      avgCell.textContent = formatRwf(qty > 0 ? perUnit : 0);
      return;
    }

    rowEl.dataset.costSource = "pool";
    const nextPerUnit = avgCostPerUnit({ product_quantity: qty, purchase_price: pool });
    purchasePerUnitInput.value = toInputMoney(nextPerUnit);
    avgCell.textContent = formatRwf(nextPerUnit);
  }

  async function loadProducts() {
    if (!supabaseClient || !sheetBody) return;
    setButtonsDisabled(true);
    setStatus("Loading pricing sheet...");

    let data;
    let error;

    const withStock = await supabaseClient
      .from("products")
      .select("id, name, product_quantity, stock, purchase_price, units_per_box, status")
      .order("name", { ascending: true });

    if (!withStock.error) {
      hasLegacyStockColumn = true;
      data = withStock.data;
    } else if (isMissingColumnError(withStock.error, "stock")) {
      hasLegacyStockColumn = false;
      const withoutStock = await supabaseClient
        .from("products")
        .select("id, name, product_quantity, purchase_price, units_per_box, status")
        .order("name", { ascending: true });
      data = withoutStock.data;
      error = withoutStock.error;
    } else {
      error = withStock.error;
    }

    setButtonsDisabled(false);

    if (error) {
      console.error(error);
      sheetBody.innerHTML = '<tr><td colspan="9">Failed to load products.</td></tr>';
      setStatus(error.message || "Failed to load products.", "error");
      return;
    }

    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) {
      sheetBody.innerHTML = '<tr><td colspan="9">No products found.</td></tr>';
      setStatus("No products found.");
      return;
    }

    sheetBody.innerHTML = rows.map((row) => {
      const qty = Math.max(0, Math.floor(toNumber(row.product_quantity, toNumber(row.stock, 0))));
      const purchase = Math.max(0, toNumber(row.purchase_price, 0));
      const unitsPerBox = getUnitsPerBox(row);
      const split = toBoxUnit(qty, unitsPerBox);
      const status = rowStatusByQty(qty);

      return `
        <tr data-id="${escapeHtml(row.id)}" data-cost-source="pool" data-units-per-box="${unitsPerBox}">
          <td>${escapeHtml(row.name || "Unnamed")}</td>
          <td>
            <input type="number" min="0" step="1" value="${split.box}" data-field="box_qty" ${canEdit ? "" : "disabled"}>
          </td>
          <td>
            <input type="number" min="0" step="1" value="${split.unit}" data-field="unit_qty" ${canEdit ? "" : "disabled"}>
          </td>
          <td>
            <span class="${stockPillClass(qty)}" data-role="stock_display">${qty}</span>
            <input type="hidden" value="${qty}" data-field="product_quantity">
          </td>
          <td>
            <input type="number" min="0" step="1" value="${toInputMoney(purchase)}" data-field="purchase_price" ${canEdit ? "" : "disabled"}>
          </td>
          <td>
            <input type="number" min="0" step="0.01" value="${toInputMoney(avgCostPerUnit({ product_quantity: qty, purchase_price: purchase }))}" data-field="purchase_per_unit" ${canEdit ? "" : "disabled"}>
          </td>
          <td data-role="avg_cost">${formatRwf(avgCostPerUnit({ product_quantity: qty, purchase_price: purchase }))}</td>
          <td data-role="status">${escapeHtml(status)}</td>
          <td>
            <div class="row-actions">
              <button class="btn btn-primary" type="button" data-action="save" data-id="${escapeHtml(row.id)}" ${canEdit ? "" : "disabled"}>Save</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    sheetBody.querySelectorAll("tr").forEach((rowEl) => {
      setRowComputedStock(rowEl);
      refreshCostPreview(rowEl);
    });

    applyCorrectionModeUi();
    setStatus("Pricing sheet loaded.", "success");
  }

  async function ensureAdminSession() {
    try {
      supabaseClient = createSupabaseClientOrFail();
    } catch (error) {
      setStatus(error.message || "Missing Supabase config.", "error");
      return false;
    }

    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError) {
      setStatus(sessionError.message || "Session check failed.", "error");
      return false;
    }

    const userId = sessionData?.session?.user?.id;
    if (!userId) {
      window.location.href = "login.html";
      return false;
    }

    const { data: adminRow, error: adminError } = await supabaseClient
      .from("admin_users")
      .select("user_id, is_active")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    if (adminError || !adminRow) {
      await supabaseClient.auth.signOut();
      setStatus("Your account is not authorized for admin access.", "error");
      setTimeout(() => {
        window.location.href = "login.html";
      }, 800);
      return false;
    }

    canEdit = true;
    return true;
  }

  async function updateProductRow(productId, payload) {
    const attempt = await supabaseClient
      .from("products")
      .update(payload)
      .eq("id", productId);

    if (!attempt.error) return attempt;
    if (!isMissingColumnError(attempt.error, "stock")) return attempt;

    hasLegacyStockColumn = false;
    const { stock, ...withoutStockPayload } = payload;
    return supabaseClient
      .from("products")
      .update(withoutStockPayload)
      .eq("id", productId);
  }

  async function runCorrectionMode(productId, payload, unitsPerBox) {
    const rpcName = "run_purchase_price_correction";
    const { data, error } = await supabaseClient.rpc(rpcName, {
      p_product_id: productId,
      p_purchase_price: payload.purchase_price,
      p_product_quantity: payload.product_quantity,
      p_stock: payload.stock,
      p_status: payload.status,
      p_units_per_box: unitsPerBox
    });

    if (error) {
      if (isMissingFunctionError(error, rpcName)) {
        const productUpdate = await updateProductRow(productId, payload);
        if (productUpdate.error) {
          return { error: productUpdate.error.message || "Fallback correction failed during product update." };
        }

        const salesSync = await syncSoldItemProfit(
          productId,
          payload.purchase_price,
          payload.product_quantity,
          unitsPerBox
        );

        if (salesSync.error) {
          return { error: salesSync.error };
        }

        return {
          salesUpdated: Math.max(0, toNumber(salesSync.updated, 0)),
          reportsUpdated: 0,
          inventoryUpdated: 0,
          dashboardUpdated: 0,
          fallbackUsed: true,
          warning: "Correction Mode SQL is not installed, so transactional backup/report/dashboard sync was skipped."
        };
      }
      return { error: error.message || "Correction Mode failed." };
    }

    const result = Array.isArray(data) ? (data[0] || {}) : (data || {});
    return {
      salesUpdated: Math.max(0, toNumber(result.sales_updated, 0)),
      reportsUpdated: Math.max(0, toNumber(result.reports_updated, 0)),
      inventoryUpdated: Math.max(0, toNumber(result.inventory_updated, 0)),
      dashboardUpdated: Math.max(0, toNumber(result.dashboard_updated, 0)),
      fallbackUsed: false,
      error: ""
    };
  }

  async function syncSoldItemProfit(productId, purchasePrice, quantity, unitsPerBox) {
    const unitCost = roundMoney(effectiveUnitCost(purchasePrice, quantity));
    const { data, error } = await supabaseClient
      .from("sales")
      .select("id, quantity, sale_type, selling_price")
      .eq("product_id", productId)
      .in("status", ["completed", "sold"]);

    if (error) {
      return { updated: 0, error: error.message || "Unable to load sold items." };
    }

    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return { updated: 0, error: "" };

    let updated = 0;
    for (const row of rows) {
      const qty = Math.max(0, toNumber(row.quantity, 0));
      const saleType = String(row.sale_type || "unit").toLowerCase();
      const unitsSold = saleType === "box" ? (qty * unitsPerBox) : qty;
      const selling = roundMoney(toNumber(row.selling_price, 0));
      const cost = roundMoney(unitCost * unitsSold);
      const profit = roundMoney(selling - cost);

      const { error: updateError } = await supabaseClient
        .from("sales")
        .update({
          cost_price: cost,
          profit
        })
        .eq("id", row.id);

      if (updateError) {
        return { updated, error: updateError.message || "Unable to update sold item profit." };
      }

      updated += 1;
    }

    return { updated, error: "" };
  }

  async function saveRow(productId, rowEl, buttonEl) {
    if (!supabaseClient || !productId || !rowEl || !buttonEl || !canEdit) return;

    const quantityInput = rowEl.querySelector('input[data-field="product_quantity"]');
    const purchaseInput = rowEl.querySelector('input[data-field="purchase_price"]');
    const purchasePerUnitInput = rowEl.querySelector('input[data-field="purchase_per_unit"]');
    const statusCell = rowEl.querySelector('[data-role="status"]');
    if (!quantityInput || !purchaseInput || !purchasePerUnitInput || !statusCell) {
      setStatus("Unable to save: missing row inputs.", "error");
      buttonEl.disabled = false;
      return;
    }

    const unitsPerBox = Math.max(1, Math.floor(toNumber(rowEl.dataset.unitsPerBox, 1)));
    const product_quantity = Math.max(0, Math.floor(toNumber(quantityInput.value, 0)));
    const stock = product_quantity;
    const enteredPool = Math.max(0, toNumber(purchaseInput.value, 0));
    const enteredPerUnit = Math.max(0, toNumber(purchasePerUnitInput.value, 0));
    const costSource = rowEl.dataset.costSource === "unit" ? "unit" : "pool";
    const purchase_price = costSource === "unit"
      ? roundMoney(enteredPerUnit * product_quantity)
      : roundMoney(enteredPool);
    const status = rowStatusByQty(product_quantity);

    buttonEl.disabled = true;
    buttonEl.textContent = correctionModeEnabled ? "Recalculating..." : "Saving...";
    setStatus(correctionModeEnabled ? "Running correction mode..." : "Saving product update...");

    const payload = hasLegacyStockColumn
      ? { product_quantity, purchase_price, status, stock }
      : { product_quantity, purchase_price, status };

    if (correctionModeEnabled) {
      const result = await runCorrectionMode(productId, payload, unitsPerBox);
      buttonEl.disabled = false;
      buttonEl.textContent = "Save & Recalculate System";

      if (result.error) {
        setStatus(result.error, "error");
        return;
      }

      statusCell.textContent = status;
      purchaseInput.value = toInputMoney(purchase_price);
      purchasePerUnitInput.value = toInputMoney(avgCostPerUnit({ product_quantity, purchase_price }));
      const avgCell = rowEl.querySelector('[data-role="avg_cost"]');
      if (avgCell) avgCell.textContent = formatRwf(avgCostPerUnit({ product_quantity, purchase_price }));

      if (result.fallbackUsed) {
        setStatus(
          `✅ Product updated with fallback correction: ${result.salesUpdated} sales updated. ${result.warning || "Install supabase/correction_mode.sql to enable full transactional system recalculation."}`,
          "warn"
        );
        return;
      }

      setStatus(
        `✅ Product updated. System fully recalculated: ${result.salesUpdated} sales updated, ${result.reportsUpdated} report records updated, inventory and dashboard synced (${result.inventoryUpdated} inventory, ${result.dashboardUpdated} dashboard).`,
        "success"
      );
      return;
    }

    const { error } = await updateProductRow(productId, payload);
    buttonEl.disabled = false;
    buttonEl.textContent = correctionModeEnabled ? "Save & Recalculate System" : "Save";

    if (error) {
      console.error(error);
      setStatus(error.message || "Failed to update product.", "error");
      return;
    }

    statusCell.textContent = status;
    purchaseInput.value = toInputMoney(purchase_price);
    purchasePerUnitInput.value = toInputMoney(avgCostPerUnit({ product_quantity, purchase_price }));
    const avgCell = rowEl.querySelector('[data-role="avg_cost"]');
    if (avgCell) avgCell.textContent = formatRwf(avgCostPerUnit({ product_quantity, purchase_price }));

    const profitSync = await syncSoldItemProfit(productId, purchase_price, product_quantity, unitsPerBox);
    if (profitSync.error) {
      setStatus(`Product saved, but profit recalculation failed: ${profitSync.error}`, "error");
      return;
    }

    setStatus(`Product updated successfully. Recalculated ${profitSync.updated} sold item(s).`, "success");
  }

  sheetBody?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    if (target.dataset.action !== "save") return;

    const productId = target.dataset.id;
    const rowEl = target.closest("tr");
    saveRow(productId, rowEl, target);
  });

  sheetBody?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const rowEl = target.closest("tr");
    if (!rowEl) return;

    if (target.dataset.field === "box_qty" || target.dataset.field === "unit_qty") {
      setRowComputedStock(rowEl);
      refreshCostPreview(rowEl);
      return;
    }

    if (target.dataset.field === "purchase_price" || target.dataset.field === "purchase_per_unit") {
      refreshCostPreview(rowEl);
    }
  });

  correctionModeToggle?.addEventListener("change", () => {
    correctionModeEnabled = Boolean(correctionModeToggle.checked);
    applyCorrectionModeUi();
    if (correctionModeEnabled) {
      setStatus("Correction mode enabled. Changes will permanently recalculate past data for the selected product.", "warn");
      return;
    }
    setStatus("Correction mode disabled. Normal save is active.", "success");
  });

  refreshBtn?.addEventListener("click", () => {
    loadProducts();
  });

  logoutBtn?.addEventListener("click", async () => {
    if (!supabaseClient) {
      window.location.href = "login.html";
      return;
    }

    await supabaseClient.auth.signOut();
    window.location.href = "login.html";
  });

  (async function init() {
    const ok = await ensureAdminSession();
    if (!ok) return;
    applyCorrectionModeUi();
    await loadProducts();
  })();
})();
