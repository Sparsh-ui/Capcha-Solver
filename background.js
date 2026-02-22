// Background Script
// Handles: Offscreen Document (for OCR), Downloads, Auto-Labeled CAPTCHA saves

// 1. Ensure Offscreen Document exists (for OCR)
async function ensureOffscreenDocument() {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['BLOBS'],
        justification: 'OCR'
    });
}
chrome.runtime.onStartup.addListener(ensureOffscreenDocument);
chrome.runtime.onInstalled.addListener(ensureOffscreenDocument);
ensureOffscreenDocument();

// HELPER: Sanitize filenames for Windows
function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]/g, '_').trim(); // Replace illegal chars with underscore
}

// 2. Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // A. OCR Request from Content -> Proxy to Offscreen
    if (message.type === 'OCR') {
        ensureOffscreenDocument().then(() => {
            chrome.runtime.sendMessage({
                target: 'offscreen',
                type: 'OCR',
                imageUrl: message.imageUrl
            });
        });
        sendResponse({ status: 'processing' });
        return true;
    }

    // B. OCR Result from Offscreen -> Broadcast to Content
    if (message.type === 'OCR_RESULT') {
        chrome.tabs.query({}, (tabs) => {
            for (let tab of tabs) {
                chrome.tabs.sendMessage(tab.id, message).catch(() => { });
            }
        });
    }

    // C. Log from Offscreen -> Broadcast to Content
    if (message.type === 'LOG') {
        chrome.tabs.query({}, (tabs) => {
            for (let tab of tabs) {
                chrome.tabs.sendMessage(tab.id, message).catch(() => { });
            }
        });
    }

    // D. Save Labeled CAPTCHA (Auto-Label on successful login)
    if (message.type === 'SAVE_LABELED_CAPTCHA') {
        const label = sanitizeFilename(message.label.toUpperCase());
        const timestamp = new Date().getTime();
        chrome.downloads.download({
            url: message.dataUrl,
            filename: `vtop_captchas/${label}_${timestamp}.png`,
            saveAs: false
        }, (id) => {
            if (chrome.runtime.lastError) {
                console.error("Save failed:", chrome.runtime.lastError);
            } else {
                console.log(`[AutoLabel] Saved: ${label}_${timestamp}.png (download #${id})`);
            }
        });
        sendResponse({ status: 'saving' });
    }

    // E. Stash Captcha (Store in background, wait for navigation)
    if (message.type === 'STASH_CAPTCHA') {
        captchaStash[sender.tab.id] = {
            dataUrl: message.dataUrl,
            prediction: sanitizeFilename(message.prediction.toUpperCase()),
            timestamp: new Date().getTime(),
            originUrl: sender.url
        };
        console.log(`[Background] Stashed CAPTCHA for tab ${sender.tab.id}: ${message.prediction}`);
        sendResponse({ status: 'stashed' });
    }

    // F. Manual Download Image (Data Collection Mode)
    if (message.type === 'DOWNLOAD_IMAGE') {
        const timestamp = new Date().getTime();
        chrome.downloads.download({
            url: message.dataUrl,
            filename: 'vtop_captchas/captcha_' + timestamp + '.png',
            saveAs: false
        }, (id) => {
            if (chrome.runtime.lastError) {
                console.error("Download failed:", chrome.runtime.lastError);
            } else {
                console.log("Download started, ID:", id);
            }
        });
        sendResponse({ status: 'downloading' });
    }
});

// 3. Navigation Listener (The "Save on Success" Trigger)
// Monitors tab updates. If a tab with stashed data changes URL, it's a login!
// We save the data then.
const captchaStash = {};

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only act when loading completes (to ensure URL is final)
    if (changeInfo.status === 'complete' && captchaStash[tabId]) {
        const stash = captchaStash[tabId];

        // Check if URL changed (Login Success usually changes URL)
        // Or if it's just a different page than where we captured it
        if (tab.url !== stash.originUrl) {
            console.log(`[Background] Navigation detected (Tab ${tabId}). Saving stashed CAPTCHA.`);

            // Just use the filename here, onDeterminingFilename will handle the folder!
            const filename = `PRED_${stash.prediction}_${stash.timestamp}.png`;

            chrome.downloads.download({
                url: stash.dataUrl,
                filename: 'vtop_captchas/' + filename, // Explicitly put in folder here too for safety
                saveAs: false
            }, (id) => {
                if (chrome.runtime.lastError) {
                    console.error("Save failed:", chrome.runtime.lastError);
                } else {
                    console.log(`[AutoLabel] Saved: ${filename}`);
                }
            });

            // Clear stash after saving
            delete captchaStash[tabId];
        }
    }
});

// 4. Force Folder Organization
// This listener intercepts the download and ensures it goes into 'vtop_captchas/'
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    if (item.byExtensionId === chrome.runtime.id) {
        // Strip any existing path just in case
        let cleanName = item.filename.split(/[/\\]/).pop();

        // FAILSAFE: If the browser defaults to "download.png", rename it!
        if (cleanName.match(/^download(\s*\(\d+\))?\.png$/i) || cleanName === 'download.png') {
            const timestamp = new Date().getTime();
            cleanName = `fallback_${timestamp}.png`;
        }

        suggest({
            filename: 'vtop_captchas/' + cleanName,
            conflictAction: 'uniquify'
        });
    }
});

// Clean up stash on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
    if (captchaStash[tabId]) delete captchaStash[tabId];
});
