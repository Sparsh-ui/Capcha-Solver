// Background Script
// Handles: Offscreen Document (for OCR)

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
});
