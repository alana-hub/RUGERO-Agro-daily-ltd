(() => {
  // ========================
  // ELEMENTS
  // ========================
  const sheetStatus = document.getElementById("sheetStatus");
  const sheetBody = document.getElementById("sheetBody");
  const refreshBtn = document.getElementById("refreshBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const correctionModeToggle = document.getElementById("correctionModeToggle");
  const correctionBanner = document.getElementById("correctionBanner");

  // ========================
  // STATE
  // ========================
  let supabaseClient;
  let canEdit = false;
  let correctionModeEnabled = false;
  let hasLegacyStockColumn = true;

  // ========================
  // HELPERS
  // ========================
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

  const roundMoney = (v) => Math.round(toNumber(v) * 100) / 100;

  function toInputMoney(value) {
    return String(roundMoney(value) || 0);
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function avgCostPerUnit(row) {
    const qty = Math.max(0, toNumber(row.product_quantity));
    return qty ? toNumber(row.purchase_price) / qty : 0;
  }

  function effectiveUnitCost(price, qty) {
    qty = Math.max(0, toNumber(qty));
    price = Math.max(0, toNumber(price));
    return qty ? price / qty : price;
  }

  const rowStatusByQty = (q) => (q > 0 ? "available" : "out_of_stock");

  function isMissingFunctionError(error, fn) {
    const msg = String(error?.message || "");
    return new RegExp(`Could not find the function|function .* does not exist|${fn}`, "i").test(msg);
  }

  function isMissingColumnError(error, col) {
    const msg = String(error?.message || "");
    return new RegExp(`column\\s+.*${col}.*does not exist`, "i").test(msg);
  }

  // ========================
  // STOCK LOGIC
  // ========================
  function getUnitsPerBox(row) {
    return Math.max(1, Math.floor(toNumber(row.units_per_box, 1)));
  }

  function computeTotalUnits(box, unit, unitsPerBox) {
    return (Math.max(0, box) * unitsPerBox) + Math.max(0, unit);
  }

  function stockPillClass(n) {
    n = Math.max(0, n);
    if (n <= 0) return "stock-pill out";
    if (n < 10) return "stock-pill low";
    return "stock-pill";
  }

  function setRowComputedStock(rowEl) {
    const unitsPerBox = toNumber(rowEl.dataset.unitsPerBox, 1);
    const box = toNumber(rowEl.querySelector('[data-field="box_qty"]')?.value);
    const unit = toNumber(rowEl.querySelector('[data-field="unit_qty"]')?.value);

    const total = computeTotalUnits(box, unit, unitsPerBox);

    rowEl.querySelector('[data-field="product_quantity"]').value = total;
    const display = rowEl.querySelector('[data-role="stock_display"]');
    display.textContent = total;
    display.className = stockPillClass(total);

    rowEl.querySelector('[data-role="status"]').textContent = rowStatusByQty(total);
  }

  function refreshCostPreview(rowEl) {
    const qty = toNumber(rowEl.querySelector('[data-field="product_quantity"]').value);
    const pool = toNumber(rowEl.querySelector('[data-field="purchase_price"]').value);

    const avg = avgCostPerUnit({ product_quantity: qty, purchase_price: pool });

    rowEl.querySelector('[data-field="purchase_per_unit"]').value = toInputMoney(avg);
    rowEl.querySelector('[data-role="avg_cost"]').textContent = formatRwf(avg);
  }

  // ========================
  // LOAD PRODUCTS
  // ========================
  async function loadProducts() {
    setStatus("Loading pricing sheet...");
    sheetBody.innerHTML = `<tr><td colspan="9">Loading...</td></tr>`;

    const { data, error } = await supabaseClient
      .from("products")
      .select("*")
      .order("name");

    if (error) {
      setStatus(error.message, "error");
      return;
    }

    sheetBody.innerHTML = data.map(row => {
      const qty = toNumber(row.product_quantity || row.stock);
      const unitsPerBox = getUnitsPerBox(row);
      const box = Math.floor(qty / unitsPerBox);
      const unit = qty % unitsPerBox;

      return `
        <tr data-id="${row.id}" data-units-per-box="${unitsPerBox}">
          <td>${escapeHtml(row.name)}</td>

          <td><input type="number" value="${box}" data-field="box_qty"></td>
          <td><input type="number" value="${unit}" data-field="unit_qty"></td>

          <td>
            <span class="${stockPillClass(qty)}" data-role="stock_display">${qty}</span>
            <input type="hidden" value="${qty}" data-field="product_quantity">
          </td>

          <td><input type="number" value="${row.purchase_price}" data-field="purchase_price"></td>
          <td><input type="number" data-field="purchase_per_unit"></td>

          <td data-role="avg_cost"></td>
          <td data-role="status">${rowStatusByQty(qty)}</td>

          <td>
            <button data-action="save" data-id="${row.id}">Save</button>
          </td>
        </tr>
      `;
    }).join("");

    document.querySelectorAll("#sheetBody tr").forEach(row => {
      setRowComputedStock(row);
      refreshCostPreview(row);
    });

    setStatus("Loaded successfully", "success");
  }

  // ========================
  // EVENTS
  // ========================
  sheetBody.addEventListener("input", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;

    if (["box_qty", "unit_qty"].includes(e.target.dataset.field)) {
      setRowComputedStock(row);
      refreshCostPreview(row);
    }

    if (["purchase_price", "purchase_per_unit"].includes(e.target.dataset.field)) {
      refreshCostPreview(row);
    }
  });

  refreshBtn?.addEventListener("click", loadProducts);

  logoutBtn?.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    location.href = "login.html";
  });

  // ========================
  // INIT
  // ========================
  (async () => {
    supabaseClient = createSupabaseClientOrFail();
    await loadProducts();
  })();

})();
