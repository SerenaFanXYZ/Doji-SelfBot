// utils/fileDownloader.js

const fs = require('node:fs')
const path = require('node:path')
const { pipeline } = require('node:stream/promises') // Import pipeline from stream/promises

class FileDownloader {
    constructor() {
        const tempDir = path.join(__dirname, '..', 'temp')
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir)
        }
    }

    async downloadFile(url, outputPath) {
        try {
            const response = await fetch(url)
            if (!response.ok) {
                throw new Error(`Failed to download file: ${response.statusText}`)
            }

            const fileStream = fs.createWriteStream(outputPath)

            // CORRECTED: Use stream.pipeline to handle piping from Web ReadableStream to Node.js WritableStream
            // This is the most robust way in modern Node.js (v18+).
            await pipeline(response.body, fileStream)

            console.log(`File downloaded to: ${outputPath}`)
            return outputPath
        } catch (error) {
            console.error(`Error downloading file from ${url}:`, error)
            // Ensure file stream is closed and cleaned up in case of error
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath); // Delete partially downloaded file
            }
            throw error
        }
    }
}

module.exports = FileDownloader