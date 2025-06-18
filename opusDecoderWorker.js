// opusDecoderWorker.js
// This script runs in a separate child process to ensure a clean Opus decoder state for each batch.

const Opus = require('opusscript'); // Load opusscript in this isolated process
const { parentPort } = require('worker_threads'); // worker_threads for robust IPC

// Listen for messages from the parent (main bot process)
parentPort.on('message', (message) => {
    if (message.type === 'decode_opus_batch') {
        const { opusPackets } = message;

        const pcmChunks = [];
        let decoder = null;

        try {
            // Create a literally fresh Opus decoder for this specific process's batch
            // This is the "full restart" at a process level
            decoder = new Opus(48000, 2); 

            // Decode each Opus packet to PCM
            for (const packet of opusPackets) {
                try {
                    const pcm = decoder.decode(Buffer.from(packet)); // Ensure packet is a Buffer
                    if (pcm && pcm.length > 0) {
                        pcmChunks.push(pcm);
                    }
                } catch (decodeError) {
                    // Log decoding error but attempt to continue with other packets in the batch
                    console.error(`[Opus Worker Error] Failed to decode single Opus packet: ${decodeError.message}`);
                }
            }
            
            // Send back the concatenated PCM buffer (as a base64 string to avoid IPC size limits for large buffers)
            parentPort.postMessage({ type: 'pcm_data', data: Buffer.concat(pcmChunks).toString('base64') });

        } catch (error) {
            console.error(`[Opus Worker Fatal Error] Unhandled exception during Opus decoding batch:`, error);
            parentPort.postMessage({ type: 'error', message: `Fatal Opus decoding error: ${error.message}` });
        } finally {
            if (decoder) {
                decoder.delete(); // Release WASM resources before exiting
            }
            // Exit the worker process to guarantee a full restart for the next decoding request
            process.exit(0); 
        }
    }
});

// Basic error handling for the worker process
process.on('unhandledRejection', (reason, promise) => {
    console.error('[Opus Worker] Unhandled Rejection at:', promise, 'reason:', reason);
    parentPort.postMessage({ type: 'error', message: `Worker Unhandled Rejection: ${reason}` });
    process.exit(1); // Exit with error code
});

process.on('uncaughtException', (err) => {
    console.error('[Opus Worker] Uncaught Exception:', err);
    parentPort.postMessage({ type: 'error', message: `Worker Uncaught Exception: ${err.message}` });
    process.exit(1); // Exit with error code
});

console.log("[Opus Worker] Ready for decoding requests.");
