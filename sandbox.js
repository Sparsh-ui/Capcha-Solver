// sandbox.js - Core OCR Logic
console.log("Sandbox Script Loaded");

// 1. Proxy console logs to parent
function logToParent(type, args) {
    try {
        const msg = args.map(a => {
            if (a instanceof Error) return a.toString() + "\n" + a.stack;
            if (typeof a === 'object') return JSON.stringify(a);
            return String(a);
        }).join(' ');
        window.parent.postMessage({ type: 'SANDBOX_LOG', logType: type, message: msg }, '*');
    } catch (e) { }
}

const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = (...args) => { originalConsoleLog(...args); logToParent('info', args); };
console.error = (...args) => { originalConsoleError(...args); logToParent('error', args); };

window.addEventListener('error', (e) => {
    logToParent('error', ["Uncaught Error:", e.message, e.filename, e.lineno]);
});

// 2. Immediate Alive Check
try {
    window.parent.postMessage({ type: 'SANDBOX_ALIVE' }, '*');
    console.log("Sandbox script loaded and executing.");
} catch (e) {
    console.error("Failed to send ALIVE signal:", e);
}

// 3. OCR Message Listener
window.addEventListener('message', async (event) => {
    const message = event.data;

    if (message.type === 'OCR_REQUEST') {
        try {
            console.log("Sandbox: Received OCR request");
            const text = await solveCaptcha(
                message.imageUrl,
                message.workerBlobUrl,
                message.coreBlobUrl,
                message.langDataBlobUrl
            );
            // Use '*' because sandbox origin is "null" (string)
            event.source.postMessage({ type: 'OCR_SUCCESS', text: text }, '*');
        } catch (error) {
            const errMsg = error ? (error.message || error.toString()) : "Unknown error";
            console.error("Sandbox OCR Error:", errMsg);
            event.source.postMessage({ type: 'OCR_ERROR', message: errMsg }, '*');
        }
    }
});

async function solveCaptcha(imageUrl, workerBlobUrl, coreBlobUrl, langDataBlobUrl) {
    console.log("Sandbox: Starting OCR with pre-fetched resources");

    // Build a custom langPath using the blob URL
    // Tesseract expects langPath + 'eng.traineddata.gz'
    // We override getLanguageData by using workerParams
    console.log("Sandbox: Initializing Worker...");

    const worker = await Tesseract.createWorker('eng', 1, {
        workerPath: workerBlobUrl,
        corePath: coreBlobUrl,
        langPath: langDataBlobUrl,
        // When langPath is a blob URL of the actual traineddata file,
        // Tesseract will try to append 'eng.traineddata.gz' which won't work.
        // Instead, we need to handle this differently.
        gzip: false,
        logger: m => {
            if (m.status) console.log("Tesseract: " + m.status + " " + Math.round((m.progress || 0) * 100) + "%");
        }
    });

    console.log("Sandbox: Recognizing...");
    const { data: { text } } = await worker.recognize(imageUrl);
    await worker.terminate();

    // Revoke blob URLs to free memory
    URL.revokeObjectURL(workerBlobUrl);
    URL.revokeObjectURL(coreBlobUrl);
    URL.revokeObjectURL(langDataBlobUrl);

    const cleanedText = text.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    console.log("Sandbox Result:", cleanedText);
    return cleanedText;
}

// Notify parent we are ready
window.parent.postMessage({ type: 'SANDBOX_READY' }, '*');
