(() => {
    if (window.__RUGERO_SALES_UPGRADES_INIT__) return;
    window.__RUGERO_SALES_UPGRADES_INIT__ = true;

    const STORAGE_BUCKET = "products";
    const LOW_STOCK_THRESHOLD = 5;
    const LOW_MARGIN_THRESHOLD = 0.1;
    const QUARTER_STOCK_RATIO = 0.25;
    const ALERT_NOTIFICATION_LIMIT = 6;
    const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
    const MAX_SOURCE_IMAGE_SIZE_BYTES = 15 * 1024 * 1024;
    const MAX_UPLOAD_IMAGE_DIMENSION = 1600;
    const NORMALIZED_IMAGE_QUALITY = 0.86;
    const POPUP_ALERT_TYPES = new Set(["low_stock", "quarter_stock", "low_margin", "loss_making", "out_of_stock"]);
    const DEFAULT_ALERT_CONFIG = Object.freeze({
        lowStockThreshold: LOW_STOCK_THRESHOLD,
        lowMarginThreshold: LOW_MARGIN_THRESHOLD,
        quarterStockRatio: QUARTER_STOCK_RATIO,
        notificationLimit: ALERT_NOTIFICATION_LIMIT,
        includeBreakEvenLowMargin: false
    });

    const sessionInfo = document.getElementById("sessionInfo");
    const logoutBtn = document.getElementById("logoutBtn");
    const productForm = document.getElementById("productForm");
    const submitBtn = document.getElementById("submitBtn");
    const formStatus = document.getElementById("formStatus");
    const inventoryStatus = document.getElementById("inventoryStatus");
    const inventoryBody = document.getElementById("inventoryBody");
    const inventorySearch = document.getElementById("inventorySearch");
    const clearInventorySearchBtn = document.getElementById("clearInventorySearchBtn");
    const inventorySearchStatus = document.getElementById("inventorySearchStatus");
    const salesStatus = document.getElementById("salesStatus");
    const salesBody = document.getElementById("salesBody");
    const summaryTotalRevenue = document.getElementById("summaryTotalRevenue");
    const summaryTotalCost = document.getElementById("summaryTotalCost");
    const summaryTotalProfit = document.getElementById("summaryTotalProfit");
    const summarySoldUnits = document.getElementById("summarySoldUnits");
    const summaryTodayProfit = document.getElementById("summaryTodayProfit");
    const recalcTodayProfitBtn = document.getElementById("recalcTodayProfitBtn");
    const alertsStatus = document.getElementById("alertsStatus");
    const smartAlerts = document.getElementById("smartAlerts");
    const exportCsvBtn = document.getElementById("exportCsvBtn");
    const resetFiltersBtn = document.getElementById("resetFiltersBtn");
    const filterFrom = document.getElementById("filterFrom");
    const filterTo = document.getElementById("filterTo");
    const filterProduct = document.getElementById("filterProduct");
    const filterSaleType = document.getElementById("filterSaleType");
    const duplicatePanel = document.getElementById("duplicatePanel");
    const duplicateSummary = document.getElementById("duplicateSummary");
    const duplicateAddStockBtn = document.getElementById("duplicateAddStockBtn");
    const duplicateEditPriceBtn = document.getElementById("duplicateEditPriceBtn");
    const duplicateCancelBtn = document.getElementById("duplicateCancelBtn");
    const notificationList = document.getElementById("notificationList");
    const alertHistoryList = document.getElementById("alertHistoryList");
    const alertPopupStack = document.getElementById("alertPopupStack");

    const metricTotalRevenue = document.getElementById("metricTotalRevenue");
    const metricTotalCost = document.getElementById("metricTotalCost");
    const metricTotalProfit = document.getElementById("metricTotalProfit");
    const metricDailyProfit = document.getElementById("metricDailyProfit");
    const metricTodaySoldProfit = document.getElementById("metricTodaySoldProfit");
    const metricMonthlyProfit = document.getElementById("metricMonthlyProfit");
    const metricSoldItems = document.getElementById("metricSoldItems");

    let supabaseClient;
    let currentAdminEmail = "";
    let currentAdminId = "";
    let dailyRevenueChart = null;
    let topProductsChart = null;
    let inventoryRows = [];
    let inventorySearchTerm = "";
    let salesReportRows = [];
    let pendingDuplicateProduct = null;
    let persistedAlerts = [];
    let recentAlertEvents = [];
    let alertsBackedByDb = false;
    let alertConfig = { ...DEFAULT_ALERT_CONFIG };
    let activePopupAlerts = [];
    const dismissedAlertPopups = new Set();
    const vibratedAlertPopups = new Set();
    const markSoldInFlight = new Set();
    const REPORTING_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const REPORTING_DATE_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
        timeZone: REPORTING_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    });

    function formatRwf(value) {
        return new Intl.NumberFormat("en-RW", {
            style: "currency",
            currency: "RWF",
            maximumFractionDigits: 0
        }).format(Number(value) || 0);
    }

    function setStatus(el, message, kind) {
        if (!el) return;
        el.textContent = message;
        el.classList.remove("error", "warn", "success");
        if (kind === "error") el.classList.add("error");
        if (kind === "warn") el.classList.add("warn");
        if (kind === "success") el.classList.add("success");
    }

    function escapeHtml(text) {
        return String(text || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function normalizeName(name) {
        return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
    }

    function normalizeSearchText(value) {
        return String(value || "").trim().toLowerCase();
    }

    function sanitizeProductName(name) {
        return String(name || "").trim().replace(/\s+/g, " ");
    }

    function toNumber(value, fallback = 0) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function roundMoney(value) {
        return Math.round(toNumber(value, 0) * 100) / 100;
    }

    function isImageFile(file) {
        return !!file && typeof file.type === "string" && file.type.startsWith("image/");
    }

    function isNormalizableImageFile(file) {
        return isImageFile(file) && ["image/jpeg", "image/png", "image/webp"].includes(String(file.type).toLowerCase());
    }

    function imageValidationError(file) {
        if (!file) return "";
        if (!isImageFile(file)) return "Only image files are allowed.";
        if (file.size > MAX_SOURCE_IMAGE_SIZE_BYTES) return "Image is too large. Maximum source size is 15 MB.";
        return "";
    }

    function loadImageElementFromFile(file) {
        return new Promise((resolve, reject) => {
            const objectUrl = URL.createObjectURL(file);
            const image = new Image();

            image.onload = () => {
                URL.revokeObjectURL(objectUrl);
                resolve(image);
            };

            image.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error("Could not read the selected image."));
            };

            image.src = objectUrl;
        });
    }

    function canvasToBlob(canvas, type, quality) {
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error("Could not prepare the image for upload."));
                    return;
                }
                resolve(blob);
            }, type, quality);
        });
    }

    async function normalizeImageForUpload(file) {
        if (!isNormalizableImageFile(file) || typeof document === "undefined") return file;

        const image = await loadImageElementFromFile(file);
        const sourceWidth = image.naturalWidth || image.width;
        const sourceHeight = image.naturalHeight || image.height;
        if (!sourceWidth || !sourceHeight) return file;

        const scale = Math.min(1, MAX_UPLOAD_IMAGE_DIMENSION / Math.max(sourceWidth, sourceHeight));
        const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
        const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
        const normalizedType = String(file.type).toLowerCase();
        const requiresResize = targetWidth !== sourceWidth || targetHeight !== sourceHeight;

        if (!requiresResize && file.size <= MAX_IMAGE_SIZE_BYTES) return file;

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const context = canvas.getContext("2d", { alpha: normalizedType === "image/png" });
        if (!context) throw new Error("Could not process the selected image.");

        if (normalizedType !== "image/png") {
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, targetWidth, targetHeight);
        }
        context.drawImage(image, 0, 0, targetWidth, targetHeight);

        const blob = await canvasToBlob(
            canvas,
            normalizedType,
            normalizedType === "image/png" ? undefined : NORMALIZED_IMAGE_QUALITY
        );

        const baseName = String(file.name || "image").replace(/\.[^.]+$/, "") || "image";
        const extension = normalizedType === "image/png" ? "png" : normalizedType === "image/webp" ? "webp" : "jpg";
        return new File([blob], `${baseName}.${extension}`, {
            type: normalizedType,
            lastModified: Date.now()
        });
    }

    async function safeRemoveUploadedImage(filePath) {
        if (!filePath) return;
        try {
            await supabaseClient.storage.from(STORAGE_BUCKET).remove([filePath]);
        } catch (cleanupError) {
            console.error("Failed to remove uploaded image after error:", cleanupError);
        }
    }

    function todayDateKey() {
        return toCalendarDateKey(new Date());
    }

    function monthDateKey() {
        return toCalendarMonthKey(new Date());
    }

    function getReportingDateParts(value) {
        const date = value instanceof Date ? value : new Date(value || Date.now());
        if (Number.isNaN(date.getTime())) return null;

        const parts = REPORTING_DATE_PARTS_FORMATTER.formatToParts(date);
        const year = parts.find((part) => part.type === "year")?.value;
        const month = parts.find((part) => part.type === "month")?.value;
        const day = parts.find((part) => part.type === "day")?.value;
        if (!year || !month || !day) return null;

        return { year, month, day };
    }

    function toCalendarDateKey(value) {
        const parts = getReportingDateParts(value);
        return parts ? `${parts.year}-${parts.month}-${parts.day}` : "";
    }

    function toCalendarMonthKey(value) {
        const dateKey = toCalendarDateKey(value);
        return dateKey ? dateKey.slice(0, 7) : "";
    }

    function formatDateTime(value) {
        if (!value) return "Unknown";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString(undefined, { timeZone: REPORTING_TIME_ZONE });
    }

    function clampNumber(value, fallback, min, max) {
        const n = toNumber(value, fallback);
        return Math.min(max, Math.max(min, n));
    }

    function formatAlertNumber(value, maximumFractionDigits = 2) {
        return toNumber(value, 0).toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits
        });
    }

    function formatAlertPercent(value, maximumFractionDigits = 2) {
        return `${formatAlertNumber(toNumber(value, 0) * 100, maximumFractionDigits)}%`;
    }

    function normalizeAlertConfig(raw) {
        return {
            lowStockThreshold: Math.max(0, Math.floor(toNumber(raw?.low_stock_threshold ?? raw?.lowStockThreshold, LOW_STOCK_THRESHOLD))),
            lowMarginThreshold: clampNumber(raw?.low_margin_threshold ?? raw?.lowMarginThreshold, LOW_MARGIN_THRESHOLD, 0, 1),
            quarterStockRatio: clampNumber(raw?.quarter_stock_ratio ?? raw?.quarterStockRatio, QUARTER_STOCK_RATIO, 0, 1),
            notificationLimit: Math.min(50, Math.max(1, Math.floor(toNumber(raw?.notification_limit ?? raw?.notificationLimit, ALERT_NOTIFICATION_LIMIT)))),
            includeBreakEvenLowMargin: Boolean(raw?.include_break_even_low_margin ?? raw?.includeBreakEvenLowMargin)
        };
    }

    async function loadAlertConfig() {
        try {
            const { data, error } = await supabaseClient.rpc("get_alert_settings");
            if (error) throw error;
            const row = Array.isArray(data) ? data[0] : data;
            alertConfig = normalizeAlertConfig(row || DEFAULT_ALERT_CONFIG);
        } catch (_error) {
            alertConfig = { ...DEFAULT_ALERT_CONFIG };
        }

        return alertConfig;
    }

    function alertSeverityRank(severity) {
        if (severity === "critical") return 3;
        if (severity === "warning") return 2;
        return 1;
    }

    function alertSeverityClass(severity) {
        if (severity === "critical") return "critical";
        if (severity === "warning") return "warning";
        return "info";
    }

    function titleCase(value) {
        return String(value || "")
            .split("_")
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ");
    }

    function alertTypeKey(value) {
        return String(value || "").toLowerCase();
    }

    function popupSeverityForAlertType(type) {
        if (type === "loss_making" || type === "out_of_stock") return "critical";
        if (type === "low_stock" || type === "low_margin") return "warning";
        return "info";
    }

    function popupAlertCategory(type) {
        if (type === "low_margin" || type === "loss_making") return "Margin Alert";
        return "Inventory Alert";
    }

    function popupAlertTitle(type, fallbackTitle) {
        if (fallbackTitle) return fallbackTitle;
        if (type === "out_of_stock") return "Out Of Stock";
        if (type === "loss_making") return "Loss-Making Item";
        if (type === "low_margin") return "Low Margin";
        if (type === "quarter_stock") return "Restock Soon";
        if (type === "low_stock") return "Low Stock";
        return "Alert";
    }

    function popupAlertIconLabel(type) {
        if (type === "out_of_stock") return "OOS";
        if (type === "loss_making") return "LOSS";
        if (type === "low_margin") return "MRG";
        if (type === "quarter_stock") return "QTR";
        if (type === "low_stock") return "STK";
        return "ALT";
    }

    function popupAlertKey(alert) {
        const type = alertTypeKey(alert.alert_type || alert.type);
        const status = String(alert.status || "open").toLowerCase();
        const productName = alert.product_name_snapshot || alert.product_name || "";
        const message = alert.message || alert.title || "";
        if (alert.id) {
            const triggerCount = toNumber(alert.trigger_count, 0);
            const lastTriggered = alert.last_triggered_at || alert.created_at || "";
            return `db:${alert.id}:${status}:${triggerCount}:${lastTriggered}`;
        }
        return `fallback:${type}:${productName}:${message}`;
    }

    function shouldShowAlertPopup(alert) {
        const type = alertTypeKey(alert.alert_type || alert.type);
        const status = String(alert.status || "open").toLowerCase();
        return POPUP_ALERT_TYPES.has(type) && status === "open";
    }

    function popupAlertFromFallback(product, entry) {
        const type = alertTypeKey(entry.type);
        return {
            alert_type: type,
            severity: popupSeverityForAlertType(type),
            status: "open",
            title: titleCase(type),
            message: entry.message,
            product_name_snapshot: product.name || "Unnamed"
        };
    }

    function pruneDismissedPopupAlerts(alerts) {
        const currentKeys = new Set(alerts.map((alert) => popupAlertKey(alert)));
        for (const popupKey of Array.from(dismissedAlertPopups)) {
            if (!currentKeys.has(popupKey)) dismissedAlertPopups.delete(popupKey);
        }
        for (const popupKey of Array.from(vibratedAlertPopups)) {
            if (!currentKeys.has(popupKey)) vibratedAlertPopups.delete(popupKey);
        }
    }

    function vibrateLowStockPopups(alerts) {
        if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;

        let shouldVibrate = false;
        for (const alert of alerts) {
            if (alertTypeKey(alert.alert_type || alert.type) !== "low_stock") continue;

            const popupKey = popupAlertKey(alert);
            if (vibratedAlertPopups.has(popupKey)) continue;

            vibratedAlertPopups.add(popupKey);
            shouldVibrate = true;
        }

        if (!shouldVibrate) return;

        try {
            navigator.vibrate([120, 70, 120]);
        } catch (_error) {
            // Ignore unsupported vibration errors and keep the popup behavior intact.
        }
    }

    function renderAlertPopups(alerts) {
        if (!alertPopupStack) return;

        activePopupAlerts = alerts.filter(shouldShowAlertPopup);
        pruneDismissedPopupAlerts(activePopupAlerts);

        const popupLimit = Math.max(1, toNumber(alertConfig.notificationLimit, ALERT_NOTIFICATION_LIMIT));
        const visibleAlerts = activePopupAlerts
            .filter((alert) => !dismissedAlertPopups.has(popupAlertKey(alert)))
            .slice(0, popupLimit);

        if (!visibleAlerts.length) {
            alertPopupStack.innerHTML = "";
            alertPopupStack.hidden = true;
            return;
        }

        vibrateLowStockPopups(visibleAlerts);
        alertPopupStack.hidden = false;
        alertPopupStack.innerHTML = visibleAlerts.map((alert) => {
            const popupKey = popupAlertKey(alert);
            const type = alertTypeKey(alert.alert_type || alert.type);
            const severity = String(alert.severity || popupSeverityForAlertType(type)).toLowerCase();
            const status = String(alert.status || "open").toLowerCase();
            const lastTriggeredAt = alert.last_triggered_at || alert.created_at;
            const displayTitle = popupAlertTitle(type, alert.title);
            const categoryLabel = popupAlertCategory(type);
            const iconLabel = popupAlertIconLabel(type);
            const metaParts = [];
            if (lastTriggeredAt) metaParts.push(`Last triggered: ${formatDateTime(lastTriggeredAt)}`);
            if (toNumber(alert.trigger_count, 0) > 0) metaParts.push(`Trigger count: ${formatAlertNumber(alert.trigger_count, 0)}`);
            if (alert.acknowledged_by_name) metaParts.push(`Acknowledged by ${alert.acknowledged_by_name}`);

            return `
                <section class="alert-popup ${alertSeverityClass(severity)}" data-alert-popup="${escapeHtml(popupKey)}" role="${severity === "critical" ? "alert" : "status"}">
                    <button type="button" class="alert-popup-close" data-popup-dismiss="${escapeHtml(popupKey)}" aria-label="Dismiss alert popup">&times;</button>
                    <div class="alert-popup-top">
                        <div class="alert-popup-icon">${escapeHtml(iconLabel)}</div>
                        <div class="alert-popup-copy">
                            <div class="alert-popup-label">${escapeHtml(categoryLabel)}</div>
                            <div class="alert-popup-title-row">
                                <div class="alert-popup-title">${escapeHtml(displayTitle)}</div>
                                <span class="alert-badge ${alertSeverityClass(severity)}">${escapeHtml(titleCase(severity))}</span>
                                <span class="alert-badge status">${escapeHtml(titleCase(status))}</span>
                            </div>
                            <div class="alert-popup-product">${escapeHtml(alert.product_name_snapshot || "Unnamed")}</div>
                        </div>
                    </div>
                    <div class="alert-popup-body">
                        <div class="alert-popup-message">${escapeHtml(alert.message || displayTitle || "Alert")}</div>
                        ${metaParts.length ? `<div class="alert-popup-meta">${escapeHtml(metaParts.join(" | "))}</div>` : ""}
                    </div>
                    <div class="alert-popup-actions">
                        ${alert.id ? `<button type="button" class="alert-action-btn" data-alert-action="acknowledge" data-alert-id="${escapeHtml(alert.id)}" ${status !== "open" ? "disabled" : ""}>Acknowledge</button>` : ""}
                        ${alert.id ? `<button type="button" class="alert-action-btn" data-alert-action="resolve" data-alert-id="${escapeHtml(alert.id)}" ${status === "resolved" ? "disabled" : ""}>Resolve</button>` : ""}
                        <button type="button" class="alert-action-btn" data-popup-dismiss="${escapeHtml(popupKey)}">Dismiss</button>
                    </div>
                </section>
            `;
        }).join("");
    }

    function sortAlertsForDisplay(rows) {
        return [...rows].sort((a, b) => {
            const severityDiff = alertSeverityRank(String(b.severity || "").toLowerCase()) - alertSeverityRank(String(a.severity || "").toLowerCase());
            if (severityDiff !== 0) return severityDiff;
            return new Date(b.last_triggered_at || b.created_at || 0) - new Date(a.last_triggered_at || a.created_at || 0);
        });
    }

    function productQty(product) {
        const modern = toNumber(product.product_quantity, NaN);
        if (Number.isFinite(modern)) return modern;
        return toNumber(product.stock, 0);
    }

    function initialStock(product) {
        const modern = toNumber(product.initial_stock, NaN);
        if (Number.isFinite(modern)) return modern;
        return productQty(product);
    }

    function unitPrice(product) {
        const modern = toNumber(product.price_per_unit, NaN);
        if (Number.isFinite(modern)) return modern;
        return toNumber(product.price, 0);
    }

    function unitsPerBox(product) {
        const n = toNumber(product.units_per_box, NaN);
        return Number.isFinite(n) && n > 0 ? n : null;
    }

    function boxPrice(product) {
        const manual = toNumber(product.price_per_box, NaN);
        const upb = unitsPerBox(product);
        const unit = unitPrice(product);
        if (!upb) return null;
        if (Number.isFinite(manual) && manual > 0) return manual;
        if (Number.isFinite(unit) && unit >= 0) return unit * upb;
        return null;
    }

    function saleTypeLabel(saleType) {
        return saleType === "box" ? "box" : "unit";
    }

    function defaultSalePricePerType(product, saleType) {
        const candidate = saleType === "box" ? boxPrice(product) : unitPrice(product);
        return Number.isFinite(Number(candidate)) ? roundMoney(candidate) : 0;
    }

    function promptSalePricePerType(product, saleType) {
        const label = saleTypeLabel(saleType);
        const defaultPrice = defaultSalePricePerType(product, saleType);
        const productName = product?.name || "this product";

        while (true) {
            const ask = window.prompt(
                `Enter selling price per ${label} for ${productName}.\nUse the discounted price if you gave a discount.\nNormal price: ${formatRwf(defaultPrice)} per ${label}.`,
                String(defaultPrice)
            );

            if (ask === null) return null;

            const normalized = String(ask).replace(/,/g, "").trim();
            if (!normalized) return defaultPrice;

            const parsed = Number(normalized);
            if (Number.isFinite(parsed) && parsed >= 0) {
                return roundMoney(parsed);
            }

            alert("Price must be a valid number that is 0 or greater.");
        }
    }

    function currentCostPool(product) {
        return toNumber(product.purchase_price, 0);
    }

    function avgCostPerUnit(product) {
        const qty = productQty(product);
        if (qty <= 0) return 0;
        return currentCostPool(product) / qty;
    }

    function isSoldOutProduct(product) {
        const status = String(product?.status || "").toLowerCase();
        return productQty(product) <= 0 || status === "sold" || status === "out_of_stock";
    }

    function activeAlertsForProduct(productId) {
        if (!alertsBackedByDb) return [];
        return persistedAlerts.filter((alert) => String(alert.product_id) === String(productId));
    }

    async function requireAuth() {
        const { data, error } = await supabaseClient.auth.getSession();
        if (error || !data.session) {
            window.location.href = "login.html";
            return false;
        }

        currentAdminId = data.session.user.id || "";
        currentAdminEmail = data.session.user.email || "admin";
        const { data: adminRow, error: adminError } = await supabaseClient
            .from("admin_users")
            .select("user_id, is_active")
            .eq("user_id", data.session.user.id)
            .eq("is_active", true)
            .maybeSingle();

        if (adminError || !adminRow) {
            await supabaseClient.auth.signOut();
            window.location.href = "login.html";
            return false;
        }

        sessionInfo.textContent = `Signed in as ${currentAdminEmail}`;
        return true;
    }

    function resetDuplicateState() {
        pendingDuplicateProduct = null;
        if (duplicatePanel) duplicatePanel.classList.remove("active");
        if (duplicateSummary) duplicateSummary.textContent = "";
    }

    function showDuplicatePanel(product) {
        pendingDuplicateProduct = product;
        if (duplicateSummary) {
            duplicateSummary.textContent = `${product.name || "This product"} already exists. Choose whether to add stock or edit selling price.`;
        }
        if (duplicatePanel) duplicatePanel.classList.add("active");
        setStatus(formStatus, "Duplicate detected. Choose an action below.", "warn");
    }

    function filePathForUpload(fileName) {
        const ext = fileName.includes(".") ? fileName.split(".").pop() : "jpg";
        const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "") || "jpg";
        return `${crypto.randomUUID()}.${safeExt}`;
    }

    async function uploadImage(file) {
        if (!file) throw new Error("Choose an image file to upload.");
        const validationError = imageValidationError(file);
        if (validationError) throw new Error(validationError);

        const uploadFile = await normalizeImageForUpload(file);
        if (uploadFile.size > MAX_IMAGE_SIZE_BYTES) {
            throw new Error("Image is still too large after optimization. Choose a smaller image.");
        }

        const filePath = filePathForUpload(uploadFile.name || file.name);
        const { error: uploadError } = await supabaseClient.storage
            .from(STORAGE_BUCKET)
            .upload(filePath, uploadFile, { cacheControl: "3600", upsert: false });

        if (uploadError) throw new Error(uploadError.message || "Image upload failed");

        const { data } = supabaseClient.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
        if (!data?.publicUrl) throw new Error("Could not resolve public image URL");
        return { filePath, publicUrl: data.publicUrl };
    }

    async function findExistingProduct(name, productId) {
        if (productId) {
            const { data: byId, error: byIdError } = await supabaseClient
                .from("products")
                .select("*")
                .eq("id", productId)
                .maybeSingle();
            if (!byIdError && byId) return byId;
        }

        const targetName = normalizeName(name);
        if (!targetName) return null;

        // Server-side lookup avoids stale client inventory and catches case/space variants.
        const { data, error } = await supabaseClient
            .from("products")
            .select("*")
            .eq("normalized_name", targetName)
            .limit(20);

        if (!error && Array.isArray(data) && data.length) {
            const exact = data.find((row) => normalizeName(row.name) === targetName);
            if (exact) return exact;
        }

        return inventoryRows.find((row) => normalizeName(row.name) === targetName) || null;
    }

    function getProductFormValues() {
        const name = document.getElementById("name").value.trim();
        const productId = document.getElementById("productId").value.trim();
        const quantity = toNumber(document.getElementById("productQuantity").value, 0);
        const unitsBoxRaw = document.getElementById("unitsPerBox").value.trim();
        const units_per_box = unitsBoxRaw ? toNumber(unitsBoxRaw, 0) : null;
        const price_per_unit = toNumber(document.getElementById("pricePerUnit").value, NaN);
        const priceBoxRaw = document.getElementById("pricePerBox").value.trim();
        let price_per_box = priceBoxRaw ? toNumber(priceBoxRaw, 0) : null;
        const purchase_price = toNumber(document.getElementById("purchasePrice").value, NaN);
        const imageFile = document.getElementById("image").files[0];

        if (!units_per_box) {
            price_per_box = null;
        }

        return {
            name,
            productId,
            quantity,
            units_per_box,
            price_per_unit,
            price_per_box,
            purchase_price,
            imageFile
        };
    }

    function validateCreatePayload(values) {
        if (!values.name || values.quantity <= 0 || !Number.isFinite(values.price_per_unit) || values.price_per_unit < 0 || !Number.isFinite(values.purchase_price) || values.purchase_price < 0) {
            return "Please provide valid product details.";
        }
        const safeName = sanitizeProductName(values.name);
        if (safeName.length > 120) {
            return "Product name is too long (max 120 characters).";
        }
        if (values.units_per_box !== null && values.units_per_box <= 0) {
            return "Units per box must be greater than 0.";
        }
        const imageError = imageValidationError(values.imageFile);
        if (imageError) return imageError;
        return "";
    }

    function validateAddStockPayload(values) {
        if (!values.name || values.quantity <= 0 || !Number.isFinite(values.purchase_price) || values.purchase_price < 0) {
            return "Adding stock requires additional quantity and purchase price.";
        }
        const imageError = imageValidationError(values.imageFile);
        if (imageError) return imageError;
        return "";
    }

    function validatePriceEditPayload(values) {
        if (!values.name || !Number.isFinite(values.price_per_unit) || values.price_per_unit < 0) {
            return "Provide a valid unit selling price.";
        }
        if (values.units_per_box !== null && values.units_per_box <= 0) {
            return "Units per box must be greater than 0.";
        }
        if (values.price_per_box !== null && values.price_per_box < 0) {
            return "Price per box must be zero or greater.";
        }
        const imageError = imageValidationError(values.imageFile);
        if (imageError) return imageError;
        return "";
    }

    async function insertNewProduct(payload) {
        const modernPayload = {
            name: payload.name,
            image: payload.image,
            status: payload.product_quantity > 0 ? "available" : "out_of_stock",
            initial_stock: payload.initial_stock,
            product_quantity: payload.product_quantity,
            units_per_box: payload.units_per_box,
            price_per_unit: payload.price_per_unit,
            price_per_box: payload.price_per_box,
            purchase_price: payload.purchase_price
        };

        const { error } = await supabaseClient.from("products").insert([modernPayload]);
        if (!error) return;

        const legacyPayload = {
            name: payload.name,
            image: payload.image,
            status: payload.product_quantity > 0 ? "available" : "sold",
            stock: payload.product_quantity,
            price: payload.price_per_unit
        };
        const { error: legacyError } = await supabaseClient.from("products").insert([legacyPayload]);
        if (legacyError) throw new Error(legacyError.message || error.message || "Insert failed");
    }

    async function addStockToExisting(existing, payload) {
        const { data, error } = await supabaseClient.rpc("add_product_stock_atomic", {
            p_product_id: existing.id,
            p_add_quantity: payload.product_quantity,
            p_purchase_price: payload.purchase_price,
            p_image: payload.image || null
        });

        if (error) {
            throw new Error(error.message || "Atomic stock update failed. Run the latest schema.sql before adding stock.");
        }

        const resultRow = Array.isArray(data) ? data[0] : data;
        if (!resultRow?.product_id) {
            throw new Error("Atomic stock update failed. No updated product was returned.");
        }
    }

    async function updateExistingProductPrice(existing, nextValues) {
        const { data, error } = await supabaseClient.rpc("update_product_price_with_log", {
            p_product_id: existing.id,
            p_price_per_unit: nextValues.price_per_unit,
            p_price_per_box: nextValues.price_per_box,
            p_units_per_box: nextValues.units_per_box,
            p_image: nextValues.image || null,
            p_admin_id: currentAdminId || null,
            p_admin_name: currentAdminEmail || "admin"
        });

        if (error) {
            throw new Error(error.message || "Atomic price update failed. Run the latest schema.sql before editing prices.");
        }

        const resultRow = Array.isArray(data) ? data[0] : data;
        return !!resultRow?.price_changed;
    }

    async function updateExistingProductName(existing, nextName) {
        const cleanedName = sanitizeProductName(nextName);
        if (!cleanedName) {
            throw new Error("Product name cannot be empty.");
        }
        if (cleanedName.length > 120) {
            throw new Error("Product name is too long (max 120 characters).");
        }

        const currentNormalized = normalizeName(existing.name);
        const nextNormalized = normalizeName(cleanedName);
        if (!nextNormalized) {
            throw new Error("Product name cannot be empty.");
        }
        if (currentNormalized === nextNormalized) {
            return { changed: false };
        }

        const conflicting = await findExistingProduct(cleanedName, "");
        if (conflicting && String(conflicting.id) !== String(existing.id)) {
            throw new Error("Another product already uses that name.");
        }

        const { error } = await supabaseClient
            .from("products")
            .update({ name: cleanedName })
            .eq("id", existing.id);

        if (error) {
            throw new Error(error.message || "Failed to rename product.");
        }

        return { changed: true, name: cleanedName };
    }

    async function processProductForm(mode) {
        setStatus(formStatus, "Saving product...");
        submitBtn.disabled = true;

        const values = getProductFormValues();
        if (mode !== "create" && !pendingDuplicateProduct && !values.productId) {
            setStatus(formStatus, "Select an existing product first before using this action.", "error");
            submitBtn.disabled = false;
            return;
        }
        const validationError = mode === "add_stock"
            ? validateAddStockPayload(values)
            : (mode === "edit_price" ? validatePriceEditPayload(values) : validateCreatePayload(values));
        if (validationError) {
            setStatus(formStatus, validationError, "error");
            submitBtn.disabled = false;
            return;
        }

        const existing = pendingDuplicateProduct || await findExistingProduct(values.name, values.productId);
        if (mode === "create" && existing) {
            showDuplicatePanel(existing);
            submitBtn.disabled = false;
            return;
        }
        if ((mode === "add_stock" || mode === "edit_price") && !existing) {
            setStatus(formStatus, "The selected product no longer exists. Refresh and try again.", "error");
            resetDuplicateState();
            submitBtn.disabled = false;
            return;
        }
        if (!existing && !values.imageFile) {
            setStatus(formStatus, "Choose an image file when creating a new product.", "error");
            submitBtn.disabled = false;
            return;
        }

        let uploadedImagePath = null;
        let imageUrl = existing?.image || "";

        try {
            if (values.imageFile) {
                const upload = await uploadImage(values.imageFile);
                uploadedImagePath = upload.filePath;
                imageUrl = upload.publicUrl;
            }

            const payload = {
                name: values.name,
                image: imageUrl,
                initial_stock: values.quantity,
                product_quantity: values.quantity,
                units_per_box: values.units_per_box,
                price_per_unit: values.price_per_unit,
                price_per_box: values.price_per_box,
                purchase_price: values.purchase_price
            };

            if (existing) {
                if (mode === "add_stock") {
                    await addStockToExisting(existing, payload);
                    setStatus(formStatus, "Stock added successfully.", "success");
                } else {
                    const logged = await updateExistingProductPrice(existing, payload);
                    setStatus(formStatus, logged ? "Selling price updated and logged successfully." : "Selling price was unchanged.", logged ? "success" : "warn");
                }
            } else {
                try {
                    await insertNewProduct(payload);
                    setStatus(formStatus, "Product created successfully.", "success");
                } catch (insertError) {
                    const retryExisting = await findExistingProduct(values.name, "");
                    if (!retryExisting) throw insertError;
                    if (uploadedImagePath) {
                        await safeRemoveUploadedImage(uploadedImagePath);
                        uploadedImagePath = null;
                    }
                    showDuplicatePanel(retryExisting);
                    setStatus(formStatus, "Duplicate prevented. Choose an action for the existing product.", "warn");
                    return;
                }
            }

            productForm.reset();
            document.getElementById("productId").value = "";
            resetDuplicateState();
            await loadInventory();
            await refreshSalesDashboard(false);
        } catch (error) {
            console.error(error);
            setStatus(formStatus, error.message || "Save failed.", "error");
            await safeRemoveUploadedImage(uploadedImagePath);
        } finally {
            submitBtn.disabled = false;
        }
    }

    async function upsertProductFromForm(event) {
        event.preventDefault();
        resetDuplicateState();
        await processProductForm("create");
    }

    function fallbackProductAlertEntries(product) {
        const alerts = [];
        const qty = productQty(product);
        const openingStock = initialStock(product);
        const unit = unitPrice(product);
        const avgCost = avgCostPerUnit(product);
        const margin = unit > 0 ? (unit - avgCost) / unit : 0;
        const marginThresholdLabel = formatAlertPercent(alertConfig.lowMarginThreshold);
        const quarterStockLabel = formatAlertPercent(alertConfig.quarterStockRatio);
        const breakEvenMargin = alertConfig.includeBreakEvenLowMargin && unit > 0 && Math.abs(unit - avgCost) < 0.0001;

        if (unit < avgCost) {
            alerts.push({
                type: "loss_making",
                message: `You are making a loss on this product. Average cost is ${formatRwf(avgCost)} per unit while selling price is ${formatRwf(unit)}, a loss of ${formatRwf(Math.max(avgCost - unit, 0))} per unit.`
            });
        } else if (unit > 0 && ((margin > 0 && margin < alertConfig.lowMarginThreshold) || breakEvenMargin)) {
            alerts.push({
                type: "low_margin",
                message: `Increase price. Margin is ${formatAlertPercent(Math.max(margin, 0))}, below the ${marginThresholdLabel} threshold${breakEvenMargin ? " and currently at break-even." : "."}`
            });
        }
        if (qty > 0 && qty <= alertConfig.lowStockThreshold) {
            alerts.push({
                type: "low_stock",
                message: `Stock running low. ${qty} unit(s) remaining, threshold is ${alertConfig.lowStockThreshold}.`
            });
        }
        if (openingStock > 0 && qty <= (openingStock * alertConfig.quarterStockRatio)) {
            alerts.push({
                type: "quarter_stock",
                message: `Stock Alert: This product has reached ${quarterStockLabel} or less of its original stock. Please restock. Current stock is ${qty} of ${openingStock}.`
            });
        }
        if (qty <= 0) {
            alerts.push({
                type: "out_of_stock",
                message: "Out of stock"
            });
        }

        return alerts;
    }

    function fallbackProductAlertMessages(product) {
        return fallbackProductAlertEntries(product).map((alert) => alert.message);
    }

    function productAlertMessages(product) {
        const persisted = activeAlertsForProduct(product.id).map((alert) => alert.message).filter(Boolean);
        if (alertsBackedByDb) return persisted;
        return fallbackProductAlertMessages(product);
    }

    function renderInventory(products) {
        if (!products.length) {
            inventoryBody.innerHTML = '<tr><td colspan="9">No products yet.</td></tr>';
            return;
        }

        inventoryBody.innerHTML = products.map((item) => {
            const safeName = escapeHtml(item.name || "Unnamed");
            const safeImage = escapeHtml(item.image || "");
            const qty = productQty(item);
            const startingStock = initialStock(item);
            const upb = unitsPerBox(item);
            const up = unitPrice(item);
            const bp = boxPrice(item);
            const canSellBox = !!upb && Number.isFinite(bp) && bp >= 0;
            const costPool = currentCostPool(item);
            const status = qty <= 0 ? "out_of_stock" : (item.status || "available");
            const soldOut = isSoldOutProduct(item);
            const alerts = productAlertMessages(item);
            const alertText = alerts.length ? alerts.join(" | ") : "OK";

            return `
                <tr>
                    <td data-label="Image"><img src="${safeImage}" alt="${safeName}" class="thumb"></td>
                    <td data-label="Name">${safeName}</td>
                    <td data-label="Qty">${qty}</td>
                    <td data-label="Unit/Box">${upb ? `${upb} per box` : "Unit only"}<br><span class="muted">Initial: ${startingStock} | Current: ${qty}</span></td>
                    <td data-label="Pricing">Unit: ${formatRwf(up)}${bp ? `<br>Box: ${formatRwf(bp)}` : ""}</td>
                    <td data-label="Cost Pool">${formatRwf(costPool)}</td>
                    <td data-label="Status">${escapeHtml(status)}</td>
                    <td data-label="Alerts">${escapeHtml(alertText)}</td>
                    <td data-label="Actions">
                        <div class="actions">
                            <button type="button" class="btn btn-success" ${soldOut ? "disabled" : ""} onclick="sellProduct('${item.id}', 'unit')">Sell Unit</button>
                            <button type="button" class="btn btn-success" ${soldOut || !canSellBox || qty < upb ? "disabled" : ""} onclick="sellProduct('${item.id}', 'box')">Sell Box</button>
                            <button type="button" class="btn btn-primary" onclick="prefillStockForm('${item.id}')">Add Stock</button>
                            <button type="button" class="btn btn-primary" onclick="editProductName('${item.id}')">Edit Name</button>
                            <button type="button" class="btn btn-danger" ${soldOut ? "disabled" : ""} onclick="markSold('${item.id}', this)">Mark as Sold</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join("");
    }

    function inventorySearchBlob(item) {
        const alerts = productAlertMessages(item).join(" ");
        return normalizeSearchText([
            item.name,
            item.id,
            item.status,
            alerts
        ].filter(Boolean).join(" "));
    }

    function filteredInventoryRows() {
        const term = normalizeSearchText(inventorySearchTerm);
        if (!term) return inventoryRows;
        return inventoryRows.filter((item) => inventorySearchBlob(item).includes(term));
    }

    function updateInventorySearchMessage(filteredCount, totalCount) {
        if (!inventorySearchStatus) return;
        if (!inventorySearchTerm) {
            inventorySearchStatus.textContent = "";
            return;
        }

        inventorySearchStatus.textContent = filteredCount === totalCount
            ? `${filteredCount} product(s) found for "${inventorySearchTerm}".`
            : `${filteredCount} of ${totalCount} product(s) found for "${inventorySearchTerm}".`;
    }

    function rerenderInventoryForSearch() {
        const filtered = filteredInventoryRows();
        updateInventorySearchMessage(filtered.length, inventoryRows.length);
        if (!filtered.length && inventoryRows.length && inventorySearchTerm) {
            inventoryBody.innerHTML = '<tr><td colspan="9">No matching products for this search.</td></tr>';
            return;
        }
        renderInventory(filtered);
    }

    async function loadInventory() {
        setStatus(inventoryStatus, "Loading inventory...");
        try {
            const { data, error } = await supabaseClient
                .from("products")
                .select("*")
                .order("created_at", { ascending: false });

            if (error) {
                console.error(error);
                setStatus(inventoryStatus, "Failed to load inventory.", "error");
                inventoryBody.innerHTML = '<tr><td colspan="9">Failed to load inventory.</td></tr>';
                return;
            }

            inventoryRows = data || [];
            setStatus(inventoryStatus, `${inventoryRows.length} product(s) in inventory.`);
            await refreshAlertViews(false);
        } catch (error) {
            console.error(error);
            setStatus(inventoryStatus, "Unable to reach the inventory service right now.", "error");
            inventoryBody.innerHTML = '<tr><td colspan="9">Unable to load inventory.</td></tr>';
        }
    }

    async function insertSaleRecord(record) {
        const modern = {
            product_id: record.product_id,
            quantity: record.quantity,
            selling_price: record.selling_price,
            cost_price: record.cost_price,
            profit: record.profit,
            sale_type: record.sale_type,
            units_sold: record.units_sold,
            sold_by: record.sold_by,
            status: "completed"
        };

        const { data, error } = await supabaseClient
            .from("sales")
            .insert([modern])
            .select("id")
            .maybeSingle();
        if (!error) return data?.id || null;

        const legacy = {
            product_id: record.product_id,
            name: record.name,
            price_rwf: record.selling_price / Math.max(1, record.quantity),
            quantity: record.quantity,
            total_price: record.selling_price,
            sold_by: record.sold_by,
            status: "completed"
        };
        const { data: legacyData, error: legacyError } = await supabaseClient
            .from("sales")
            .insert([legacy])
            .select("id")
            .maybeSingle();
        if (legacyError) throw new Error(legacyError.message || error.message || "Failed to record sale");
        return legacyData?.id || null;
    }

    async function updateProductAfterSale(product, unitsSold, costSold) {
        const nextQty = Math.max(0, productQty(product) - unitsSold);
        const nextCostPool = Math.max(0, currentCostPool(product) - costSold);
        const status = nextQty <= 0 ? "out_of_stock" : "available";

        const modern = {
            product_quantity: nextQty,
            purchase_price: nextCostPool,
            status
        };

        const { error } = await supabaseClient.from("products").update(modern).eq("id", product.id);
        if (!error) return;

        const legacy = {
            stock: nextQty,
            status: nextQty <= 0 ? "sold" : "available"
        };
        const { error: legacyError } = await supabaseClient.from("products").update(legacy).eq("id", product.id);
        if (legacyError) throw new Error(legacyError.message || error.message || "Failed to update stock");
    }

    async function deleteSaleRecord(saleId) {
        if (!saleId) return;
        const { error } = await supabaseClient.from("sales").delete().eq("id", saleId);
        if (error) throw new Error(error.message || "Failed to roll back sale record");
    }

    async function loadProductByIdRaw(productId) {
        const { data, error } = await supabaseClient
            .from("products")
            .select("*")
            .eq("id", productId)
            .maybeSingle();

        if (error) throw new Error(error.message || "Failed to load product");
        return data || null;
    }

    function buildSaleRecord(product, saleType, saleQty, salePricePerType, soldBy) {
        const safeSaleType = saleType === "box" ? "box" : "unit";
        const safeQty = Math.max(1, Math.floor(toNumber(saleQty, 1)));
        const upb = unitsPerBox(product);
        if (safeSaleType === "box" && !upb) {
            throw new Error("This product can only be sold by unit.");
        }

        const priceEach = roundMoney(salePricePerType);
        if (!Number.isFinite(priceEach) || priceEach < 0) {
            throw new Error("Sale price must be 0 or greater.");
        }

        const unitsSold = safeSaleType === "box" ? safeQty * upb : safeQty;
        const sellingPrice = roundMoney(priceEach * safeQty);
        const costPrice = roundMoney(avgCostPerUnit(product) * unitsSold);
        return {
            product_id: product.id,
            name: product.name || "Unnamed",
            quantity: safeQty,
            units_sold: unitsSold,
            sale_type: safeSaleType,
            selling_price: sellingPrice,
            cost_price: costPrice,
            profit: roundMoney(sellingPrice - costPrice),
            sold_by: soldBy || currentAdminEmail || "admin"
        };
    }

    async function executeAtomicSale(productId, saleType, saleQty, soldBy) {
        const { data, error } = await supabaseClient.rpc("process_sale_atomic", {
            p_product_id: productId,
            p_sale_type: saleType,
            p_sale_quantity: saleQty,
            p_sold_by: soldBy || "admin"
        });

        if (error) {
            throw new Error(error.message || "Atomic sale failed. Run the latest schema.sql before recording sales.");
        }

        const resultRow = Array.isArray(data) ? data[0] : data;
        if (!resultRow?.sale_id) {
            throw new Error("Atomic sale failed. No sale record was returned.");
        }

        return resultRow;
    }

    async function executeAtomicSaleWithCustomPrice(productId, saleType, saleQty, soldBy, customSalePrice) {
        const { data, error } = await supabaseClient.rpc("process_sale_atomic_custom_price", {
            p_product_id: productId,
            p_sale_type: saleType,
            p_sale_quantity: saleQty,
            p_sold_by: soldBy || "admin",
            p_custom_sale_price: roundMoney(customSalePrice)
        });

        if (error) {
            throw new Error(error.message || "Atomic discounted sale failed. Run the latest schema.sql before recording discounted sales.");
        }

        const resultRow = Array.isArray(data) ? data[0] : data;
        if (!resultRow?.sale_id) {
            throw new Error("Atomic discounted sale failed. No sale record was returned.");
        }

        return resultRow;
    }

    async function recordSaleWithFallback(product, saleType, saleQty, soldBy, salePricePerType) {
        const defaultPrice = defaultSalePricePerType(product, saleType);
        const useCustomPrice = Math.abs(roundMoney(salePricePerType) - defaultPrice) > 0.0001;

        if (useCustomPrice) {
            return await executeAtomicSaleWithCustomPrice(product.id, saleType, saleQty, soldBy, salePricePerType);
        }

        return await executeAtomicSale(product.id, saleType, saleQty, soldBy);
    }

    window.prefillStockForm = function(productId) {
        const row = inventoryRows.find((x) => String(x.id) === String(productId));
        if (!row) return;
        document.getElementById("productId").value = row.id;
        document.getElementById("name").value = row.name || "";
        document.getElementById("productQuantity").value = "1";
        document.getElementById("unitsPerBox").value = unitsPerBox(row) || "";
        document.getElementById("pricePerUnit").value = unitPrice(row);
        document.getElementById("pricePerBox").value = toNumber(row.price_per_box, 0) > 0 ? row.price_per_box : "";
        document.getElementById("purchasePrice").value = "0";
        setStatus(formStatus, `Adding stock to ${row.name}.`);
    };

    window.editProductName = async function(productId) {
        const row = inventoryRows.find((x) => String(x.id) === String(productId));
        if (!row) {
            alert("Product not found.");
            return;
        }

        const ask = window.prompt("Enter the new product name", row.name || "");
        if (ask === null) return;

        try {
            setStatus(inventoryStatus, `Updating name for ${row.name || "product"}...`);
            const result = await updateExistingProductName(row, ask);
            if (!result.changed) {
                setStatus(inventoryStatus, "Product name is unchanged.", "warn");
                return;
            }
            setStatus(inventoryStatus, `Product renamed to ${result.name}.`, "success");
            await loadInventory();
            await refreshSalesDashboard(false);
        } catch (error) {
            console.error(error);
            setStatus(inventoryStatus, error.message || "Failed to rename product.", "error");
            alert(error.message || "Failed to rename product.");
        }
    };

    window.sellProduct = async function(productId, saleType) {
        const product = inventoryRows.find((x) => String(x.id) === String(productId));
        if (!product) {
            alert("Product not found");
            return;
        }

        const qty = productQty(product);
        if (qty <= 0) {
            alert("Product is out of stock");
            return;
        }

        const upb = unitsPerBox(product);
        if (saleType === "box" && !upb) {
            alert("This product can only be sold by unit.");
            return;
        }

        const ask = window.prompt(`Enter number of ${saleType === "box" ? "boxes" : "units"} to sell`, "1");
        if (ask === null) return;
        const saleQty = Math.floor(toNumber(ask, 0));
        if (saleQty <= 0) {
            alert("Quantity must be greater than 0");
            return;
        }

        const unitsSold = saleType === "box" ? saleQty * upb : saleQty;
        if (unitsSold > qty) {
            alert("Not enough stock for this sale.");
            return;
        }

        const box = boxPrice(product);
        if (saleType === "box" && (!Number.isFinite(box) || box < 0)) {
            alert("Box price is unavailable for this product.");
            return;
        }

        const salePricePerType = promptSalePricePerType(product, saleType);
        if (salePricePerType === null) return;

        try {
            setStatus(
                inventoryStatus,
                `Recording ${saleQty} ${saleType === "box" ? "box(es)" : "unit(s)"} for ${product.name || "product"} at ${formatRwf(salePricePerType)} per ${saleTypeLabel(saleType)}...`
            );
            await recordSaleWithFallback(product, saleType, saleQty, currentAdminEmail || "admin", salePricePerType);
            await loadInventory();
            await refreshSalesDashboard(false);
            setStatus(
                inventoryStatus,
                `${product.name || "Product"} sold at ${formatRwf(salePricePerType)} per ${saleTypeLabel(saleType)}. Stock updated successfully.`,
                "success"
            );
            alert(`Sale recorded successfully at ${formatRwf(salePricePerType)} per ${saleTypeLabel(saleType)}.`);
        } catch (error) {
            console.error(error);
            alert(error.message || "Failed to record sale");
        }
    };

    window.markSold = async function(productId, buttonEl) {
        const key = String(productId || "");
        if (!key || markSoldInFlight.has(key)) return;

        markSoldInFlight.add(key);
        if (buttonEl) buttonEl.disabled = true;

        try {
            const product = await loadProductByIdRaw(productId);
            if (!product) {
                alert("Product not found");
                return;
            }

            if (isSoldOutProduct(product)) {
                alert("Product is already sold or out of stock");
                return;
            }

            const ask = window.prompt(`Enter quantity sold for ${product.name || "this product"}`, "1");
            if (ask === null) return;

            const saleQty = Math.floor(toNumber(ask, 0));
            if (saleQty <= 0) {
                alert("Quantity must be greater than 0");
                return;
            }

            const availableQty = productQty(product);
            if (saleQty > availableQty) {
                alert(`Not enough stock. Current stock is ${availableQty}.`);
                return;
            }

            const salePricePerType = promptSalePricePerType(product, "unit");
            if (salePricePerType === null) return;

            setStatus(
                inventoryStatus,
                `Recording ${saleQty} sold unit(s) for ${product.name || "product"} at ${formatRwf(salePricePerType)} per unit...`
            );

            await recordSaleWithFallback(product, "unit", saleQty, currentAdminEmail || "admin", salePricePerType);

            await loadInventory();
            await refreshSalesDashboard(false);
            setStatus(
                inventoryStatus,
                `${product.name || "Product"} marked sold at ${formatRwf(salePricePerType)} per unit. Stock reduced by ${saleQty} and sales dashboard updated.`,
                "success"
            );
        } catch (error) {
            console.error(error);
            setStatus(inventoryStatus, error.message || "Failed to mark product sold.", "error");
            alert(error.message || "Failed to mark product sold");
        } finally {
            markSoldInFlight.delete(key);
            if (buttonEl && document.body.contains(buttonEl)) buttonEl.disabled = false;
        }
    };

    window.markProductAsSold = window.markSold;

    function saleDate(row) {
        return row.created_at || row.sold_date || new Date().toISOString();
    }

    function priceLogDate(row) {
        return row.changed_at || row.created_at || new Date().toISOString();
    }

    function saleRevenue(row) {
        if (Number.isFinite(Number(row.selling_price))) return Number(row.selling_price);
        if (Number.isFinite(Number(row.total_price))) return Number(row.total_price);
        return (toNumber(row.price_rwf, 0) * Math.max(1, toNumber(row.quantity, 1)));
    }

    function saleCost(row) {
        return toNumber(row.cost_price, 0);
    }

    function saleProfit(row) {
        const direct = Number(row.profit);
        if (Number.isFinite(direct)) return direct;
        return saleRevenue(row) - saleCost(row);
    }

    function profitFromSaleAmounts(row) {
        return roundMoney(toNumber(row.revenue, 0) - toNumber(row.cost, 0));
    }

    function saleType(row) {
        if (row.sale_type === "box" || row.sale_type === "unit") return row.sale_type;
        return "unit";
    }

    function saleProductName(row) {
        const relatedProduct = Array.isArray(row.product) ? row.product[0] : row.product;
        return relatedProduct?.name || row.name || row.product_name || row.product_id || "Unnamed";
    }

    function saleStatus(row) {
        return row.status || "completed";
    }

    function formatPriceChangeDetails(row) {
        const oldUnit = formatRwf(row.old_price);
        const newUnit = formatRwf(row.new_price);
        const dateText = formatDateTime(priceLogDate(row));
        const adminName = row.admin_name || "admin";
        return `\u26A0\uFE0F Selling price updated from ${oldUnit} to ${newUnit} for ${row.product_name || "Unnamed"} on ${dateText} by ${adminName}`;
    }

    function createReportEntries(salesRows, priceRows) {
        const saleEntries = salesRows.map((row) => ({
            kind: "sale",
            date: saleDate(row),
            product: saleProductName(row),
            details: saleType(row),
            quantity: Math.max(1, toNumber(row.quantity, 1)),
            revenue: saleRevenue(row),
            cost: saleCost(row),
            profit: roundMoney(saleRevenue(row) - saleCost(row)),
            status: saleStatus(row),
            raw: row
        }));

        const priceEntries = priceRows.map((row) => ({
            kind: "price_update",
            date: priceLogDate(row),
            product: row.product_name || "Unnamed",
            details: formatPriceChangeDetails(row),
            quantity: "",
            revenue: "",
            cost: "",
            profit: "",
            status: "logged",
            raw: row
        }));

        return saleEntries.concat(priceEntries).sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    function applySalesFilters(rows) {
        return rows.filter((row) => {
            const dateIso = toCalendarDateKey(row.date || saleDate(row));
            const name = String(row.product || saleProductName(row)).toLowerCase();
            const type = row.kind === "sale" ? (row.details || saleType(row)) : "";
            if (filterFrom.value && dateIso < filterFrom.value) return false;
            if (filterTo.value && dateIso > filterTo.value) return false;
            if (filterProduct.value.trim() && !name.includes(filterProduct.value.trim().toLowerCase())) return false;
            if (filterSaleType.value && row.kind === "sale" && filterSaleType.value !== type) return false;
            if (filterSaleType.value && row.kind !== "sale") return false;
            return true;
        });
    }

    function renderSales(rows) {
        if (!rows.length) {
            salesBody.innerHTML = '<tr><td colspan="9">No sales records found.</td></tr>';
            return;
        }

        salesBody.innerHTML = rows.map((row) => {
            if (row.kind === "price_update") {
                return `
                <tr>
                    <td data-label="Date">${escapeHtml(formatDateTime(row.date))}</td>
                    <td data-label="Entry Type">Price Update</td>
                    <td data-label="Product">${escapeHtml(row.product)}</td>
                    <td data-label="Details">${escapeHtml(row.details)}</td>
                    <td data-label="Qty">-</td>
                    <td data-label="Revenue">-</td>
                    <td data-label="Cost">-</td>
                    <td data-label="Profit">-</td>
                    <td data-label="Status">${escapeHtml(row.status)}</td>
                </tr>
            `;
            }

            return `
                <tr>
                    <td data-label="Date">${escapeHtml(formatDateTime(row.date))}</td>
                    <td data-label="Entry Type">Sale</td>
                    <td data-label="Product">${escapeHtml(row.product)}</td>
                    <td data-label="Details">${escapeHtml(row.details)}</td>
                    <td data-label="Qty">${row.quantity}</td>
                    <td data-label="Revenue">${formatRwf(row.revenue)}</td>
                    <td data-label="Cost">${formatRwf(row.cost)}</td>
                    <td data-label="Profit">${formatRwf(row.profit)}</td>
                    <td data-label="Status">${escapeHtml(row.status)}</td>
                </tr>
            `;
        }).join("");
    }

    function renderSalesSummary(rows) {
        let totalRevenue = 0;
        let totalCost = 0;
        let totalProfit = 0;
        let soldUnits = 0;
        let todayProfit = 0;
        const dayKey = todayDateKey();

        for (const row of rows) {
            if (row.kind !== "sale") continue;
            const status = String(row.status || "").toLowerCase();
            if (status === "returned" || status === "cancelled" || status === "void") continue;
            totalRevenue += toNumber(row.revenue, 0);
            totalCost += toNumber(row.cost, 0);
            const saleProfit = profitFromSaleAmounts(row);
            totalProfit += saleProfit;
            soldUnits += Math.max(1, toNumber(row.raw?.units_sold, toNumber(row.quantity, 1)));
            if (toCalendarDateKey(row.date) === dayKey) {
                todayProfit += saleProfit;
            }
        }

        if (summaryTotalRevenue) summaryTotalRevenue.textContent = formatRwf(totalRevenue);
        if (summaryTotalCost) summaryTotalCost.textContent = formatRwf(totalCost);
        if (summaryTotalProfit) summaryTotalProfit.textContent = formatRwf(totalProfit);
        if (summarySoldUnits) summarySoldUnits.textContent = String(soldUnits);
        if (summaryTodayProfit) summaryTodayProfit.textContent = formatRwf(todayProfit);
    }

    function renderMetrics(rows) {
        let totalRevenue = 0;
        let totalCost = 0;
        let totalProfit = 0;
        let soldItems = 0;
        let dailyProfit = 0;
        let todaySoldProfit = 0;
        let monthlyProfit = 0;
        const day = todayDateKey();
        const month = monthDateKey();

        for (const row of rows) {
            if (row.kind !== "sale") continue;
            const status = String(row.status).toLowerCase();
            if (status === "returned" || status === "cancelled" || status === "void") continue;
            const soldStatus = status === "completed" || status === "sold";
            const rev = toNumber(row.revenue, 0);
            const cost = toNumber(row.cost, 0);
            const profit = profitFromSaleAmounts(row);
            const qty = Math.max(1, toNumber(row.raw?.units_sold, toNumber(row.quantity, 1)));
            const dateKey = toCalendarDateKey(row.date);
            const monthKey = toCalendarMonthKey(row.date);

            totalRevenue += rev;
            totalCost += cost;
            totalProfit += profit;
            soldItems += qty;
            if (dateKey === day) dailyProfit += profit;
            if (dateKey === day && soldStatus) todaySoldProfit += profit;
            if (monthKey === month) monthlyProfit += profit;
        }

        metricTotalRevenue.textContent = formatRwf(totalRevenue);
        metricTotalCost.textContent = formatRwf(totalCost);
        metricTotalProfit.textContent = formatRwf(totalProfit);
        metricDailyProfit.textContent = formatRwf(dailyProfit);
        if (metricTodaySoldProfit) metricTodaySoldProfit.textContent = formatRwf(todaySoldProfit);
        metricMonthlyProfit.textContent = formatRwf(monthlyProfit);
        metricSoldItems.textContent = String(soldItems);
    }

    function ensureCharts() {
        if (typeof Chart === "undefined") return;

        if (!dailyRevenueChart) {
            dailyRevenueChart = new Chart(document.getElementById("dailyRevenueChart"), {
                type: "line",
                data: { labels: [], datasets: [{ label: "Revenue", data: [], borderColor: "#1f8ef1", backgroundColor: "rgba(31,142,241,0.14)", fill: true, tension: 0.24 }] },
                options: { responsive: true, maintainAspectRatio: true, aspectRatio: 2, animation: false }
            });
        }

        if (!topProductsChart) {
            topProductsChart = new Chart(document.getElementById("topProductsChart"), {
                type: "bar",
                data: { labels: [], datasets: [{ label: "Units Sold", data: [], backgroundColor: "#1b9c5a" }] },
                options: { responsive: true, maintainAspectRatio: true, aspectRatio: 2, animation: false }
            });
        }
    }

    function renderCharts(rows) {
        ensureCharts();
        if (!dailyRevenueChart || !topProductsChart) return;

        const byDay = new Map();
        const byProduct = new Map();

        for (const row of rows) {
            if (row.kind !== "sale") continue;
            const status = String(row.status).toLowerCase();
            if (status === "returned" || status === "cancelled" || status === "void") continue;

            const date = toCalendarDateKey(row.date);
            const rev = toNumber(row.revenue, 0);
            const units = Math.max(1, toNumber(row.raw?.units_sold, toNumber(row.quantity, 1)));
            const name = row.product;
            byDay.set(date, (byDay.get(date) || 0) + rev);
            byProduct.set(name, (byProduct.get(name) || 0) + units);
        }

        const labels = Array.from(byDay.keys()).sort();
        dailyRevenueChart.data.labels = labels;
        dailyRevenueChart.data.datasets[0].data = labels.map((k) => byDay.get(k));
        dailyRevenueChart.update();

        const top = Array.from(byProduct.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
        topProductsChart.data.labels = top.map((x) => x[0]);
        topProductsChart.data.datasets[0].data = top.map((x) => x[1]);
        topProductsChart.update();
    }

    function renderAlertCards(target, alerts, emptyMessage) {
        if (!target) return;
        if (!alerts.length) {
            target.innerHTML = `<li class="alert-history-item">${escapeHtml(emptyMessage)}</li>`;
            return;
        }

        target.innerHTML = alerts.map((alert) => {
            const severity = String(alert.severity || "info").toLowerCase();
            const status = String(alert.status || "open").toLowerCase();
            const acknowledgedBy = alert.acknowledged_by_name ? ` | Acknowledged by ${alert.acknowledged_by_name}` : "";
            return `
                <li class="alert-item">
                    <div class="alert-card">
                        <div class="alert-content">
                            <div class="alert-head">
                                <span class="alert-badge ${alertSeverityClass(severity)}">${escapeHtml(titleCase(severity))}</span>
                                <span class="alert-badge status">${escapeHtml(titleCase(status))}</span>
                                <strong>${escapeHtml(alert.product_name_snapshot || "Unnamed")}</strong>
                            </div>
                            <div class="alert-message">${escapeHtml(alert.message || alert.title || "Alert")}</div>
                            <div class="alert-meta">
                                ${escapeHtml(alert.title || "Alert")} | Last triggered: ${escapeHtml(formatDateTime(alert.last_triggered_at || alert.created_at))} | Trigger count: ${escapeHtml(alert.trigger_count)}${escapeHtml(acknowledgedBy)}
                            </div>
                        </div>
                        <div class="alert-actions">
                            <button type="button" class="alert-action-btn" data-alert-action="acknowledge" data-alert-id="${escapeHtml(alert.id)}" ${status !== "open" ? "disabled" : ""}>Acknowledge</button>
                            <button type="button" class="alert-action-btn" data-alert-action="resolve" data-alert-id="${escapeHtml(alert.id)}" ${status === "resolved" ? "disabled" : ""}>Resolve</button>
                        </div>
                    </div>
                </li>
            `;
        }).join("");
    }

    function renderAlertHistory() {
        if (!alertHistoryList) return;

        if (!alertsBackedByDb) {
            alertHistoryList.innerHTML = '<li class="alert-history-item">Alert history becomes available after the latest schema.sql is applied.</li>';
            return;
        }

        if (!recentAlertEvents.length) {
            alertHistoryList.innerHTML = '<li class="alert-history-item">No alert activity right now.</li>';
            return;
        }

        alertHistoryList.innerHTML = recentAlertEvents.map((event) => `
            <li class="alert-history-item">
                <div class="alert-message">${escapeHtml(event.event_message || `${event.product_name_snapshot || "Unnamed"}: ${titleCase(event.event_type || "triggered")}`)}</div>
                <div class="alert-meta">${escapeHtml(titleCase(event.event_type || "event"))} | ${escapeHtml(event.actor_name || "system")} | ${escapeHtml(formatDateTime(event.created_at))}</div>
            </li>
        `).join("");
    }

    function renderFallbackSmartAlerts(products) {
        const entries = [];
        const notifications = [];
        const popupAlerts = [];
        const popupKeys = new Set();
        for (const p of products) {
            const fallbackAlerts = fallbackProductAlertEntries(p);
            for (const entry of fallbackAlerts) {
                const popupAlert = popupAlertFromFallback(p, entry);
                const popupKey = popupAlertKey(popupAlert);
                if (!popupKeys.has(popupKey)) {
                    popupKeys.add(popupKey);
                    popupAlerts.push(popupAlert);
                }
                if (entry.type === "out_of_stock") continue;
                const line = `${p.name || "Unnamed"}: ${entry.message}`;
                entries.push(line);
                if (entry.type === "quarter_stock") notifications.push(line);
            }
        }

        const uniqueEntries = Array.from(new Set(entries));
        const uniqueNotifications = Array.from(new Set(notifications)).slice(0, alertConfig.notificationLimit);

        if (!uniqueEntries.length) {
            smartAlerts.innerHTML = '<li class="alert-history-item">No alerts right now.</li>';
        } else {
            smartAlerts.innerHTML = uniqueEntries.map((line) => `<li class="alert-history-item">${escapeHtml(line)}</li>`).join("");
        }

        if (notificationList) {
            if (!uniqueNotifications.length) {
                notificationList.innerHTML = '<li class="alert-history-item">No notifications right now.</li>';
            } else {
                notificationList.innerHTML = uniqueNotifications.map((line) => `<li class="alert-history-item">${escapeHtml(line)}</li>`).join("");
            }
        }

        renderAlertPopups(popupAlerts);
        renderAlertHistory();
    }

    function renderSmartAlerts(products) {
        if (!alertsBackedByDb) {
            renderFallbackSmartAlerts(products);
            return;
        }

        const activeAlerts = sortAlertsForDisplay(persistedAlerts);
        const openNotifications = activeAlerts
            .filter((alert) => String(alert.status || "").toLowerCase() === "open")
            .slice(0, alertConfig.notificationLimit);

        renderAlertCards(smartAlerts, activeAlerts, "No alerts right now.");
        renderAlertCards(notificationList, openNotifications, "No notifications right now.");
        renderAlertPopups(activeAlerts);
        renderAlertHistory();
    }

    async function loadActiveAlertsRaw() {
        const { data, error } = await supabaseClient
            .from("alerts")
            .select("*")
            .in("status", ["open", "acknowledged"])
            .order("last_triggered_at", { ascending: false });

        if (error) throw new Error(error.message || "Failed to load alerts");
        return data || [];
    }

    async function loadRecentAlertEventsRaw() {
        const { data, error } = await supabaseClient
            .from("alert_events")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(12);

        if (error) throw new Error(error.message || "Failed to load alert history");
        return data || [];
    }

    async function refreshAlertViews(showLoading = true) {
        if (showLoading) setStatus(alertsStatus, "Loading alerts...");
        const alertConfigPromise = loadAlertConfig();
        try {
            const [nextAlertConfig, alertsRows, eventRows] = await Promise.all([
                alertConfigPromise,
                loadActiveAlertsRaw(),
                loadRecentAlertEventsRaw()
            ]);
            alertConfig = nextAlertConfig;
            persistedAlerts = alertsRows;
            recentAlertEvents = eventRows;
            alertsBackedByDb = true;
            setStatus(alertsStatus, `${persistedAlerts.length} active alert(s).`, persistedAlerts.length ? "warn" : "success");
        } catch (error) {
            alertConfig = await alertConfigPromise;
            console.error(error);
            persistedAlerts = [];
            recentAlertEvents = [];
            alertsBackedByDb = false;
            setStatus(alertsStatus, "Using local alert fallback. Apply the latest schema.sql to enable the full admin alert lifecycle.", "warn");
        }

        rerenderInventoryForSearch();
        renderSmartAlerts(inventoryRows);
    }

    async function updateAlertStatus(action, alertId) {
        const rpcName = action === "acknowledge" ? "acknowledge_alert" : "resolve_alert";
        const progressMessage = action === "acknowledge" ? "Acknowledging alert..." : "Resolving alert...";
        const successMessage = action === "acknowledge" ? "Alert acknowledged." : "Alert resolved.";

        setStatus(alertsStatus, progressMessage);
        try {
            const { data, error } = await supabaseClient.rpc(rpcName, {
                p_alert_id: alertId,
                p_admin_name: currentAdminEmail || "admin"
            });

            if (error) throw new Error(error.message || `Failed to ${action} alert.`);

            const resultRow = Array.isArray(data) ? data[0] : data;
            if (!resultRow?.alert_id) {
                throw new Error(`Failed to ${action} alert.`);
            }

            if (!resultRow.updated) {
                setStatus(alertsStatus, `Alert is already ${resultRow.status || "updated"}.`, "warn");
            } else {
                setStatus(alertsStatus, successMessage, "success");
            }

            await refreshAlertViews(false);
        } catch (error) {
            console.error(error);
            setStatus(alertsStatus, error.message || `Failed to ${action} alert.`, "error");
        }
    }

    async function handleAlertActionClick(event) {
        const button = event.target.closest("[data-alert-action]");
        if (!button) return;

        const action = button.getAttribute("data-alert-action");
        const alertId = button.getAttribute("data-alert-id");
        if (!action || !alertId) return;

        button.disabled = true;
        try {
            await updateAlertStatus(action, alertId);
        } finally {
            button.disabled = false;
        }
    }

    function dismissAlertPopup(popupKey) {
        if (!popupKey) return;
        dismissedAlertPopups.add(popupKey);
        renderAlertPopups(activePopupAlerts);
    }

    function dismissVisibleAlertPopups() {
        for (const alert of activePopupAlerts) {
            dismissedAlertPopups.add(popupAlertKey(alert));
        }
        renderAlertPopups(activePopupAlerts);
    }

    async function handleAlertPopupClick(event) {
        const dismissButton = event.target.closest("[data-popup-dismiss]");
        if (dismissButton) {
            dismissAlertPopup(dismissButton.getAttribute("data-popup-dismiss"));
            return;
        }

        if (event.target === alertPopupStack) {
            dismissVisibleAlertPopups();
            return;
        }

        await handleAlertActionClick(event);
    }

    async function loadSalesRaw() {
        const { data, error } = await supabaseClient
            .from("sales")
            .select("*, product:products!sales_product_id_fkey(name)")
            .order("created_at", { ascending: false });

        if (error) throw new Error(error.message || "Failed to load sales");
        return data || [];
    }

    async function loadPriceChangeLogsRaw() {
        const { data, error } = await supabaseClient
            .from("price_change_logs")
            .select("*")
            .order("changed_at", { ascending: false });

        if (error) throw new Error(error.message || "Failed to load price change logs");
        return data || [];
    }

    function renderSalesDashboardFromCurrentFilters() {
        const filtered = applySalesFilters(salesReportRows);
        renderSales(filtered);
        renderSalesSummary(filtered);
        renderMetrics(filtered);
        renderCharts(filtered);
        setStatus(salesStatus, `${filtered.length} report record(s).`);
    }

    async function recalculateTodaySalesProfit() {
        const dayKey = todayDateKey();
        setStatus(salesStatus, "Recalculating today's sales profit...");
        if (recalcTodayProfitBtn) recalcTodayProfitBtn.disabled = true;

        try {
            const rpcAttempt = await supabaseClient.rpc("recalculate_today_sales_profit", {
                p_day: dayKey
            });
            if (!rpcAttempt.error) {
                const rpcResult = Array.isArray(rpcAttempt.data) ? rpcAttempt.data[0] : rpcAttempt.data;
                const updatedCount = Math.max(0, Math.floor(toNumber(rpcResult?.updated_count ?? rpcResult?.updated ?? rpcResult, 0)));
                await refreshSalesDashboard(false);
                setStatus(salesStatus, `Updated ${updatedCount} today's sale(s) with the profit formula.`, "success");
                return;
            }

            const salesRows = await loadSalesRaw();
            const todaysRows = salesRows.filter((row) => {
                const status = String(row.status || "").toLowerCase();
                if (status === "returned" || status === "cancelled" || status === "void") return false;
                return toCalendarDateKey(saleDate(row)) === dayKey;
            });

            if (!todaysRows.length) {
                setStatus(salesStatus, "No sales found for today.", "warn");
                return;
            }

            let updated = 0;
            let failed = 0;
            for (const row of todaysRows) {
                if (!row?.id) continue;
                const computedProfit = roundMoney(saleRevenue(row) - saleCost(row));
                const currentProfit = toNumber(row.profit, NaN);
                if (Number.isFinite(currentProfit) && Math.abs(currentProfit - computedProfit) < 0.0001) {
                    continue;
                }

                const { error } = await supabaseClient
                    .from("sales")
                    .update({ profit: computedProfit })
                    .eq("id", row.id);
                if (error) {
                    failed += 1;
                    continue;
                }
                updated += 1;
            }

            await refreshSalesDashboard(false);
            if (updated === 0 && failed === 0) {
                setStatus(salesStatus, "Today's sales were already using selling price minus cost price.", "success");
            } else if (failed > 0 && updated === 0) {
                setStatus(
                    salesStatus,
                    "Could not update today's sales from this browser session. Apply the backend RPC/policy update, then retry.",
                    "error"
                );
            } else if (failed > 0) {
                setStatus(salesStatus, `Updated ${updated} sale(s), but ${failed} row(s) could not be updated.`, "warn");
            } else {
                setStatus(salesStatus, `Updated ${updated} today's sale(s) with the profit formula.`, "success");
            }
        } catch (error) {
            console.error(error);
            setStatus(salesStatus, error.message || "Failed to recalculate today's sales profit.", "error");
        } finally {
            if (recalcTodayProfitBtn) recalcTodayProfitBtn.disabled = false;
        }
    }

    async function refreshSalesDashboard(showLoading = true) {
        if (showLoading) setStatus(salesStatus, "Loading sales...");
        try {
            const salesRows = await loadSalesRaw();
            const priceRows = await loadPriceChangeLogsRaw();
            salesReportRows = createReportEntries(salesRows, priceRows);
            renderSalesDashboardFromCurrentFilters();
        } catch (error) {
            console.error(error);
            setStatus(salesStatus, error.message || "Failed to load sales.", "error");
            salesBody.innerHTML = '<tr><td colspan="9">Failed to load sales records.</td></tr>';
            renderSalesSummary([]);
        }
    }

    function csvCell(value) {
        return `"${String(value ?? "").replace(/"/g, '""')}"`;
    }

    function isAppleMobileDevice() {
        const ua = navigator.userAgent || "";
        const platform = navigator.platform || "";
        const maxTouchPoints = navigator.maxTouchPoints || 0;
        return /iPad|iPhone|iPod/i.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Could not prepare CSV download link."));
            reader.readAsDataURL(blob);
        });
    }

    async function downloadCsv(fileName, content) {
        const csvWithBom = `\uFEFF${content}`;
        const blob = new Blob([csvWithBom], { type: "text/csv;charset=utf-8;" });

        if (typeof File === "function" && navigator?.share && typeof navigator.share === "function") {
            try {
                const csvFile = new File([blob], fileName, { type: "text/csv;charset=utf-8;" });
                if (!navigator.canShare || navigator.canShare({ files: [csvFile] })) {
                    await navigator.share({
                        files: [csvFile],
                        title: fileName,
                        text: "Sales report CSV export"
                    });
                    return "share";
                }
            } catch (error) {
                const aborted = error?.name === "AbortError";
                if (aborted) return "cancelled";
                console.warn("Share API export failed, falling back to direct download.", error);
            }
        }

        if (isAppleMobileDevice()) {
            const dataUrl = await blobToDataUrl(blob);
            const opened = window.open(dataUrl, "_blank");
            if (opened) return "ios_open";

            const link = document.createElement("a");
            link.href = dataUrl;
            link.target = "_blank";
            link.rel = "noopener";
            document.body.appendChild(link);
            link.click();
            link.remove();
            return "ios_link";
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        return "download";
    }

    async function exportSalesCsv() {
        try {
            const salesRows = await loadSalesRaw();
            const priceRows = await loadPriceChangeLogsRaw();
            const filtered = applySalesFilters(createReportEntries(salesRows, priceRows));

            const headers = ["created_at", "entry_type", "product", "details", "quantity", "units_sold", "selling_price", "cost_price", "profit", "status", "sold_by"];
            const lines = [headers.join(",")];
            for (const row of filtered) {
                const out = row.kind === "sale" ? {
                    created_at: row.date,
                    entry_type: "sale",
                    product: row.product,
                    details: row.details,
                    quantity: row.quantity,
                    units_sold: Math.max(1, toNumber(row.raw?.units_sold, toNumber(row.quantity, 1))),
                    selling_price: row.revenue,
                    cost_price: row.cost,
                    profit: row.profit,
                    status: row.status,
                    sold_by: row.raw?.sold_by || ""
                } : {
                    created_at: row.date,
                    entry_type: "price_update",
                    product: row.product,
                    details: row.details,
                    quantity: "",
                    units_sold: "",
                    selling_price: "",
                    cost_price: "",
                    profit: "",
                    status: row.status,
                    sold_by: row.raw?.admin_name || ""
                };
                lines.push(headers.map((h) => csvCell(out[h])).join(","));
            }

            const method = await downloadCsv(`sales-report-${todayDateKey()}.csv`, `${lines.join("\n")}\n`);
            if (method === "cancelled") {
                setStatus(salesStatus, "Export canceled.", "warn");
                return;
            }
            const viaShare = method === "share";
            setStatus(
                salesStatus,
                viaShare
                    ? `Export prepared for sharing with ${filtered.length} report record(s).`
                    : `Exported ${filtered.length} report record(s).`,
                "success"
            );
        } catch (error) {
            console.error(error);
            setStatus(salesStatus, error.message || "Failed to export sales CSV.", "error");
        }
    }

    async function clearFilters(event) {
        if (event?.preventDefault) event.preventDefault();

        if (filterFrom) filterFrom.value = "";
        if (filterTo) filterTo.value = "";
        if (filterProduct) filterProduct.value = "";
        if (filterSaleType) filterSaleType.selectedIndex = 0;

        renderSalesDashboardFromCurrentFilters();
    }

    window.resetSalesFilters = clearFilters;

    function subscribeRealtime() {
        supabaseClient
            .channel("public:admin:products")
            .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => loadInventory())
            .subscribe();

        supabaseClient
            .channel("public:admin:sales")
            .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, () => refreshSalesDashboard(false))
            .subscribe();

        supabaseClient
            .channel("public:admin:price_change_logs")
            .on("postgres_changes", { event: "*", schema: "public", table: "price_change_logs" }, () => refreshSalesDashboard(false))
            .subscribe();

        supabaseClient
            .channel("public:admin:alerts")
            .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, () => refreshAlertViews(false))
            .subscribe();

        supabaseClient
            .channel("public:admin:alert_events")
            .on("postgres_changes", { event: "*", schema: "public", table: "alert_events" }, () => refreshAlertViews(false))
            .subscribe();
    }

    async function init() {
        try {
            supabaseClient = createSupabaseClientOrFail();
        } catch (error) {
            setStatus(formStatus, error.message || "Missing configuration.", "error");
            setStatus(inventoryStatus, "Cannot load inventory without configuration.", "error");
            setStatus(salesStatus, "Cannot load sales without configuration.", "error");
            return;
        }

        const authorized = await requireAuth();
        if (!authorized) return;

        productForm.addEventListener("submit", upsertProductFromForm);
        logoutBtn.addEventListener("click", async () => {
            await supabaseClient.auth.signOut();
            window.location.href = "login.html";
        });
        duplicateAddStockBtn.addEventListener("click", () => processProductForm("add_stock"));
        duplicateEditPriceBtn.addEventListener("click", () => processProductForm("edit_price"));
        duplicateCancelBtn.addEventListener("click", () => {
            resetDuplicateState();
            setStatus(formStatus, "Duplicate action canceled.", "warn");
        });

        exportCsvBtn.addEventListener("click", exportSalesCsv);
        filterFrom.addEventListener("change", renderSalesDashboardFromCurrentFilters);
        filterTo.addEventListener("change", renderSalesDashboardFromCurrentFilters);
        filterProduct.addEventListener("input", renderSalesDashboardFromCurrentFilters);
        filterSaleType.addEventListener("change", renderSalesDashboardFromCurrentFilters);
        if (recalcTodayProfitBtn) recalcTodayProfitBtn.addEventListener("click", recalculateTodaySalesProfit);
        if (inventorySearch) {
            inventorySearch.addEventListener("input", () => {
                inventorySearchTerm = inventorySearch.value.trim();
                rerenderInventoryForSearch();
            });
        }
        if (clearInventorySearchBtn) {
            clearInventorySearchBtn.addEventListener("click", () => {
                inventorySearchTerm = "";
                if (inventorySearch) inventorySearch.value = "";
                rerenderInventoryForSearch();
            });
        }
        if (smartAlerts) smartAlerts.addEventListener("click", handleAlertActionClick);
        if (notificationList) notificationList.addEventListener("click", handleAlertActionClick);
        if (alertPopupStack) alertPopupStack.addEventListener("click", handleAlertPopupClick);

        await loadInventory();
        await refreshSalesDashboard(false);
        subscribeRealtime();

        supabaseClient.auth.onAuthStateChange((event) => {
            if (event === "SIGNED_OUT") {
                window.location.href = "login.html";
            }
        });
    }

    init();
})();
