// utils/ffmpegUtils.js

const ffmpeg = require('fluent-ffmpeg');
const path = require('node:path');
const fs = require('node:fs');

// IMPORTANT: Ensure ffmpeg is installed and accessible in your system's PATH.
// On macOS: `brew install ffmpeg`
// On Windows: Download from ffmpeg.org, extract, and add to PATH.
// If you're having issues, you might need to specify the path to your ffmpeg executable:
// ffmpeg.setFfmpegPath('/path/to/your/ffmpeg'); // e.g., '/usr/local/bin/ffmpeg' or 'C:\\ffmpeg\\bin\\ffmpeg.exe'

module.exports = {
    /**
     * Extracts frames from a video file.
     * @param {string} videoPath - The path to the input video file.
     * @param {string} outputPath - The directory where frames will be saved.
     * @param {number} [numFrames=3] - The number of frames to extract.
     * @returns {Promise<Array<string>>} - A promise that resolves with an array of paths to the extracted image files.
     */
    extractFrames: async (videoPath, outputPath, numFrames = 3) => {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(outputPath)) {
                fs.mkdirSync(outputPath, { recursive: true });
            }

            const framePaths = [];
            const framePattern = 'frame-%s.png'; // Frames will be saved as frame-1.png, frame-2.png, etc.

            ffmpeg(videoPath)
                .on('filenames', function(filenames) {
                    console.log('Generated ' + filenames.join(', '));
                    filenames.forEach(filename => {
                        framePaths.push(path.join(outputPath, filename));
                    });
                })
                .on('end', function() {
                    console.log('Finished processing frames');
                    resolve(framePaths);
                })
                .on('error', function(err) {
                    console.error('An error occurred during frame extraction: ' + err.message);
                    reject(err);
                })
                .screenshots({
                    count: numFrames,       // Number of screenshots to take
                    folder: outputPath,     // Output folder
                    filename: framePattern, // Filename pattern
                    size: '640x?'           // Resize frames to 640px width, maintaining aspect ratio
                });
        });
    },

    // You can add other ffmpeg-related utilities here if needed, e.g., for audio transcription
    // transcribeAudio: async (audioPath, outputPath) => { /* ... */ }
};