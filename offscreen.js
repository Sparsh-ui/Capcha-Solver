// Offscreen Script — Serverless Per-Character CNN CAPTCHA Solver
// Grid removal + character segmentation + CNN inference, all in pure JS
console.log("Offscreen loaded (Serverless CNN mode)");

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const IMG_SIZE = 28;

let modelWeights = null;
let modelReady = false;
let modelLoadPromise = null;

function broadcastLog(msg) {
    chrome.runtime.sendMessage({ target: 'background', type: 'LOG', message: msg });
}
chrome.runtime.sendMessage({ target: 'background', type: 'OFFSCREEN_READY' });

// ============================================================
// MODEL LOADING (from model_weights.json)
// ============================================================
async function loadModel() {
    try {
        console.log("Loading model weights...");
        const url = chrome.runtime.getURL('model_weights.json');
        console.log("Fetching:", url);
        const response = await fetch(url);
        if (!response.ok) throw new Error("Fetch failed: " + response.status);
        const data = await response.json();
        console.log("JSON parsed, layers:", data.layers.length);

        modelWeights = {};
        for (const layer of data.layers) {
            const name = layer.name;
            const shape = layer.kernel_shape;
            const kernelFlat = layer.kernel;
            const bias = new Float32Array(layer.bias);
            console.log(`  Layer ${name} (${layer.type}): shape=${JSON.stringify(shape)}, kernel_len=${kernelFlat.length}, bias_len=${bias.length}`);

            if (layer.type === 'Conv2D') {
                // kernel_shape: [H, W, In, Out]
                // numpy.flatten() is row-major: H→W→In→Out
                const [kH, kW, kIn, kOut] = shape;
                const kernel = new Float32Array(kernelFlat);
                modelWeights[name] = { kernel, bias, kH, kW, kIn, kOut };
            } else if (layer.type === 'Dense') {
                // kernel_shape: [In, Out]
                const [kIn, kOut] = shape;
                const kernel = new Float32Array(kernelFlat);
                modelWeights[name] = { kernel, bias, kIn, kOut };
            }
        }

        modelReady = true;
        console.log("Model loaded successfully:", Object.keys(modelWeights));
    } catch (e) {
        console.error("Model load error:", e);
        broadcastLog("Model Error: " + e.message);
    }
}
modelLoadPromise = loadModel();

// ============================================================
// CNN OPERATIONS (flat array based — no nested arrays)
// ============================================================

// Conv2D with 'valid' padding (no padding) and ReLU
// input: Float32Array, stored row-major [H*W*C]
function conv2dValid(input, H, W, C, layer) {
    const { kernel, bias, kH, kW, kIn, kOut } = layer;
    const outH = H - kH + 1;
    const outW = W - kW + 1;
    const output = new Float32Array(outH * outW * kOut);

    for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
            const outBase = (y * outW + x) * kOut;
            for (let ky = 0; ky < kH; ky++) {
                const iy = y + ky;
                for (let kx = 0; kx < kW; kx++) {
                    const ix = x + kx;
                    const inBase = (iy * W + ix) * C;
                    const kernelBase = (ky * kW + kx) * kIn;
                    for (let c = 0; c < C; c++) {
                        const inVal = input[inBase + c];
                        if (inVal === 0) continue;
                        const kBase2 = (kernelBase + c) * kOut;
                        for (let o = 0; o < kOut; o++) {
                            output[outBase + o] += inVal * kernel[kBase2 + o];
                        }
                    }
                }
            }
            // Add bias + ReLU
            for (let o = 0; o < kOut; o++) {
                const idx = outBase + o;
                output[idx] += bias[o];
                if (output[idx] < 0) output[idx] = 0;
            }
        }
    }
    return { data: output, H: outH, W: outW };
}

// MaxPool 2x2: halves H and W
function maxPool2d(input, H, W, C) {
    const outH = Math.floor(H / 2);
    const outW = Math.floor(W / 2);
    const output = new Float32Array(outH * outW * C);

    for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
            const outBase = (y * outW + x) * C;
            const y2 = y * 2, x2 = x * 2;
            const i00 = (y2 * W + x2) * C;
            const i01 = (y2 * W + x2 + 1) * C;
            const i10 = ((y2 + 1) * W + x2) * C;
            const i11 = ((y2 + 1) * W + x2 + 1) * C;
            for (let c = 0; c < C; c++) {
                output[outBase + c] = Math.max(
                    input[i00 + c], input[i01 + c],
                    input[i10 + c], input[i11 + c]
                );
            }
        }
    }
    return { data: output, H: outH, W: outW };
}

// Dense layer with optional ReLU
function dense(input, layer, relu) {
    const { kernel, bias, kIn, kOut } = layer;
    const output = new Float32Array(kOut);

    for (let i = 0; i < kIn; i++) {
        if (input[i] === 0) continue;
        const base = i * kOut;
        for (let o = 0; o < kOut; o++) {
            output[o] += input[i] * kernel[base + o];
        }
    }
    for (let o = 0; o < kOut; o++) {
        output[o] += bias[o];
        if (relu && output[o] < 0) output[o] = 0;
    }
    return output;
}

// Classify a single 28x28 character image
// charImg: Float32Array(784), text=1.0, bg=0.0
function classifyChar(charImg) {
    // Conv1(valid): 28x28x1 -> 26x26x32
    let c1 = conv2dValid(charImg, 28, 28, 1, modelWeights.conv1);
    // Pool: 26x26x32 -> 13x13x32
    let p1 = maxPool2d(c1.data, c1.H, c1.W, 32);
    // Conv2(valid): 13x13x32 -> 11x11x64
    let c2 = conv2dValid(p1.data, p1.H, p1.W, 32, modelWeights.conv2);
    // Pool: 11x11x64 -> 5x5x64 (11/2 = 5)
    let p2 = maxPool2d(c2.data, c2.H, c2.W, 64);
    // Flatten: 5*5*64 = 1600
    let flat = p2.data;

    // Dense1: 1600 -> 128 (relu)
    let d1 = dense(flat, modelWeights.dense1, true);
    // Output: 128 -> 36 (no relu, use argmax)
    let logits = dense(d1, modelWeights.output, false);

    // Argmax
    let maxVal = -Infinity, maxIdx = 0;
    for (let i = 0; i < logits.length; i++) {
        if (logits[i] > maxVal) { maxVal = logits[i]; maxIdx = i; }
    }
    return CHARS[maxIdx];
}

// ============================================================
// GRID REMOVAL (HSV color analysis)
// ============================================================
function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    const s = max === 0 ? 0 : d / max;
    let h = 0;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return [h * 180, s * 255, max * 255];
}

function removeGrid(imageData, width, height) {
    const data = imageData.data;
    const mask = new Uint8Array(width * height).fill(255);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const [h, s, v] = rgbToHsv(r, g, b);
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;

            const isRed = ((h <= 15) || (h >= 165)) && s > 40 && v > 40;
            const isSaturated = s > 50;
            const isDark = gray < 60;

            if (isRed || isSaturated || isDark) {
                mask[y * width + x] = 0;
            }
        }
    }

    // Denoise: remove isolated pixels
    const cleaned = new Uint8Array(mask);
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            if (mask[idx] === 0) {
                let neighbors = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dy === 0 && dx === 0) continue;
                        if (mask[(y + dy) * width + (x + dx)] === 0) neighbors++;
                    }
                }
                if (neighbors < 1) cleaned[idx] = 255;
            }
        }
    }
    return cleaned;
}

// ============================================================
// CHARACTER SEGMENTATION
// ============================================================
function segmentCharacters(binaryMask, width, height, numChars = 6) {
    let top = height, bottom = 0, left = width, right = 0;
    let hasText = false;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (binaryMask[y * width + x] === 0) {
                hasText = true;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
                if (x < left) left = x;
                if (x > right) right = x;
            }
        }
    }
    if (!hasText) return [];

    const textWidth = right - left + 1;
    const charWidth = textWidth / numChars;
    const charImages = [];

    for (let i = 0; i < numChars; i++) {
        const xStart = Math.floor(left + charWidth * i);
        const xEnd = Math.floor(left + charWidth * (i + 1));
        const stripW = xEnd - xStart;
        const stripH = bottom - top + 1;

        let cy1 = stripH, cy2 = 0, cx1 = stripW, cx2 = 0;
        let charHasPixels = false;
        for (let y = 0; y < stripH; y++) {
            for (let x = 0; x < stripW; x++) {
                if (binaryMask[(top + y) * width + (xStart + x)] === 0) {
                    charHasPixels = true;
                    if (y < cy1) cy1 = y;
                    if (y > cy2) cy2 = y;
                    if (x < cx1) cx1 = x;
                    if (x > cx2) cx2 = x;
                }
            }
        }

        if (!charHasPixels) {
            charImages.push(new Float32Array(IMG_SIZE * IMG_SIZE));
            continue;
        }

        const cropW = cx2 - cx1 + 1;
        const cropH = cy2 - cy1 + 1;
        const crop = new Uint8Array(cropW * cropH);
        for (let y = 0; y < cropH; y++) {
            for (let x = 0; x < cropW; x++) {
                crop[y * cropW + x] = binaryMask[(top + cy1 + y) * width + (xStart + cx1 + x)];
            }
        }

        const targetSize = 22;
        const scale = Math.min(targetSize / cropW, targetSize / cropH);
        const newW = Math.max(1, Math.round(cropW * scale));
        const newH = Math.max(1, Math.round(cropH * scale));

        const resized = new Uint8Array(newW * newH);
        for (let y = 0; y < newH; y++) {
            for (let x = 0; x < newW; x++) {
                const srcX = Math.min(Math.floor(x / scale), cropW - 1);
                const srcY = Math.min(Math.floor(y / scale), cropH - 1);
                resized[y * newW + x] = crop[srcY * cropW + srcX];
            }
        }

        const canvas28 = new Uint8Array(IMG_SIZE * IMG_SIZE).fill(255);
        const xOff = Math.floor((IMG_SIZE - newW) / 2);
        const yOff = Math.floor((IMG_SIZE - newH) / 2);
        for (let y = 0; y < newH; y++) {
            for (let x = 0; x < newW; x++) {
                canvas28[(yOff + y) * IMG_SIZE + (xOff + x)] = resized[y * newW + x];
            }
        }

        const normalized = new Float32Array(IMG_SIZE * IMG_SIZE);
        for (let j = 0; j < IMG_SIZE * IMG_SIZE; j++) {
            normalized[j] = 1.0 - (canvas28[j] / 255.0);
        }
        charImages.push(normalized);
    }
    return charImages;
}

// ============================================================
// MAIN SOLVE
// ============================================================
async function solve(imgUrl) {
    // Wait for model to be ready
    if (!modelReady) {
        console.log("Waiting for model to load...");
        await modelLoadPromise;
        if (!modelReady) throw new Error("Model failed to load");
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = imgUrl;
    });

    const t0 = performance.now();

    const canvas = document.createElement('canvas');
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);

    // Grid removal
    const binaryMask = removeGrid(imageData, w, h);
    console.log(`Image: ${w}x${h}, grid removed`);

    // Segment characters
    const charImages = segmentCharacters(binaryMask, w, h, 6);
    if (charImages.length === 0) throw new Error("No characters found");
    console.log(`Segmented ${charImages.length} characters`);

    // Classify each
    let result = "";
    for (let i = 0; i < charImages.length; i++) {
        result += classifyChar(charImages[i]);
    }

    const t1 = performance.now();
    console.log(`Solved in ${(t1 - t0).toFixed(0)}ms: ${result}`);
    return result;
}

// ============================================================
// MESSAGE HANDLER
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'offscreen') return;
    if (message.type === 'OCR') {
        solve(message.imageUrl)
            .then(text => chrome.runtime.sendMessage({
                target: 'background', type: 'OCR_RESULT', success: true, text: text
            }))
            .catch(e => {
                console.error("OCR Error:", e);
                chrome.runtime.sendMessage({
                    target: 'background', type: 'OCR_RESULT', success: false, message: e.message
                });
            });
        sendResponse({ status: 'processing' });
    }
});
