(() => {
  // ========================
  // ELEMENTS
  // ========================
  const sheetStatus = document.getElementById("sheetStatus");
  const sheetBody = document.getElementById("sheetBody");
  const refreshBtn = document.getElementById("refreshBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  let supabaseClient;

  // ========================
  // HELPERS
  // ========================
  function setStatus(message, type = "") {
    sheetStatus.textContent = message;
    sheetStatus.className = "status " + type;
  }

  function toNumber(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function formatRwf(v) {
    return new Intl.NumberFormat("en-RW", {
      style: "currency",
      currency: "RWF",
      maximumFractionDigits: 0
    }).format(v || 0);
  }

  function avgCostPerUnit(qty, totalCost) {
    return qty > 0 ? totalCost / qty : 0;
  }

  function getUnitsPerBox(row) {
    return Math.max(1, Math.floor(toNumber(row.units_per_box, 1)));
  }

  function computeTotal(box, unit, upb) {
    return (box * upb) + unit;
  }

  function stockClass(n) {
    if (n <= 0) return "stock-pill out";
    if (n < 10) return "stock-pill low";
    return "stock-pill";
  }

  // ========================
  // ROW UPDATE
  // ========================
  function updateRow(row) {
    const upb = toNumber(row.dataset.unitsPerBox, 1);

    let box = toNumber(row.querySelector('[data-field="box_qty"]').value);
    let unit = toNumber(row.querySelector('[data-field="unit_qty"]').value);

    // normalize
    if (unit >= upb) {
      box += Math.floor(unit / upb);
      unit = unit % upb;
      row.querySelector('[data-field="box_qty"]').value = box;
      row.querySelector('[data-field="unit_qty"]').value = unit;
    }

    const total = computeTotal(box, unit, upb);

    row.querySelector('[data-field="product_quantity"]').value = total;

    const display = row.querySelector('[data-role="stock_display"]');
    display.textContent = total;
    display.className = stockClass(total);

    const price = toNumber(row.querySelector('[data-field="purchase_price"]').value);
    const avg = avgCostPerUnit(total, price);

    row.querySelector('[data-field="purchase_per_unit"]').value = avg.toFixed(2);
    row.querySelector('[data-role="avg_cost"]').textContent = formatRwf(avg);
    row.querySelector('[data-role="status"]').textContent = total > 0 ? "available" : "out_of_stock";
  }

  // ========================
  // LOAD PRODUCTS
  // ========================
  async function loadProducts() {
    setStatus("Loading...");
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
      const upb = getUnitsPerBox(row);
      const box = Math.floor(qty / upb);
      const unit = qty % upb;
      const avg = avgCostPerUnit(qty, row.purchase_price || 0);

      return `
        <tr data-id="${row.id}" data-units-per-box="${upb}">
          <td>${row.name}</td>

          <td><input type="number" min="0" value="${box}" data-field="box_qty"></td>
          <td><input type="number" min="0" value="${unit}" data-field="unit_qty"></td>

          <td>
            <span class="${stockClass(qty)}" data-role="stock_display">${qty}</span>
            <input type="hidden" value="${qty}" data-field="product_quantity">
          </td>

          <td>
            <input type="number" min="0" value="${row.purchase_price || 0}" data-field="purchase_price">
          </td>

          <td>
            <input type="number" min="0" step="0.01" value="${avg.toFixed(2)}" data-field="purchase_per_unit">
          </td>

          <td data-role="avg_cost">${formatRwf(avg)}</td>
          <td data-role="status">${qty > 0 ? "available" : "out_of_stock"}</td>

          <td>
            <button data-action="save" data-id="${row.id}">Save</button>
          </td>
        </tr>
      `;
    }).join("");

    document.querySelectorAll("#sheetBody tr").forEach(updateRow);

    setStatus("Loaded", "success");
  }

  // ========================
  // SAVE
  // ========================
  async function saveRow(row) {
    const id = row.dataset.id;

    const qty = toNumber(row.querySelector('[data-field="product_quantity"]').value);
    const price = toNumber(row.querySelector('[data-field="purchase_price"]').value);

    const status = qty > 0 ? "available" : "out_of_stock";

    const { error } = await supabaseClient
      .from("products")
      .update({
        product_quantity: qty,
        purchase_price: price,
        status
      })
      .eq("id", id);

    if (error) {
      setStatus(error.message, "error");
      return;
    }

    setStatus("Saved successfully", "success");
  }

  // ========================
  // EVENTS
  // ========================
  sheetBody.addEventListener("input", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    updateRow(row);
  });

  sheetBody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action='save']");
    if (!btn) return;

    const row = btn.closest("tr");
    saveRow(row);
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
