// Content Script — CAPTCHA Solver + Auto-Labeling
// Features: OCR solve, auto-fill, auto-save labeled CAPTCHAs on successful submit

// ===========================================
// VISUAL STATUS & FEEDBACK
// ===========================================
function showStatus(msg, isError = false) {
    let box = document.getElementById('vtop-extension-status');
    if (!box) {
        box = document.createElement('div');
        box.id = 'vtop-extension-status';
        box.style.cssText = `
            position: fixed;
            bottom: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: #0f0;
            font-family: monospace;
            font-size: 14px;
            padding: 8px 12px;
            border-radius: 6px;
            z-index: 100000;
            pointer-events: none;
            transition: opacity 0.5s;
        `;
        document.body.appendChild(box);
    }
    box.style.color = isError ? '#ff4444' : '#00ff00';
    box.innerText = msg;
    box.style.opacity = '1';

    if (msg.includes("Filled") || msg.includes("Saved") || msg.includes("✅")) {
        setTimeout(() => box.style.opacity = '0', 5000);
    }
}

// ===========================================
// SAFE INPUT SETTER
// ===========================================
function setNativeValue(element, value) {
    try {
        const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        valueSetter.call(element, value);
    } catch (e) {
        element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
}

// ===========================================
// CAPTCHA IMAGE SNAPSHOT
// ===========================================
function snapshotImage(img) {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        if (canvas.width === 0) return null;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return canvas.toDataURL('image/png');
    } catch (e) {
        return null;
    }
}

// ===========================================
// AUTO-LABELING STATE
// ===========================================
let lastCaptchaDataUrl = null;  // Snapshot of current CAPTCHA image
let lastCaptchaText = null;     // Text we/user entered in the CAPTCHA field

function getCaptchaInput() {
    return document.querySelector('input[name="captchaCheck"]') ||
        document.getElementById('captchaCheck') ||
        document.getElementById('vtopCaptcha') ||
        document.querySelector('input[placeholder="Enter CAPTCHA shown above"]');
}

function getCaptchaImage() {
    return document.querySelector('#captchaBlock img');
}

// ===========================================
// AUTO-LABEL: Stash data in background, save on navigation
// ===========================================
function setupAutoLabel() {
    // Watch for CAPTCHA image changes (reload)
    watchCaptchaReload();
}

function stashCaptcha(dataUrl, text) {
    if (dataUrl && text && text.length === 6) {
        chrome.runtime.sendMessage({
            type: 'STASH_CAPTCHA',
            dataUrl: dataUrl,
            prediction: text
        });
        // console.log(`[AutoLabel] Stashed: ${text}`);
    }
}

// captureBeforeSubmit and onPageNavigated are removed as per instructions.

function saveLabeledCaptcha(dataUrl, label) {
    chrome.runtime.sendMessage({
        type: 'SAVE_LABELED_CAPTCHA',
        dataUrl: dataUrl,
        label: label
    });
}

// ===========================================
// WATCH FOR CAPTCHA RELOAD
// ===========================================
function watchCaptchaReload() {
    const captchaImage = getCaptchaImage();
    if (!captchaImage) return;

    let lastSrc = captchaImage.src;

    // Watch for src changes using MutationObserver
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.attributeName === 'src' && captchaImage.src !== lastSrc) {
                lastSrc = captchaImage.src;
                console.log("[AutoLabel] CAPTCHA reloaded, auto-solving...");
                // Wait for image to load, then solve
                if (captchaImage.complete && captchaImage.naturalWidth > 0) {
                    setTimeout(solveCaptcha, 200);
                } else {
                    captchaImage.onload = () => setTimeout(solveCaptcha, 200);
                }
            }
        }
    });
    observer.observe(captchaImage, { attributes: true, attributeFilter: ['src'] });
}

// ===========================================
// DOWNLOAD BUTTON (manual save)
// ===========================================
function injectDownloadButton(captchaImage) {
    // Remove old button if it exists (may be stale after CAPTCHA reload)
    const old = document.getElementById('vtop-extension-dl-btn');
    if (old) old.remove();

    const btn = document.createElement('button');
    btn.id = 'vtop-extension-dl-btn';
    btn.innerText = '⬇️ Save';
    btn.style.cssText = `
        margin-left: 8px;
        padding: 4px 8px;
        background: #28a745;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        z-index: 99999;
        vertical-align: middle;
    `;
    btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dataUrl = snapshotImage(captchaImage);
        if (dataUrl) {
            chrome.runtime.sendMessage({ type: 'DOWNLOAD_IMAGE', dataUrl: dataUrl });
            btn.innerText = '✅ Saved';
            setTimeout(() => btn.innerText = '⬇️ Save', 1000);
        }
    };
    if (captchaImage && captchaImage.parentNode) {
        captchaImage.parentNode.insertBefore(btn, captchaImage.nextSibling);
    }
}

// ===========================================
// MAIN SOLVER
// ===========================================
async function solveCaptcha() {
    const captchaImage = getCaptchaImage();
    if (!captchaImage) return;

    if (!captchaImage.complete || captchaImage.naturalWidth === 0) {
        await new Promise(r => captchaImage.onload = r);
    }

    injectDownloadButton(captchaImage);
    showStatus("Solving...");

    const dataUrl = snapshotImage(captchaImage);
    if (!dataUrl) return;

    try {
        chrome.runtime.sendMessage({
            target: "background",
            type: "OCR",
            imageUrl: dataUrl
        });
    } catch (error) {
        console.error(error);
    }
}

// ===========================================
// MESSAGE LISTENER
// ===========================================
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === "solve_captcha") {
        solveCaptcha();
        sendResponse({ status: "started" });
    }

    if (request.type === "OCR_RESULT") {
        if (request.success && request.text) {
            const text = request.text;
            const inputField = getCaptchaInput();

            if (inputField) {
                setNativeValue(inputField, text);
                showStatus("✅ Filled: " + text);

                // Capture immediately and stash
                const captchaImage = getCaptchaImage();
                if (captchaImage) {
                    const dataUrl = snapshotImage(captchaImage);
                    stashCaptcha(dataUrl, text);

                    // Listen for user corrections
                    inputField.addEventListener('input', (e) => {
                        const newText = e.target.value.trim().toUpperCase();
                        stashCaptcha(dataUrl, newText);
                    });
                }
            } else {
                showStatus("❌ Input not found", true);
            }
        } else {
            showStatus("❌ OCR Failed: " + (request.message || "Unknown"), true);
        }
    }
});

// ===========================================
// INIT
// ===========================================
if (window.location.href.includes("vtop") || window.location.href.includes("test_captcha")) {
    // Setup auto-labeling
    setupAutoLabel();

    // Auto-solve
    if (document.readyState === 'complete') {
        setTimeout(solveCaptcha, 1000);
    } else {
        window.addEventListener('load', () => setTimeout(solveCaptcha, 1000));
    }
}
