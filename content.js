// Content Script — CAPTCHA Solver
// Features: OCR solve, auto-fill

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
// WATCH FOR CAPTCHA RELOAD (auto re-solve)
// ===========================================
function watchCaptchaReload() {
    const captchaImage = getCaptchaImage();
    if (!captchaImage) return;

    let lastSrc = captchaImage.src;
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.attributeName === 'src' && captchaImage.src !== lastSrc) {
                lastSrc = captchaImage.src;
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
// MAIN SOLVER
// ===========================================
async function solveCaptcha() {
    const captchaImage = getCaptchaImage();
    if (!captchaImage) return;

    if (!captchaImage.complete || captchaImage.naturalWidth === 0) {
        await new Promise(r => captchaImage.onload = r);
    }

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
            const inputField = getCaptchaInput();
            if (inputField) {
                setNativeValue(inputField, request.text);
                showStatus("✅ Filled: " + request.text);
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
    // Watch for CAPTCHA reload to auto-re-solve
    watchCaptchaReload();

    // Auto-solve on page load
    if (document.readyState === 'complete') {
        setTimeout(solveCaptcha, 1000);
    } else {
        window.addEventListener('load', () => setTimeout(solveCaptcha, 1000));
    }
}
