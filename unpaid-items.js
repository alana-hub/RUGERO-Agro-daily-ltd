(() => {
    const UNPAID_ITEMS_STORAGE_KEY = "rugero_admin_unpaid_items_v1";

    const unpaidItemForm = document.getElementById("unpaidItemForm");
    const unpaidProductNameInput = document.getElementById("unpaidProductName");
    const unpaidUnitsInput = document.getElementById("unpaidUnits");
    const unpaidSellingUnitInput = document.getElementById("unpaidSellingUnit");
    const unpaidCostUnitInput = document.getElementById("unpaidCostUnit");
    const unpaidStatusInput = document.getElementById("unpaidStatus");
    const unpaidItemsStatus = document.getElementById("unpaidItemsStatus");
    const unpaidItemsBody = document.getElementById("unpaidItemsBody");
    const unpaidTakenCount = document.getElementById("unpaidTakenCount");
    const unpaidPaidCount = document.getElementById("unpaidPaidCount");
    const unpaidReturnedCount = document.getElementById("unpaidReturnedCount");

    let unpaidItems = [];
    let supabaseClient = null;

    function setStatus(message, kind = "") {
        if (!unpaidItemsStatus) return;
        unpaidItemsStatus.textContent = message;
        unpaidItemsStatus.classList.remove("error", "warn", "success");
        if (kind) unpaidItemsStatus.classList.add(kind);
    }

    function toNumber(value, fallback = 0) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function roundMoney(value) {
        return Math.round(toNumber(value, 0) * 100) / 100;
    }

    function formatRwf(value) {
        return new Intl.NumberFormat("en-RW", {
            style: "currency",
            currency: "RWF",
            maximumFractionDigits: 0
        }).format(Number(value) || 0);
    }

    function escapeHtml(text) {
        return String(text || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function normalizeName(name) {
        return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
    }

    function statusClass(status) {
        const normalized = String(status || "").toLowerCase();
        if (normalized === "paid" || normalized === "returned") return normalized;
        return "taken";
    }

    function safeStorageGet() {
        try {
            return localStorage.getItem(UNPAID_ITEMS_STORAGE_KEY);
        } catch {
            return null;
        }
    }

    function safeStorageSet(value) {
        try {
            localStorage.setItem(UNPAID_ITEMS_STORAGE_KEY, value);
        } catch {
            setStatus("Could not save data in this browser.", "warn");
        }
    }

    function loadItems() {
        const raw = safeStorageGet();
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    function saveItems() {
        safeStorageSet(JSON.stringify(unpaidItems));
    }

    function productQty(product) {
        const modern = toNumber(product?.product_quantity, NaN);
        if (Number.isFinite(modern)) return modern;
        return toNumber(product?.stock, 0);
    }

    function productCostPool(product) {
        return toNumber(product?.purchase_price, 0);
    }

    async function findProductByName(productName) {
        if (!supabaseClient) return null;
        const target = normalizeName(productName);
        const { data, error } = await supabaseClient.from("products").select("*").limit(3000);
        if (error) throw new Error(error.message || "Could not load products for inventory adjustment.");
        return (data || []).find((row) => normalizeName(row?.name) === target) || null;
    }

    async function persistProductInventory(product, nextQty, nextCostPool) {
        const status = nextQty <= 0 ? "out_of_stock" : "available";
        const modern = { product_quantity: nextQty, purchase_price: nextCostPool, status };
        const { error } = await supabaseClient.from("products").update(modern).eq("id", product.id);
        if (!error) return;
        const legacy = { stock: nextQty, status: nextQty <= 0 ? "sold" : "available" };
        const { error: legacyError } = await supabaseClient.from("products").update(legacy).eq("id", product.id);
        if (legacyError) throw new Error(legacyError.message || error.message || "Failed to update inventory.");
    }

    async function adjustInventoryForPhysicalMovement(item, direction, reason) {
        const product = await findProductByName(item.product_name);
        if (!product) {
            setStatus(`No inventory product found for "${item.product_name}".`, "warn");
            return { adjusted: false, before: null, after: null };
        }

        const units = Math.max(1, toNumber(item.units, 1));
        const unitCost = roundMoney(toNumber(item.cost_price_per_unit, 0));
        const unitsBefore = productQty(product);
        const costPoolBefore = productCostPool(product);
        const deltaUnits = direction === "out" ? -units : units;
        const deltaCost = roundMoney(unitCost * units);
        const unitsAfter = Math.max(0, unitsBefore + deltaUnits);
        const costPoolAfter = direction === "out"
            ? Math.max(0, roundMoney(costPoolBefore - deltaCost))
            : roundMoney(costPoolBefore + deltaCost);

        await persistProductInventory(product, unitsAfter, costPoolAfter);
        return {
            adjusted: true,
            before: { units: unitsBefore, costPool: costPoolBefore },
            after: { units: unitsAfter, costPool: costPoolAfter },
            reason
        };
    }

    function computeRevenueImpact(prevStatus, nextStatus, units, sellingUnit) {
        const prev = prevStatus === "paid" ? roundMoney(units * sellingUnit) : 0;
        const next = nextStatus === "paid" ? roundMoney(units * sellingUnit) : 0;
        return roundMoney(next - prev);
    }

    function computeProfitImpact(prevStatus, nextStatus, units, sellingUnit, costUnit) {
        const prev = prevStatus === "paid" ? roundMoney((units * sellingUnit) - (units * costUnit)) : 0;
        const next = nextStatus === "paid" ? roundMoney((units * sellingUnit) - (units * costUnit)) : 0;
        return roundMoney(next - prev);
    }

    function auditStatusTransition(item, prevStatus, nextStatus, inventoryAdjustment, bugFlags = []) {
        const units = Math.max(1, toNumber(item.units, 1));
        const sellingUnit = roundMoney(toNumber(item.selling_price_per_unit, 0));
        const costUnit = roundMoney(toNumber(item.cost_price_per_unit, 0));
        const revenueImpact = computeRevenueImpact(prevStatus, nextStatus, units, sellingUnit);
        const profitImpact = computeProfitImpact(prevStatus, nextStatus, units, sellingUnit, costUnit);

        console.table([{
            itemId: item.id,
            product: item.product_name,
            statusFrom: prevStatus,
            statusTo: nextStatus,
            unitsBeforeAction: inventoryAdjustment?.before?.units ?? "n/a",
            unitsAfterAction: inventoryAdjustment?.after?.units ?? "n/a",
            inventoryAdjusted: Boolean(inventoryAdjustment?.adjusted),
            inventoryDirection: item.inventory_movement_state || "in",
            revenueImpact,
            profitImpact,
            bugsDetected: bugFlags.join(" | ") || "none",
            reason: inventoryAdjustment?.reason || "status change"
        }]);
    }

    async function enforcePhysicalMovementRule(item, prevStatus, nextStatus) {
        const bugFlags = [];
        let inventoryAdjustment = null;
        const previousMovementState = item.inventory_movement_state || "in";
        const targetMovementState = nextStatus === "returned" ? "in" : "out";

        if (previousMovementState !== targetMovementState) {
            inventoryAdjustment = await adjustInventoryForPhysicalMovement(
                item,
                targetMovementState === "out" ? "out" : "in",
                `status:${prevStatus}->${nextStatus}`
            );
            item.inventory_movement_state = targetMovementState;
            item.inventory_adjusted = targetMovementState === "out";
            item.inventory_adjusted_at = new Date().toISOString();
        } else if (prevStatus === "taken" && nextStatus === "paid") {
            bugFlags.push("Prevented double inventory subtraction (taken -> paid).");
        }

        if (nextStatus === "returned" && prevStatus === "returned") {
            bugFlags.push("Ignored duplicate return update.");
        }
        return { inventoryAdjustment, bugFlags };
    }

    function createItemPayload() {
        const status = statusClass(unpaidStatusInput?.value);
        return {
            id: `unpaid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            created_at: new Date().toISOString(),
            product_name: String(unpaidProductNameInput?.value || "").trim(),
            units: Math.max(1, Math.floor(toNumber(unpaidUnitsInput?.value, 1))),
            selling_price_per_unit: roundMoney(toNumber(unpaidSellingUnitInput?.value, 0)),
            cost_price_per_unit: roundMoney(toNumber(unpaidCostUnitInput?.value, 0)),
            status,
            paid_at: status === "paid" ? new Date().toISOString() : null,
            returned_at: status === "returned" ? new Date().toISOString() : null,
            inventory_adjusted: false,
            inventory_movement_state: "in",
            inventory_adjusted_at: null
        };
    }

    function renderItems() {
        if (!unpaidItemsBody) return;
        if (!unpaidItems.length) {
            unpaidItemsBody.innerHTML = '<tr><td colspan="7">No unpaid/rent items yet.</td></tr>';
        } else {
            unpaidItemsBody.innerHTML = unpaidItems.map((item) => `
                <tr>
                    <td data-label="Date">${escapeHtml(new Date(item.created_at).toLocaleString())}</td>
                    <td data-label="Product">${escapeHtml(item.product_name)}</td>
                    <td data-label="Units">${Math.max(1, toNumber(item.units, 1))}</td>
                    <td data-label="Selling / Unit">${formatRwf(item.selling_price_per_unit)}</td>
                    <td data-label="Cost / Unit">${formatRwf(item.cost_price_per_unit)}</td>
                    <td data-label="Status"><span class="status-chip ${escapeHtml(statusClass(item.status))}">${escapeHtml(statusClass(item.status))}</span></td>
                    <td data-label="Actions" class="actions">
                        <button class="btn btn-success" type="button" data-action="paid" data-id="${escapeHtml(item.id)}" ${statusClass(item.status) === "paid" ? "disabled" : ""}>Mark as Paid</button>
                        <button class="btn btn-danger" type="button" data-action="returned" data-id="${escapeHtml(item.id)}" ${statusClass(item.status) === "returned" ? "disabled" : ""}>Mark as Returned</button>
                    </td>
                </tr>
            `).join("");
        }

        const taken = unpaidItems.filter((i) => statusClass(i.status) === "taken").length;
        const paid = unpaidItems.filter((i) => statusClass(i.status) === "paid").length;
        const returned = unpaidItems.filter((i) => statusClass(i.status) === "returned").length;
        if (unpaidTakenCount) unpaidTakenCount.textContent = String(taken);
        if (unpaidPaidCount) unpaidPaidCount.textContent = String(paid);
        if (unpaidReturnedCount) unpaidReturnedCount.textContent = String(returned);
    }

    async function onSubmit(event) {
        event.preventDefault();
        const payload = createItemPayload();
        if (!payload.product_name) {
            setStatus("Product name is required.", "error");
            return;
        }

        unpaidItems.unshift(payload);
        const { inventoryAdjustment, bugFlags } = await enforcePhysicalMovementRule(payload, "created", payload.status);
        saveItems();
        renderItems();
        if (unpaidItemForm) unpaidItemForm.reset();
        if (unpaidStatusInput) unpaidStatusInput.value = "taken";
        auditStatusTransition(payload, "created", payload.status, inventoryAdjustment, bugFlags);
        setStatus(`${payload.product_name} added as ${payload.status}.`, "success");
    }

    async function onTableClick(event) {
        const button = event.target.closest("[data-action]");
        if (!button) return;
        const id = button.getAttribute("data-id");
        const action = button.getAttribute("data-action");
        const item = unpaidItems.find((x) => x.id === id);
        if (!item) return;
        const prevStatus = statusClass(item.status);
        const nextStatus = statusClass(action);
        if (prevStatus === nextStatus) return;

        item.status = nextStatus;
        if (nextStatus === "paid") item.paid_at = item.paid_at || new Date().toISOString();
        if (nextStatus === "returned") item.returned_at = item.returned_at || new Date().toISOString();

        const { inventoryAdjustment, bugFlags } = await enforcePhysicalMovementRule(item, prevStatus, nextStatus);
        saveItems();
        renderItems();
        auditStatusTransition(item, prevStatus, nextStatus, inventoryAdjustment, bugFlags);
        setStatus(`${item.product_name || "Item"} marked as ${nextStatus}.`, "success");
    }

    async function init() {
        try {
            supabaseClient = createSupabaseClientOrFail();
            const { data, error } = await supabaseClient.auth.getSession();
            if (error || !data?.session) {
                setStatus("Please log in from admin first to adjust inventory.", "warn");
            }
        } catch (error) {
            setStatus(error.message || "Missing configuration for inventory sync.", "warn");
        }

        unpaidItems = loadItems();
        renderItems();
        if (unpaidItemForm) unpaidItemForm.addEventListener("submit", onSubmit);
        if (unpaidItemsBody) unpaidItemsBody.addEventListener("click", (event) => {
            onTableClick(event).catch((error) => {
                console.error(error);
                setStatus(error.message || "Could not update unpaid item.", "error");
            });
        });
    }

    init().catch((error) => {
        console.error(error);
        setStatus(error.message || "Failed to initialize unpaid items page.", "error");
    });
})();
