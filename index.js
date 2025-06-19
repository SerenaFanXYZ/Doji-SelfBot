require('dotenv').config()
const { Client } = require('discord.js-selfbot-v13')
const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const path = require('node:path')
const GeminiHandler = require('./utils/geminiHandler')
const ConversationManager = require('./utils/conversationManager')
const FileDownloader = require('./utils/fileDownloader')
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const child_process = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { Worker } = require('worker_threads');
const moment = require('moment-timezone');

const client = new Client({
    checkUpdate: false,
})

// --- Persistence File Paths ---
const DATA_DIR = path.join(__dirname, 'data');
const PERSONALITIES_FILE = path.join(DATA_DIR, 'personalities.json');
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversations.json');
const USER_PROFILES_FILE = path.join(DATA_DIR, 'user_profiles.json'); // New file for user profiles
// --- End Persistence File Paths ---

// --- Personality Configuration ---
// Map to store current personality for each conversation context (channelId or userId)
const currentPersonalities = new Map();

// Define available personalities and their associated files and confirmation messages
const PERSONALITIES = {
    'doji': {
        name: 'Doji',
        files: {
            personality: 'doji_personality.txt',
            characterInfo: 'doji_characterInfo.txt',
            prompt: 'doji_prompt.txt',
        },
        confirmation: "yo wsg doji here", // Updated confirmation
    },
    'whimsy': {
        name: 'Whimsy',
        files: {
            personality: 'whimsy_personality.txt',
            characterInfo: 'whimsy_characterInfo.txt',
            prompt: 'whimsy_prompt.txt',
        },
        confirmation: "Hey there fam! What's poppin'? :smile::wave: How can I make your day a little more fabulous? :rainbow::tada:", // Updated confirmation
    },
    'sandbox': {
        name: 'Sandbox',
        files: {
            personality: 'sandbox_personality.txt',
            characterInfo: 'sandbox_characterInfo.txt',
            prompt: 'sandbox_prompt.txt',
        },
        confirmation: "doji schizophrenia activated", // Updated confirmation
    },
    'serena': { // New Serena personality
        name: 'Serena',
        files: {
            personality: 'serena_personality.txt',
            characterInfo: 'serena_characterInfo.txt',
            prompt: 'serena_prompt.txt',
        },
        confirmation: "serena power activated!!!",
    },
};
const DEFAULT_PERSONALITY = 'doji'; // The default personality when no specific one is set

/**
 * Loads system instructions for a given personality.
 * If personality files are not found, it falls back to the default.
 * @param {string} personalityName The name of the personality to load.
 * @returns {string} The combined system instructions.
 */
function loadSystemInstructions(personalityName) {
    const persona = PERSONALITIES[personalityName];
    if (!persona) {
        console.warn(`Personality "${personalityName}" not found. Loading default.`);
        return loadSystemInstructions(DEFAULT_PERSONALITY); // Recursive call for default
    }
    try {
        const personalityContent = fs.readFileSync(path.join(__dirname, 'config', persona.files.personality), 'utf8');
        const characterInfoContent = fs.readFileSync(path.join(__dirname, 'config', persona.files.characterInfo), 'utf8');
        const promptInstructionsContent = fs.readFileSync(path.join(__dirname, 'config', persona.files.prompt), 'utf8');

        return `
${personalityContent}

${characterInfoContent}

${promptInstructionsContent}
        `;
    } catch (error) {
        console.error(`Error loading files for personality "${personalityName}":`, error.message);
        // Fallback to default if files for a specific personality are missing
        if (personalityName !== DEFAULT_PERSONALITY) {
            console.warn(`Falling back to default personality "${DEFAULT_PERSONALITY}".`);
            return loadSystemInstructions(DEFAULT_PERSONALITY);
        }
        throw new Error(`Critical: Could not load default personality files. ${error.message}`);
    }
}
// --- End Personality Configuration ---


const geminiHandler = new GeminiHandler([
    process.env.GOOGLE_API_KEY_1,
    process.env.GOOGLE_API_KEY_2,
    process.env.GOOGLE_API_KEY_3,
    "AIzaSyCSh92XF4t1K6ZfbUaOIQw-yL0fuxw0m1w", // Added API Key 1
    "AIzaSyDP4gYmSQVyQkQCfJn8ejyjRZlITSNv10E"  // Added API Key 2
].filter(Boolean)) // Filter out any undefined or null keys
// Initialize ConversationManager with its persistence file path and user profiles path
const conversationManager = new ConversationManager(CONVERSATIONS_FILE, USER_PROFILES_FILE);

const fileDownloader = new FileDownloader()

const channelMessageCounts = new Map()
const lastMessageTimestamps = new Map();
const USER_MESSAGE_COOLDOWN_MS = 3000;

const SUPPORTED_MIME_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff', 'image/x-icon', 'image/heic', 'image/heif',
    'video/mp4', 'video/mpeg', 'video/webm', 'video/quicktime', 'video/x-flv', 'video/x-msvideo', 'video/3gpp',
    'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/flac', 'audio/opus', 'audio/x-m4a', 'audio/webm',
];

const BOT_RESPONSE_REACTION_CHANCE = 0.05;
const GENERAL_MESSAGE_REACTION_CHANCE = 0.0001;
const REACTION_RESPONSE_CHANCE = 0.20;
const REACTION_EMOJIS = ['👍', '❤️', '😂', '🤔', '✨', '💯', '👀', '🚀', '🎉', '🤩', '🔥', '✅', '🤯', '🤩'];

const READ_DELAY_MS = 2000;
const TYPING_DURATION_MS = 3000;

const TARGET_GUILD_IDS = ['969279086792937503', '1369357818657902723'];
const VC_JOIN_CHANCE = 0.05;
const VC_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const ALONE_LEAVE_DELAY_MS = 30000;

const userAudioBuffers = new Map();
const MIN_PCM_BUFFER_LENGTH = 48000 * 2 * 2 * 3;

// --- Dynamic Activity Status Configuration ---
const PLAYING_ACTIVITIES = [
    "Terraria",
    "Stardew Valley",
    "Minecraft",
    "Roblox",
    "Hearts Of Iron IV"
];

/**
 * Sets a random "Playing" activity for the bot and schedules the next update.
 */
function setRandomActivity() {
    const randomIndex = Math.floor(Math.random() * PLAYING_ACTIVITIES.length);
    const activityName = PLAYING_ACTIVITIES[randomIndex];

    // Set the activity - remove .then() and .catch() as setActivity is synchronous in discord.js-selfbot-v13
    client.user.setActivity(activityName, { type: 'PLAYING' });
    console.log(`[Activity] Set activity to: ${activityName}`);

    // Schedule the next activity change for a random duration between 15 minutes and 1 hour
    const minDurationMs = 15 * 60 * 1000; // 15 minutes
    const maxDurationMs = 60 * 60 * 1000; // 1 hour
    const nextChangeIn = Math.floor(Math.random() * (maxDurationMs - minDurationMs + 1)) + minDurationMs;

    setTimeout(setRandomActivity, nextChangeIn);
    console.log(`[Activity] Next activity change scheduled in ${Math.round(nextChangeIn / 60000)} minutes.`);
}
// --- End Dynamic Activity Status Configuration ---


/**
 * Sends a textual response to the most suitable text channel in the guild.
 *
 * @param {string} guildId The ID of the guild where the message should be sent.
 * @param {string} textToSend The text response from Gemini.
 */
async function sendResponseToTextChannel(guildId, textToSend) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        console.warn(`[Text Response] Guild ${guildId} not found. Cannot send text response.`);
        return;
    }

    // Find a suitable text channel to send the message
    // Using numeric value for GuildText
    const targetChannel = guild.channels.cache.find(
        c => c.type === 0 /* ChannelType.GuildText */ && c.permissionsFor(guild.members.me).has('SEND_MESSAGES')
    );

    if (targetChannel) {
        console.log(`[Text Response] Sending Gemini response to text channel ${targetChannel.name} in guild ${guildId}: "${textToSend.substring(0, Math.min(textToSend.length, 50))}..."`);
        try {
            await targetChannel.send(textToSend);
        } catch (error) {
            console.error(`[Text Response Error] Failed to send text response to channel ${targetChannel.name}:`, error.message);
        }
    } else {
        console.warn(`[Text Response] No suitable text channel found to send response in guild ${guildId}.`);
    }
}


/**
 * Processes a chunk of audio from a user (which is now PCM), converts it to WebM (Opus),
 * and sends it to Gemini for transcription/understanding.
 *
 * @param {import('buffer').Buffer} pcmAudioBuffer The buffered audio data (PCM).
 * @param {string} userId The ID of the user speaking.
 * @param {string} guildId The ID of the guild where the user is speaking.
 * @returns {Promise<string|null>} Transcribed text from Gemini or null.
 */
async function processAudioChunkForSTT(pcmAudioBuffer, userId, guildId) {
    if (pcmAudioBuffer.length === 0) return null;

    console.log(`[STT] Processing buffered PCM audio for user ${userId} (${pcmAudioBuffer.length} bytes).`);

    return new Promise((resolve, reject) => {
        const expectedFrameSize = 4;
        const remainder = pcmAudioBuffer.length % expectedFrameSize;
        let processedPcmBuffer = pcmAudioBuffer;
        if (remainder !== 0) {
            processedPcmBuffer = pcmAudioBuffer.subarray(0, pcmAudioBuffer.length - remainder);
            if (remainder > 0) {
                console.warn(`[FFmpeg Prep] Trimmed ${remainder} bytes from PCM buffer to ensure complete frames for user ${userId}.`);
            }
        }

        if (processedPcmBuffer.length < expectedFrameSize) {
            console.warn(`[FFmpeg Prep] Audio buffer too small (${processedPcmBuffer.length} bytes) after trimming for user ${userId}. Skipping.`);
            return resolve(null);
        }

        const finalPcmBuffer = Buffer.from(processedPcmBuffer);

        const ffmpegProcess = child_process.spawn(ffmpeg, [
            '-hide_banner',
            '-loglevel', 'error',

            '-f', 's16le',
            '-ar', '48000',
            '-ac', '2',
            '-i', 'pipe:0',

            '-c:a', 'libopus',
            '-vbr', 'on',
            '-compression_level', '10',
            '-application', 'audio',
            '-f', 'webm',
            'pipe:1'
        ], { stdio: ['pipe', 'pipe', 'pipe'] });

        ffmpegProcess.stdin.write(finalPcmBuffer);
        ffmpegProcess.stdin.end();

        const webmChunks = [];
        ffmpegProcess.stdout.on('data', chunk => webmChunks.push(chunk));
        ffmpegProcess.stderr.on('data', data => console.error(`[FFmpeg Error] ${data.toString()}`));

        ffmpegProcess.on('close', async (code) => {
            if (code !== 0) {
                console.error(`[FFmpeg] FFmpeg process exited with code ${code} for user ${userId}.`);
                return reject(new Error(`FFmpeg conversion failed with code ${code}`));
            }
            const webmAudioBuffer = Buffer.concat(webmChunks);
            if (webmAudioBuffer.length === 0) {
                console.warn(`[STT] FFmpeg produced no output for user ${userId}.`);
                return resolve(null);
            }

            const debugAudioDir = path.join(__dirname, 'debug_audio');
            try {
                await fsPromises.mkdir(debugAudioDir, { recursive: true });
                const timestamp = Date.now();
                const debugFilePath = path.join(debugAudioDir, `user_${userId}_${timestamp}.webm`);
                await fsPromises.writeFile(debugFilePath, webmAudioBuffer);
                console.log(`[DEBUG] Saved WebM audio to: ${debugFilePath}`);
            } catch (fileError) {
                console.error(`[DEBUG ERROR] Failed to save debug audio file: ${fileError.message}`);
            }

            const base64Audio = webmAudioBuffer.toString('base64');

            try {
                const geminiContent = [{
                    role: 'user',
                    parts: [
                        { text: `Transcribe the spoken words from this audio from user ${userId}. Focus only on actual human speech. If no human speech is detected, respond with "no speech detected". Be concise.` },
                        { inlineData: { mimeType: 'audio/webm', data: base64Audio } }
                    ]
                }];

                const sttSystemInstructions = "You are a helpful AI assistant. Your primary task is to accurately transcribe spoken words from audio.";
                const geminiResult = await geminiHandler.generateResponse(geminiContent, sttSystemInstructions);
                console.log(`[STT] Gemini processed audio from user ${userId}. Response: "${geminiResult}"`);

                const lowerCaseResult = geminiResult ? geminiResult.toLowerCase() : '';
                if (lowerCaseResult.includes('no speech detected') || lowerCaseResult.includes('buzzing sound') || lowerCaseResult.includes('background noise') || lowerCaseResult.trim().length < 5) {
                    resolve(null);
                } else {
                    resolve(geminiResult);
                }

            } catch (geminiError) {
                console.error(`[STT Error] Error sending audio to Gemini for user ${userId}:`, geminiError.message);
                reject(geminiError);
            }
        });
    });
}

async function checkAndJoinVCForGuild(guildId) {
    console.log(`[VC Check] Running VC check for guild ${guildId}...`);
    const guild = client.guilds.cache.get(guildId);

    if (!guild) {
        console.warn(`[VC Check] Guild with ID ${guildId} not found or bot not in guild.`);
        return;
    }

    const currentVoiceConnection = getVoiceConnection(guild.id);
    if (currentVoiceConnection) {
        console.log(`[VC Check] Bot is already in VC in guild ${guild.id}. Checking for alone status.`);

        if (currentVoiceConnection.state.status === 'ready' && currentVoiceConnection.channel) {
            const humanMembersInChannel = currentVoiceConnection.channel.members.filter(member => !member.user.bot);
            if (humanMembersInChannel.size === 0) {
                console.log(`[VC Check] Bot is alone in VC ${currentVoiceConnection.channel.name}. Scheduling leave in ${ALONE_LEAVE_DELAY_MS / 1000} seconds.`);
                setTimeout(() => {
                    const updatedConnection = getVoiceConnection(guild.id);
                    if (updatedConnection && updatedConnection.state.status === 'ready' && updatedConnection.channel && updatedConnection.channel.members.filter(member => !updatedConnection.channel.client.user.bot).size === 0) {
                        updatedConnection.destroy();
                        console.log(`[VC Leave] Bot left VC ${updatedConnection.channel.name} in guild ${guild.id} as it was alone.`);
                    }
                }, ALONE_LEAVE_DELAY_MS);
            }
        }
        return;
    }

    // --- Start: Improved logic for finding VCs with human members ---
    const activeVoiceChannels = new Map(); // Map to store unique voice channels that have human members

    guild.members.cache.forEach(member => {
        // Skip bots and members not in a voice channel
        if (member.user.bot || !member.voice.channel) {
            return;
        }

        const vc = member.voice.channel;
        if (!activeVoiceChannels.has(vc.id)) {
            activeVoiceChannels.set(vc.id, {
                channel: vc,
                humanMembers: new Set()
            });
        }
        activeVoiceChannels.get(vc.id).humanMembers.add(member.id);
    });

    const eligibleVCs = Array.from(activeVoiceChannels.values())
        .filter(entry => entry.humanMembers.size >= 1)
        .map(entry => entry.channel);

    if (eligibleVCs.length === 0) {
        console.log(`[VC Check] No active voice channels with human members found in guild ${guildId}.`);
        return;
    }

    console.log(`[VC Check] Found ${eligibleVCs.length} eligible VCs with human members in guild ${guildId}:`);
    eligibleVCs.forEach(vc => {
        const humanMemberCount = activeVoiceChannels.get(vc.id).humanMembers.size;
        console.log(`  - ${vc.name} (${vc.id}) has ${humanMemberCount} human member(s).`);
    });
    // --- End: Improved logic for finding VCs with human members ---

    const targetVC = eligibleVCs[Math.floor(Math.random() * eligibleVCs.length)];

    if (Math.random() <= VC_JOIN_CHANCE) {
        console.log(`[VC Check] Chance (${VC_JOIN_CHANCE * 100}%) passed. Attempting to join VC: ${targetVC.name} (${targetVC.id}) in guild ${guildId}`);
        try {
            const connection = joinVoiceChannel({
                channelId: targetVC.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false,
            });

            console.log(`[VC Success] Successfully joined voice channel: ${targetVC.name} in guild ${guildId}`);

            const defaultTextChannel = guild.channels.cache.find(
                c => c.type === 0 /* ChannelType.GuildText */ && c.permissionsFor(guild.members.me).has('SEND_MESSAGES')
                && c.id === guild.id
            );
            if (defaultTextChannel) {
                defaultTextChannel.send(`Hello! I've joined ${targetVC.name} in this server.`);
            }
            sendResponseToTextChannel(guild.id, "Hello everyone! I've joined the voice channel.");

            connection.receiver.speaking.on('start', userId => {
                const user = client.users.cache.get(userId);
                if (user && !user.bot) {
                    console.log(`[Voice Activity] User ${user.tag} (${userId}) started speaking in guild ${guildId}.`);
                    const audioStream = connection.receiver.subscribe(userId);

                    userAudioBuffers.set(userId, { opusPackets: [], timeout: null, endTimeout: null });

                    audioStream.on('data', opusPacket => {
                        const userData = userAudioBuffers.get(userId);
                        if (userData) {
                            if (userData.endTimeout) clearTimeout(userData.endTimeout);

                            userData.opusPackets.push(opusPacket);

                            if (userData.timeout) clearTimeout(userData.timeout);
                            userData.timeout = setTimeout(async () => {
                                console.log(`[STT] Processing accumulated Opus packets for ${userId} (timeout during speech).`);

                                const pcmBufferFromWorker = await new Promise((resolve, reject) => {
                                    const worker = new Worker(path.join(__dirname, 'opusDecoderWorker.js'));
                                    worker.on('message', msg => {
                                        if (msg.type === 'pcm_data') {
                                            resolve(Buffer.from(msg.data, 'base64'));
                                        } else if (msg.type === 'error') {
                                            reject(new Error(`Opus Worker Error: ${msg.message}`));
                                        }
                                    });
                                    worker.on('error', reject);
                                    worker.on('exit', (code) => {
                                        if (code !== 0) {
                                            console.warn(`[Opus Worker] Worker for user ${userId} exited with code ${code} without sending PCM data or error.`);
                                            resolve(Buffer.alloc(0));
                                        }
                                    });
                                    worker.postMessage({ type: 'decode_opus_batch', opusPackets: userData.opusPackets.map(p => Buffer.from(p)) });
                                });

                                userData.opusPackets = [];
                                userData.timeout = null;

                                if (pcmBufferFromWorker.length < MIN_PCM_BUFFER_LENGTH) {
                                    console.log(`[STT] Discarding audio from user ${userId} (length: ${pcmBufferFromWorker.length} bytes) - less than 3 seconds of speech.`);
                                    return;
                                }

                                try {
                                    const transcription = await processAudioChunkForSTT(pcmBufferFromWorker, userId, guildId);
                                    if (transcription) {
                                        // For VC, conversation context is guildId, personality is set per guild/channel for chat.
                                        // We use the guildId as the contextIdentifier for VC chat responses as well.
                                        const vcPersonality = currentPersonalities.get(guildId) || DEFAULT_PERSONALITY;
                                        const vcSystemInstructions = loadSystemInstructions(vcPersonality);

                                        const geminiChatResponse = await geminiHandler.generateResponse([{
                                            role: 'user',
                                            parts: [{ text: `User in VC said: "${transcription}"` }]
                                        }], vcSystemInstructions);

                                        if (geminiChatResponse) {
                                            await sendResponseToTextChannel(guild.id, geminiChatResponse);
                                        }
                                    }
                                } catch (error) {
                                    console.error(`[STT Error] Error during audio stream processing (timeout) for ${userId}:`, error.message);
                                }
                            }, 2000);
                        }
                    });

                    audioStream.on('end', async () => {
                        console.log(`[Voice Activity] User ${user.tag} (${userId}) stopped sending audio in guild ${guildId}. Setting grace period timeout.`);
                        const userData = userAudioBuffers.get(userId);
                        if (userData) {
                            if (userData.timeout) clearTimeout(userData.timeout);

                            userData.endTimeout = setTimeout(async () => {
                                console.log(`[Voice Activity] Grace period ended for user ${userId}. Processing final accumulated Opus packets.`);

                                let combinedPcmBuffer = Buffer.alloc(0);
                                if (userData.opusPackets.length > 0) {
                                    try {
                                        const pcmData = await new Promise((resolve, reject) => {
                                            const worker = new Worker(path.join(__dirname, 'opusDecoderWorker.js'));
                                            worker.on('message', msg => {
                                                if (msg.type === 'pcm_data') {
                                                    resolve(Buffer.from(msg.data, 'base64'));
                                                } else if (msg.type === 'error') {
                                                    reject(new Error(`Opus Worker Error: ${msg.message}`));
                                                }
                                            });
                                            worker.on('error', reject);
                                            worker.on('exit', (code) => {
                                                if (code !== 0) {
                                                    console.warn(`[Opus Worker] Worker for user ${userId} exited with code ${code} without sending PCM data or error.`);
                                                    resolve(Buffer.alloc(0));
                                                }
                                            });
                                            worker.postMessage({ type: 'decode_opus_batch', opusPackets: userData.opusPackets.map(p => Buffer.from(p)) });
                                        });
                                        combinedPcmBuffer = pcmData;
                                    } catch (decodeError) {
                                        console.error(`[Opus Decoder Error] Error decoding Opus packets in worker for final processing for user ${userId}:`, decodeError.message);
                                    }
                                }
                                userData.opusPackets = [];

                                if (combinedPcmBuffer.length < MIN_PCM_BUFFER_LENGTH) {
                                    console.log(`[STT] Discarding audio from user ${userId} (length: ${combinedPcmBuffer.length} bytes) - less than 3 seconds of speech.`);
                                    userAudioBuffers.delete(userId);
                                    return;
                                }

                                try {
                                    const transcription = await processAudioChunkForSTT(combinedPcmBuffer, userId, guildId);
                                    if (transcription) {
                                        // Use current personality for response
                                        const vcPersonality = currentPersonalities.get(guildId) || DEFAULT_PERSONALITY;
                                        const vcSystemInstructions = loadSystemInstructions(vcPersonality);

                                        const geminiChatResponse = await geminiHandler.generateResponse([{
                                            role: 'user',
                                            parts: [{ text: `User in VC said: "${transcription}"` }]
                                        }], vcSystemInstructions);

                                        if (geminiChatResponse) {
                                            await sendResponseToTextChannel(guild.id, geminiChatResponse);
                                        }
                                    }
                                } catch (error) {
                                    console.error(`[STT Error] Error during audio stream processing (end) for ${userId}:`, error.message);
                                } finally {
                                    userAudioBuffers.delete(userId);
                                }
                            }, 5000);
                        }
                    });

                    audioStream.on('error', error => {
                        console.error(`[Voice Activity] Audio stream error for user ${userId} in guild ${guildId}:`, error);
                        const userData = userAudioBuffers.get(userId);
                        if (userData) {
                            if (userData.timeout) clearTimeout(userData.timeout);
                            if (userData.endTimeout) clearTimeout(userData.endTimeout);
                            userAudioBuffers.delete(userId);
                        }
                    });
                }
            });


        } catch (error) {
            console.error(`[VC Error] Failed to join voice channel ${targetVC.name} in guild ${guildId}:`, error.message);
        }
    } else {
        console.log(`[VC Check] Chance (${VC_JOIN_CHANCE * 100}%) did not pass for joining VC in guild ${guildId}.`);
    }

    const currentVoiceState = guild.voiceStates.cache.get(client.user.id);
    if (currentVoiceState && currentVoiceState.channel) {
        const humanMembersInChannel = currentVoiceState.channel.members.filter(member => !member.user.bot);
        if (humanMembersInChannel.size === 0) {
            console.log(`[VC Check] Bot is alone in VC ${currentVoiceState.channel.name}. Scheduling leave in ${ALONE_LEAVE_DELAY_MS / 1000} seconds.`);
            setTimeout(() => {
                const updatedVoiceState = guild.voiceStates.cache.get(client.user.id);
                if (updatedVoiceState && updatedVoiceState.channel && updatedVoiceState.channel.members.filter(member => !updatedVoiceState.channel.client.user.bot).size === 0) {
                    const connection = getVoiceConnection(guild.id);
                    if (connection) {
                        connection.destroy();
                    }
                    console.log(`[VC Leave] Bot left VC ${updatedVoiceState.channel.name} in guild ${guild.id} as it was alone.`);
                }
            }, ALONE_LEAVE_DELAY_MS);
        }
    }
}

const MOIA_SPY_RECORDS_BASE_DIR = path.join(__dirname, 'moiaspyrecords');

const MOIA_MEMBERS = [
    '536923904858521621',
    '842189454881980456',
    '801084475395145738',
    '585223483009662976',
    '1268700882988699790',
    '1263799390682742918',
    '658021953764065300',
    '513424582359908392',
    '828986052588339213',
    '775125508383571988',
    '917604039489896499',
    '1046523428364107866'
];
const SPECIAL_INTERESTS = [
    '1141789982101618821',
    'YOUR_SPECIAL_INTEREST_ID_2'
];

// --- Treason Detection Configuration ---
const TREASON_REPORT_CHANNEL_ID = '1383880076298293319'; // The group chat channel ID
const TREASON_MONITORED_SERVER_IDS = [
    '1288529743293186130',
    '969279086792937503',
    '1030842046526804018'
];
const DOJI_PERSONALITY_NAME = 'doji'; // Ensure this matches the key in PERSONALITIES
const TREASON_REPLY_TEXT = "";

// Define treason levels and their corresponding Gemini keywords
const TREASON_LEVELS = {
    'NONE': { keyword: 'NO_TREASON', label: 'No Treason' },
    'MINOR': { keyword: 'MINOR_INFRACTION', label: 'Minor Infraction' },
    'SERIOUS': { keyword: 'SERIOUS_DISLOYALTY', label: 'Serious Disloyalty' },
    'HIGH': { keyword: 'HIGH_TREASON', label: 'High Treason' },
};
// --- End Treason Detection Configuration ---

// --- Serena Command Configuration ---
const SERENA_VIDEO_LINKS = [
    "https://cdn.discordapp.com/attachments/1070139232074612838/1384018003758288938/v24044gl0000cvhed2vog65qvpv3fmsg.mov?ex=6850e6b5&is=684f9535&hm=d3bf7e58fc3c4131a308bf40714699ddd2eb384208953153b111527556382b12&",
    "https://cdn.discordapp.com/attachments/1070139232074612838/1384018133320470659/v09044g40000cdo6p8jc77udo7tdurng.mov?ex=6850e6d4&is=684f9554&hm=3335e21412059b968ef169348ffc9abbe7fc0232394bdeefd60f7256bc028505&",
    "https://cdn.discordapp.com/attachments/1070139232074612838/1384018406856196188/v09044g40000cg120p3c77u6sf7sdv0g.mov?ex=6850e716&is=684f9596&hm=1d01b40aa4fa4e3dcb8ac3cde9e53df05d805901914e090868223bb8355c1484&",
    "https://cdn.discordapp.com/attachments/1070139232074612838/1384018512636547192/v14044g50000cvtrdmnog65qf1anai20.mov?ex=6850e72f&is=684f95af&hm=e8afa718f4d5094484055db3a1f97a67ccb602dfc9020517517c6eafd67dad93&",
    "https://cdn.discordapp.com/attachments/1070139232074612838/1384018583922671676/v14025g50000d0grtf7og65vjlemdfcg.mov?ex=6850e740&is=684f95c0&hm=b1196a319a79b7ee577c096e375994bd05895c5fc55276a5a9ba7f0ec1999a7f&",
    "https://cdn.discordapp.com/attachments/1070139232074612838/1384018666969895013/v12044gd0000cggagvbc77u4jk34r9t0.mov?ex=6850e754&is=684f95d4&hm=d45e0a88ae67de2dfe7ff7e11d130b6e459b3f1c66e6929e50f81942a4074b53&",
    "https://cdn.discordapp.com/attachments/1070139232074612838/1384018764495982602/v14044g50000ctq8la7og65pbdm8glgg.mov?ex=6850e76b&is=684f95eb&hm=767986f09b76dd1ec9843d9e233415d2894939f033159d5e70f89d84de8b5ebc&",
    "https://cdn.discordapp.com/attachments/1070139232074612838/1384018876341289032/v24044gl0000cv5hmkvog65o8orjshn0.mov?ex=6850e785&is=684f9605&hm=e5ad3b4c8fe511f0b1be6de723156ff5da2a8228ada636b463c5d13bb9184036&",
    "https://cdn.discordapp.com/attachments/1070139232074612838/1384018941004742686/v15044gf0000cvbmmlvog65gsjg939o0.mov?ex=6850e795&is=684f9615&hm=5c0de8b430494e42438a00f9e83e8494355f9c538217048aed02665fa518ae4d&",
    "https://cdn.discordapp.com/attachments/1070139232074612838/1384018999397978122/v14044g50000d033irnog65i42d52o2g.mov?ex=6850e7a3&is=684f9623&hm=d26a85c35609afead005f2ff89507446c4826ac56f0d339d72bbca75ff4f5418&"
];
// --- End Serena Command Configuration ---

/**
 * Sanitizes a string to be safe for use as a filename.
 * Replaces invalid characters with underscores and handles length constraints.
 * @param {string} name The string to sanitize.
 * @returns {string} The sanitized filename string.
 */
function sanitizeFilename(name) {
    let sanitized = name
        .replace(/[\\/:*?"<>|]/g, '_') // Replace common invalid characters
        .replace(/\s+/g, '_') // Replace spaces with underscores
        .replace(/__+/g, '_') // Replace multiple underscores with a single one
        .trim(); // Trim whitespace from ends

    // Limit length to avoid filesystem issues (e.g., 255 characters common limit)
    // and ensure it doesn't end with a dot.
    sanitized = sanitized.substring(0, Math.min(sanitized.length, 200)); // Arbitrary length limit
    if (sanitized.endsWith('.')) {
        sanitized = sanitized.slice(0, -1);
    }
    return sanitized;
}

async function logMessageToFile(message) {
    const userId = message.author.id;
    const username = message.author.tag; // This is the display name (e.g., "User#1234" or new username formats)
    const sanitizedUsername = sanitizeFilename(username); // Sanitize for filename safety
    const guildName = message.guild ? message.guild.name : 'Direct Messages';
    const guildId = message.guild ? message.guild.id : 'DM_CHANNEL';
    const channelName = message.channel.name || 'DM Channel';
    const messageContent = message.content;
    const timestampCET = moment(message.createdAt).tz('Europe/Berlin').format('YYYY-MM-DD HH:mm:ss [CET]');

    let targetSubDir = null;

    if (MOIA_MEMBERS.includes(userId)) {
        targetSubDir = 'moiastaff';
    } else if (SPECIAL_INTERESTS.includes(userId)) {
        targetSubDir = 'specialinterests';
    }

    if (!targetSubDir) {
        return;
    }

    const userLogDir = path.join(MOIA_SPY_RECORDS_BASE_DIR, targetSubDir);
    // Construct paths for both potential filenames (old ID-based and new username-based)
    const oldFilePath = path.join(userLogDir, `${userId}.json`);
    const newFilePath = path.join(userLogDir, `${sanitizedUsername}.json`);

    try {
        await fsPromises.mkdir(userLogDir, { recursive: true });

        let userData = {
            userId: userId, // Keep ID inside the file for unique identification
            username: username, // Store the current display name
            guilds: {}
        };
        let fileRead = false;

        // Try to read from the new (username-based) path first
        try {
            const fileContent = await fsPromises.readFile(newFilePath, 'utf8');
            userData = JSON.parse(fileContent);
            fileRead = true;
            console.log(`[Message Logger] Found and read file at new path: ${newFilePath}`);
        } catch (readError) {
            if (readError.code === 'ENOENT') {
                // If not found at new path, try the old (ID-based) path
                try {
                    const fileContent = await fsPromises.readFile(oldFilePath, 'utf8');
                    userData = JSON.parse(fileContent);
                    fileRead = true;
                    console.log(`[Message Logger] Found and read file at old path: ${oldFilePath}`);
                    
                    // If successfully read from old path, rename it to the new path
                    await fsPromises.rename(oldFilePath, newFilePath);
                    console.log(`[Message Logger] Renamed log file from ${oldFilePath} to ${newFilePath}.`);
                } catch (oldReadError) {
                    if (oldReadError.code !== 'ENOENT') {
                        console.error(`[Message Logger Error] Failed to read existing log file from old path ${oldFilePath}:`, oldReadError);
                    } else {
                        console.log(`[Message Logger] No existing log file found for ${username} (${userId}). Creating new at ${newFilePath}.`);
                    }
                }
            } else {
                console.error(`[Message Logger Error] Failed to read existing log file from new path ${newFilePath}:`, readError);
            }
        }

        if (!userData.guilds) {
            userData.guilds = {};
        }

        // Always update the username in the file's metadata to the latest display name
        if (userData.username !== username) {
            console.log(`[Message Logger] Updating username metadata in file ${newFilePath} from "${userData.username}" to "${username}".`);
            userData.username = username;
        }

        if (!userData.guilds[guildId]) {
            userData.guilds[guildId] = {
                name: guildName,
                messages: []
            };
        }

        userData.guilds[guildId].messages.push({
            timestamp: timestampCET,
            channel: channelName,
            content: messageContent,
        });

        // Always write to the new (username-based) file path
        await fsPromises.writeFile(newFilePath, JSON.stringify(userData, null, 2), 'utf8');
        console.log(`[Message Logger] Logged message from ${username} (${userId}) in ${guildName}/${channelName} to file ${sanitizedUsername}.json.`);

    } catch (writeError) {
        console.error(`[Message Logger Error] Failed to write message to log file for ${username} (${userId}):`, writeError); // Log full error object
    }
}

const PROACTIVE_JOIN_GUILD_IDS = [
    '969279086792937503',
    '1288529743293186130',
    '1030842046526804018'
];

// --- Personality Saving/Loading (for currentPersonalities map) ---
async function saveCurrentPersonalities() {
    console.log(`[Persistence] Attempting to save current personalities to ${PERSONALITIES_FILE}`);
    try {
        const dir = path.dirname(PERSONALITIES_FILE);
        await fsPromises.mkdir(dir, { recursive: true });
        // Convert Map to plain object for JSON serialization
        const dataToSave = {};
        for (let [key, value] of currentPersonalities) {
            dataToSave[key] = value;
        }
        await fsPromises.writeFile(PERSONALITIES_FILE, JSON.stringify(dataToSave, null, 2), 'utf8');
        console.log(`[Persistence] Successfully saved current personalities to ${PERSONALITIES_FILE}. Total: ${currentPersonalities.size} entries.`);
    } catch (error) {
        console.error(`[Persistence] Error saving current personalities to ${PERSONALITIES_FILE}:`, error); // Log full error object
    }
}

async function loadCurrentPersonalities() {
    console.log(`[Persistence] Attempting to load current personalities from ${PERSONALITIES_FILE}`);
    try {
        const data = await fsPromises.readFile(PERSONALITIES_FILE, 'utf8');
        const parsedData = JSON.parse(data);
        // Convert plain object back to Map
        for (let key in parsedData) {
            if (Object.prototype.hasOwnProperty.call(parsedData, key)) {
                currentPersonalities.set(key, parsedData[key]);
            }
        }
        console.log(`[Persistence] Successfully loaded current personalities from ${PERSONALITIES_FILE}. Total: ${currentPersonalities.size} entries.`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`[Persistence] No existing personalities file found at ${PERSONALITIES_FILE}. Starting fresh.`);
        } else {
            console.error(`[Persistence] Error loading current personalities from ${PERSONALITIES_FILE}:`, error); // Log full error object
        }
    }
}
// --- End Personality Saving/Loading ---


client.on('ready', async () => {
    console.log(`Logged in as ${client.user.username}!`)
    console.log('Self-bot is ready to operate.')

    // Ensure data directory exists before any file operations
    try {
        await fsPromises.mkdir(DATA_DIR, { recursive: true });
        console.log(`[Startup] Ensured data directory exists: ${DATA_DIR}`);
    } catch (error) {
        console.error(`[Startup Error] Failed to create data directory ${DATA_DIR}:`, error);
        process.exit(1); // Exit if cannot create data directory, as persistence will fail
    }

    // Load persisted data on startup
    await loadCurrentPersonalities();
    await conversationManager.loadConversations(); // Load conversations after personalities
    await conversationManager.loadUserProfiles(); // Load user profiles
    console.log(`[Startup] User Profiles File Path: ${USER_PROFILES_FILE}`); // Added log for file path


    // Set up periodic saving for current personalities (conversationManager saves on each update)
    setInterval(async () => {
        await saveCurrentPersonalities();
    }, 5 * 60 * 1000); // Save currentPersonalities every 5 minutes
    console.log(`[Startup] Scheduled periodic save of personalities every 5 minutes.`);

    // Add periodic save for user profiles
    setInterval(async () => {
        await conversationManager.saveUserProfiles();
    }, 5 * 60 * 1000); // Save user profiles every 5 minutes
    console.log(`[Startup] Scheduled periodic save of user profiles every 5 minutes.`);


    // Start dynamic activity status
    setRandomActivity();
    console.log(`[Startup] Started dynamic activity status.`);


    setInterval(() => {
        const isBotAlreadyInAnyTargetedVC = TARGET_GUILD_IDS.some(guildId => getVoiceConnection(guildId) !== undefined);

        if (isBotAlreadyInAnyTargetedVC) {
            console.log(`[VC Setup] Bot is already in a voice channel in one of the targeted guilds. Skipping further VC join attempts for this interval.`);
            return;
        }

        TARGET_GUILD_IDS.forEach(guildId => checkAndJoinVCForGuild(guildId));
    }, VC_CHECK_INTERVAL_MS);
    console.log(`[VC Setup] Scheduled VC check every ${VC_CHECK_INTERVAL_MS / 1000 / 60} minutes for target guild IDs: ${TARGET_GUILD_IDS.join(', ')}`);
})

// --- Graceful Shutdown Handlers ---
const gracefulShutdown = async (signal) => {
    console.log(`[Shutdown] ${signal} received. Initiating graceful shutdown and data saving...`);
    try {
        await saveCurrentPersonalities();
        await conversationManager.saveConversations(); // Ensure all conversations are saved
        await conversationManager.saveUserProfiles(); // Ensure user profiles are saved
        console.log('[Shutdown] All data saved successfully. Exiting.');
        process.exit(0);
    } catch (error) {
        console.error('[Shutdown Error] An error occurred during graceful shutdown data saving:', error);
        process.exit(1); // Exit with a non-zero code indicating failure
    }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// For unhandled rejections, also attempt to save before crashing
process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    console.log('[Shutdown] Unhandled rejection. Attempting to save data before exit...');
    try {
        await saveCurrentPersonalities();
        await conversationManager.saveConversations();
        await conversationManager.saveUserProfiles();
        console.log('[Shutdown] Data saved after unhandled rejection. Exiting.');
    } catch (error) {
        console.error('[Shutdown Error] An error occurred during unhandled rejection data saving:', error);
    } finally {
        process.exit(1); // Always exit with a non-zero code after unhandled rejection
    }
});
// --- End Graceful Shutdown Handlers ---


client.on('messageReactionAdd', async (reaction, user) => {
    if (user.id === client.user.id) return;

    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Failed to fetch partial reaction:', error);
            return;
        }
    }
    if (user.partial) {
        try {
            await user.fetch();
        } catch (error) {
            console.error('Failed to fetch partial user:', error);
            return;
        }
    }

    if (reaction.message.author.id !== client.user.id) return;
    if (!reaction.message.guild) return;

    const channelId = reaction.message.channel.id;
    const userId = user.id;
    const conversationContextIdentifier = reaction.message.channel.type === 1 /* DM */ ? userId : channelId;

    if (Math.random() <= REACTION_RESPONSE_CHANCE) {
        console.log(`Reaction response chance triggered for ${user.tag}'s reaction (${reaction.emoji.name}).`);

        try {
            const activePersonality = currentPersonalities.get(conversationContextIdentifier) || DEFAULT_PERSONALITY;
            const systemInstructions = loadSystemInstructions(activePersonality);

            const decisionContext = [
                { role: 'model', parts: [{ text: reaction.message.content }] },
                { role: 'user', parts: [{ text: `I (the user) reacted to your previous message with a ${reaction.emoji.name} emoji.` }] }
            ];

            const joinDecision = await geminiHandler.decideToJoin(decisionContext, systemInstructions); // Pass systemInstructions
            console.log(`Gemini decision for reaction response: ${joinDecision}`);


            if (joinDecision === 'yes') {
                console.log(`Gemini decided to respond to ${user.tag}'s reaction (${reaction.emoji.name}).`);

                console.log(`Bot is 'reading' for ${READ_DELAY_MS / 1000} seconds before reacting to reaction...`);
                await new Promise(resolve => setTimeout(resolve, READ_DELAY_MS));

                console.log(`Bot is 'typing' for ${TYPING_DURATION_MS / 1000} seconds for reaction response...`);
                try { // Re-enabled typing indicator
                    await reaction.message.channel.sendTyping();
                } catch (typingError) {
                    console.warn(`Could not send typing indicator for reaction response in channel ${channelId}:`, typingError.message);
                }

                let geminiResponse = null;
                let discordSendFailed = false;

                try {
                    const geminiProcessingPromise = (async () => {
                        const geminiContent = [];
                        const conversationHistory = conversationManager.getConversationHistory(conversationContextIdentifier, channelId, activePersonality);

                        conversationHistory.forEach(msg => {
                            geminiContent.push({
                                role: msg.authorId === client.user.id ? 'model' : 'user',
                                parts: [{ text: msg.content }]
                            });
                        });

                        geminiContent.push({
                            role: 'user',
                            parts: [{ text: `I just reacted to your previous message (the one that says "${reaction.message.content.substring(0, Math.min(reaction.message.content.length, 50))}...") with a ${reaction.emoji.name} emoji. What do you think about that reaction?` }]
                        });

                        // Ensure currentUserMessage is properly formatted for geminiHandler.generateResponse
                        // This assumes the last item pushed to geminiContent is the 'currentUserMessage'
                        // that generateResponse expects as `history[history.length - 1]`
                        return await geminiHandler.generateResponse(geminiContent, systemInstructions, conversationContextIdentifier + '-' + activePersonality);
                    })();

                    const [_, finalGeminiResponse] = await Promise.all([
                        new Promise(resolve => setTimeout(resolve, TYPING_DURATION_MS)),
                        geminiProcessingPromise
                    ]);
                    geminiResponse = finalGeminiResponse;

                } catch (error) {
                    console.error('Error during Gemini processing for reaction response:', error);
                    try {
                        await reaction.message.channel.send('Oops! I encountered an error trying to respond to that reaction. Please try again later.');
                    } catch (sendError) {
                        console.error(`Failed to send error message to Discord in channel ${channelId}:`, sendError.message);
                        discordSendFailed = true;
                    }
                    geminiResponse = null;
                }

                if (geminiResponse && !discordSendFailed) {
                    try {
                        await reaction.message.channel.send(geminiResponse);

                        const guild = reaction.message.guild;
                        if (guild) {
                             await sendResponseToTextChannel(guild.id, geminiResponse);
                        }


                        if (Math.random() <= BOT_RESPONSE_REACTION_CHANCE) {
                            const randomEmoji = REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)];
                            try {
                                await reaction.message.react(randomEmoji);
                                console.log(`Reacted to original message from ${reaction.message.author.tag} with ${randomEmoji} after responding.`);
                            } catch (reactionError) {
                                console.error(`Failed to react to original message after response with ${randomEmoji}:`, reactionError);
                            }
                        }

                        // Add bot's response to history for this personality and context
                        conversationManager.addOrUpdateConversation(conversationContextIdentifier, channelId, geminiResponse, client.user.id, activePersonality);
                        console.log(`Bot's response added to history for user ${userId} in channel ${channelId} with personality ${activePersonality}.`);
                    } catch (sendError) {
                        console.error(`Failed to send main Gemini response to Discord in channel ${channelId}:`, sendError.message);
                    }
                } else if (!geminiResponse && !discordSendFailed) {
                    console.log("Gemini did not return a response (e.g., no valid content). No message sent to Discord.");
                }
            } else {
                console.log(`Gemini decided NOT to respond to ${user.tag}'s reaction.`);
            }
        } catch (error) {
            console.error('Error in messageReactionAdd handler (top-level):', error);
        }
    }
});

client.on('messageCreate', async message => {
    if (MOIA_MEMBERS.includes(message.author.id) || SPECIAL_INTERESTS.includes(message.author.id)) {
        await logMessageToFile(message);
    }

    // --- Treason Detection Logic ---
    if (message.guild && TREASON_MONITORED_SERVER_IDS.includes(message.guild.id) && message.author.id !== client.user.id) {
        console.log(`[Treason Monitor] Monitoring message in guild ${message.guild.name} from ${message.author.tag}.`);
        const dojiSystemInstructions = loadSystemInstructions(DOJI_PERSONALITY_NAME);

        // Fetch recent messages for context
        const messageHistoryForContext = (await message.channel.messages.fetch({ limit: 10 })) // Fetch up to 10 recent messages
            .filter(msg => msg.createdTimestamp < message.createdTimestamp) // Ensure messages are *before* the current one
            .map(msg => ({
                role: msg.author.id === message.author.id ? 'user' : 'model', // Correct role mapping for history
                parts: [{ text: msg.content }]
            }))
            .reverse(); // Reverse to get chronological order for context

        // Add the current treasonous message as the last part of the history for Gemini
        const currentMessagePart = {
            role: 'user',
            parts: [{ text: message.content }]
        };

        // Combine history and current message for the treason detection prompt
        const geminiContentForTreason = [...messageHistoryForContext, currentMessagePart];

        // Updated treason prompt to ask for severity AND reason with stricter output
        const treasonPrompt = `Carefully analyze the final message in the provided conversation history. Based ONLY on the content and context of the final message and the preceding conversation, determine its treasonous severity to the Federation of West Dogeland. Provide a very concise reason (1-2 sentences).

YOUR RESPONSE MUST BE IN THE EXACT FORMAT: 'KEYWORD | REASON_TEXT'.
DO NOT ADD ANY OTHER TEXT, PUNCTUATION, EMOJIS, OR EXPLANATIONS OUTSIDE THIS FORMAT.

Keywords:
- 'HIGH_TREASON' (for severe acts of disloyalty, rebellion, or direct threats to the Federation)
- 'SERIOUS_DISLOYALTY' (for significant but not immediately critical acts against Federation principles or authority)
- 'MINOR_INFRACTION' (for small, possibly unintentional, or less impactful acts of non-compliance or mild dissent)
- 'NO_TREASON' (if the message is completely compliant and loyal or clearly sarcastic/joking and not genuinely treasonous)`;


        try {
            const rawTreasonDecision = await geminiHandler.generateResponse(
                [
                    { role: 'user', parts: [{ text: treasonPrompt }] }, // The instruction prompt
                    ...geminiContentForTreason // The conversation history
                ],
                dojiSystemInstructions,
                'treason-detection-session' // Use a unique session ID for this specific task
            );

            let treasonKeyword = '';
            let treasonReason = 'No specific reason provided by AI or format error.';
            
            // Attempt to parse the Gemini response: KEYWORD | REASON_TEXT
            const parts = rawTreasonDecision ? rawTreasonDecision.split('|').map(s => s.trim()) : [];
            if (parts.length >= 1) {
                treasonKeyword = parts[0].toUpperCase();
                if (parts.length > 1) {
                    treasonReason = parts.slice(1).join('|').trim(); // Re-join if reason contained '|'
                }
            }

            const detectedLevel = Object.values(TREASON_LEVELS).find(
                level => treasonKeyword === level.keyword
            );
            // Default to NO_TREASON if Gemini's response is not an exact keyword match
            const treasonLevel = detectedLevel ? detectedLevel.label : TREASON_LEVELS.NONE.label;
            
            // If the keyword wasn't recognized, default the reason as well.
            if (treasonLevel === TREASON_LEVELS.NONE.label && detectedLevel === undefined) {
                 treasonReason = 'Message was not classified as treasonous or AI response format was unexpected.';
            }


            console.log(`[Treason Monitor] Gemini decision for message from ${message.author.tag}: Raw: "${rawTreasonDecision}" | Parsed Keyword: "${treasonKeyword}" | Parsed Reason: "${treasonReason}" (Interpreted Level: ${treasonLevel})`);

            if (treasonLevel !== TREASON_LEVELS.NONE.label) { // Only report if it's not 'No Treason'
                console.warn(`[TREASON ALERT] Treasonous message detected from ${message.author.tag}! Level: ${treasonLevel}`);
                const timestampCET = moment(message.createdAt).tz('Europe/Berlin').format('YYYY-MM-DD HH:mm:ss [CET]');
                const reportMessage = `
**TREASON ALERT!**
**Treason Level:** ${treasonLevel}
**Reason:** ${treasonReason}
A message considered treasonous to the Federation of West Dogeland has been detected.

**Message Link:** ${message.url}
**Sender:** ${message.author.tag} (ID: ${message.author.id})
**Time (CET):** ${timestampCET}
**Server:** ${message.guild.name} (ID: ${message.guild.id})
**Message Content:**
\`\`\`
${message.content}
\`\`\`
                `;

                // --- Send report to the specified group chat channel ---
                try {
                    // Try getting from cache first, then fetch
                    let reportChannel = client.channels.cache.get(TREASON_REPORT_CHANNEL_ID);
                    if (!reportChannel) {
                        console.log(`[TREASON ALERT] Channel ${TREASON_REPORT_CHANNEL_ID} not in cache, attempting to fetch...`);
                        reportChannel = await client.channels.fetch(TREASON_REPORT_CHANNEL_ID);
                    }

                    if (reportChannel) {
                        const channelType = reportChannel.type;
                        // Use both numerical constants and string comparisons for robustness
                        const isGroupDM = channelType === 3 || (typeof channelType === 'string' && channelType.toUpperCase() === 'GROUP_DM');
                        const isTextChannel = channelType === 0 || (typeof channelType === 'string' && channelType.toUpperCase() === 'GUILD_TEXT');

                        console.log(`[TREASON ALERT] Fetched channel. Type (raw): ${channelType}, Name: ${reportChannel.name || 'N/A'}`);

                        if (isGroupDM || isTextChannel) {
                            await reportChannel.send(reportMessage);
                            console.log(`[TREASON ALERT] Sent treason report to group chat channel ${TREASON_REPORT_CHANNEL_ID}.`);
                        } else {
                            console.error(`[TREASON ALERT ERROR] Channel with ID ${TREASON_REPORT_CHANNEL_ID} found but is not a text/group DM channel. Actual type: ${channelType}`);
                        }
                    } else {
                        console.error(`[TREASON ALERT ERROR] Channel with ID ${TREASON_REPORT_CHANNEL_ID} not found after cache and fetch attempts.`);
                    }
                } catch (channelError) {
                    console.error(`[TREASON ALERT ERROR] Failed to fetch or send to group chat channel ${TREASON_REPORT_CHANNEL_ID}:`, channelError.message);
                }
                // --- End Send report to the specified group chat channel ---

                // --- Reply to the treasonous message ---
                try {
                    await message.reply(TREASON_REPLY_TEXT);
                    console.log(`[TREASON ALERT] Replied to treasonous message from ${message.author.tag}.`);
                } catch (replyError) {
                    console.error(`[TREASON ALERT ERROR] Failed to reply to treasonous message in channel ${message.channel.id}:`, replyError.message);
                }
                // --- End Reply ---

            } else {
                console.log(`[Treason Monitor] Message from ${message.author.tag} is not treasonous (or could not be classified precisely). No alert sent.`);
            }
        } catch (error) {
            console.error(`[Treason Monitor Error] Error during treason detection for message from ${message.author.tag}:`, error);
        }
    }
    // --- End Treason Detection Logic ---


    if (message.author.id === client.user.id) return

    const isDM = message.channel.type === 1;
    const isGroupDM = message.channel.type === 3;
    const isGuildChannel = message.channel.type === 0;

    const botMention = `<@${client.user.id}>`;
    const isPinged = message.content.includes(botMention);

    const userId = message.author.id;
    const channelId = message.channel.id;

    const conversationContextIdentifier = isDM ? userId : channelId;

    // --- Personality Swap Command Check (must be before content cleaning for commands) ---
    if (message.content.toLowerCase().startsWith('!personality')) {
        const parts = message.content.split(' ');
        if (parts.length < 2) {
            await message.channel.send("Please specify a personality. Usage: `!personality [Doji|Whimsy|Sandbox|Serena]`"); // Updated help message
            return;
        }
        const newPersonalityName = parts[1].toLowerCase();
        const newPersonalityConfig = PERSONALITIES[newPersonalityName];

        if (newPersonalityConfig) {
            currentPersonalities.set(conversationContextIdentifier, newPersonalityName);
            // After changing personality, also clear the conversation history for this new personality in this context
            // to ensure a fresh start for that personality in this channel/DM.
            conversationManager.clearConversationHistory(conversationContextIdentifier, channelId, newPersonalityName);
            // Save the updated currentPersonalities map immediately after a personality change
            await saveCurrentPersonalities();
            console.log(`Personality for context "${conversationContextIdentifier}" set to: ${newPersonalityName}. Conversation history cleared for this personality.`);
            await message.channel.send(newPersonalityConfig.confirmation);
        } else {
            await message.channel.send(`Personality "${parts[1]}" not found. Available personalities: ${Object.keys(PERSONALITIES).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')}.`);
        }
        return; // Stop further processing for this message, as it was a command
    }
    // --- End Personality Swap Command Check ---

    // --- Serena Command Check ---
    if (message.content.toLowerCase() === '!serena') {
        // Select a random video link from the SERENA_VIDEO_LINKS array
        const randomIndex = Math.floor(Math.random() * SERENA_VIDEO_LINKS.length);
        const randomVideoLink = SERENA_VIDEO_LINKS[randomIndex];

        try {
            await message.channel.send(randomVideoLink);
            console.log(`[Serena Command] Sent random Serena video link to channel ${message.channel.id}.`);
        } catch (error) {
            console.error(`[Serena Command Error] Failed to send Serena video link:`, error.message);
            await message.channel.send("I couldn't send the Serena video right now. Please try again later.");
        }
        return; // Stop further processing for this message
    }
    // --- End Serena Command Check ---


    const cleanedMessageContent = isDM ? message.content.trim() : message.content.replace(botMention, '').trim();
    const messageHasActualContent = cleanedMessageContent.length > 0 || message.attachments.size > 0;

    let shouldRespond = false;
    let messageForGeminiTextPart = cleanedMessageContent;

    // Get the active personality for this conversation context
    const activePersonality = currentPersonalities.get(conversationContextIdentifier) || DEFAULT_PERSONALITY;

    // Regex to detect a mention (e.g., <@1234567890>) in the message content
    const userMentionRegex = /<@!?(\d+)>/g;
    let mentionedUser = null;
    const matches = [...message.content.matchAll(userMentionRegex)];
    if (matches.length > 0) {
        // Find a mention that is NOT the bot itself
        const nonBotMention = matches.find(match => match[1] !== client.user.id);
        if (nonBotMention) {
            mentionedUser = await client.users.fetch(nonBotMention[1]).catch(() => null);
        }
    }


    if (isDM) {
        shouldRespond = true;
        if (!messageHasActualContent) {
            messageForGeminiTextPart = "Hey! What's up?";
            console.log(`[DM] Empty DM from ${message.author.tag}. Using default prompt: "${messageForGeminiTextPart}"`);
        }
        // Add original DM content to conversation history, passing the active personality
        conversationManager.addOrUpdateConversation(conversationContextIdentifier, channelId, message.content, userId, activePersonality);
    }
    else if (isPinged) {
        shouldRespond = true;
        if (!messageHasActualContent) {
            messageForGeminiTextPart = "Hey! What's up?";
            console.log(`[Ping] Pinged with no content from ${message.author.tag}. Using default prompt: "${messageForGeminiTextPart}"`);
        }
        // Add cleaned pinged content to conversation history, passing the active personality
        conversationManager.addOrUpdateConversation(conversationContextIdentifier, channelId, cleanedMessageContent, userId, activePersonality);
    }
    else if (conversationManager.isUserActive(conversationContextIdentifier, channelId)) {
        shouldRespond = true;
        // Add the message to the shared history, passing the active personality
        conversationManager.addOrUpdateConversation(conversationContextIdentifier, channelId, message.content, userId, activePersonality);
    }
    else {
        let currentCount = channelMessageCounts.get(channelId);
        if (currentCount === undefined) currentCount = 0;
        currentCount++;
        channelMessageCounts.set(channelId, currentCount);

        let canProactivelyJoin = false;
        if (isGuildChannel && message.guild && PROACTIVE_JOIN_GUILD_IDS.includes(message.guild.id)) {
            canProactivelyJoin = true;
        } else if (isGroupDM) {
            canProactivelyJoin = true;
        }

        if (canProactivelyJoin && currentCount % 3 === 0) {
            const joinChance = Math.random();
            if (joinChance <= 0.15) {
                console.log(`Proactive join chance triggered in #${message.channel.name}. Asking Gemini...`);
                const recentMessages = (await message.channel.messages.fetch({ limit: 15 }))
                    .map(msg => ({
                        role: msg.author.id === client.user.id ? 'model' : 'user',
                        parts: [{ text: msg.content }]
                    }))
                    .reverse();

                // For proactive join decision, use the personality currently set for the channel/context
                const systemInstructionsForDecision = loadSystemInstructions(activePersonality);

                const joinDecision = await geminiHandler.decideToJoin(recentMessages, systemInstructionsForDecision);
                console.log(`Gemini decision for proactive join: ${joinDecision}`);
                if (joinDecision === 'yes') {
                    console.log(`Gemini decided to join conversation in #${message.channel.name}.`);
                    shouldRespond = true;
                    // Add the original message to history, passing the active personality
                    conversationManager.addOrUpdateConversation(conversationContextIdentifier, channelId, message.content, userId, activePersonality);
                } else {
                    console.log(`Gemini decided NOT to join conversation in #${message.channel.name}.`);
                }
            }
        }
    }

    if (shouldRespond) {
        const lastTimestamp = lastMessageTimestamps.get(userId);
        const now = Date.now();

        if (lastTimestamp && (now - lastTimestamp < USER_MESSAGE_COOLDOWN_MS)) {
            console.log(`[Rate Limit] Message from ${message.author.tag} (${userId}) ignored due to rate limit.`);
            return;
        }
        lastMessageTimestamps.set(userId, now);
    }

    if (!shouldRespond) {
        return;
    }

    console.log(`Bot is 'reading' for ${READ_DELAY_MS / 1000} seconds...`);
    await new Promise(resolve => setTimeout(resolve, READ_DELAY_MS));

    console.log(`Bot is 'typing' for ${TYPING_DURATION_MS / 1000} seconds while processing...`);
    try { // Re-enabled typing indicator
        await message.channel.sendTyping();
    } catch (typingError) {
        console.warn(`Could not send typing indicator in channel ${channelId}:`, typingError.message);
    }

    let geminiResponse = null;
    let discordSendFailed = false;

    // Use the active personality for loading system instructions for the actual response
    const systemInstructions = loadSystemInstructions(activePersonality);

    try {
        const geminiProcessingPromise = (async () => {
            let currentUserMessageParts = [];

            if (messageForGeminiTextPart.length > 0) {
                currentUserMessageParts.push({ text: messageForGeminiTextPart });
            }

            const attachmentPromises = [];
            const tempDir = path.join(__dirname, 'temp');

            try {
                await fsPromises.mkdir(tempDir, { recursive: true });
            } catch (dirError) {
                if (dirError.code !== 'EEXIST') {
                    console.error(`Error ensuring temp directory exists: ${dirError.message}`);
                }
            }

            for (const attachment of message.attachments.values()) {
                const mimeType = attachment.contentType;
                const fileUrl = attachment.url;
                const tempFilePath = path.join(tempDir, attachment.name);

                attachmentPromises.push(async () => {
                    try {
                        if (mimeType && SUPPORTED_MIME_TYPES.includes(mimeType)) {
                            console.log(`Processing attachment: ${attachment.name} (${mimeType})`);
                            await fileDownloader.downloadFile(fileUrl, tempFilePath);

                            const fileContentBase64 = await fsPromises.readFile(tempFilePath, { encoding: 'base64' });

                            return {
                                inline_data: {
                                    mime_type: mimeType,
                                    data: fileContentBase64
                                }
                            };
                        } else {
                            console.log(`Unsupported attachment type for Gemini analysis: ${mimeType || 'unknown'}. Skipping ${attachment.name}.`);
                            return null;
                        }
                    } catch (error) {
                        console.error(`Error processing attachment ${attachment.name}:`, error);
                        return null;
                    } finally {
                        try {
                            await fsPromises.unlink(tempFilePath);
                            console.log(`Cleaned up temporary file: ${tempFilePath}`);
                        } catch (unlinkError) {
                            if (unlinkError.code !== 'ENOENT') {
                                console.error(`Error cleaning up temp file ${tempFilePath}: ${unlinkError.message}`);
                            }
                        }
                    }
                });
            }

            const processedAttachmentParts = await Promise.all(attachmentPromises.map(p => p()));
            currentUserMessageParts = currentUserMessageParts.concat(processedAttachmentParts.filter(part => part !== null));

            if (currentUserMessageParts.length === 0) {
                console.log("Still no valid content (text or supported attachments) to send to Gemini after all checks.");
                return null;
            }

            let referencedMessageContextParts = [];
            if (message.reference && message.reference.messageId) {
                try {
                    const repliedToMessage = await message.channel.messages.fetch(message.reference.messageId);
                    if (repliedToMessage && repliedToMessage.content) {
                        const truncatedContent = repliedToMessage.content.substring(0, Math.min(repliedToMessage.content.length, 200));
                        const contentSuffix = repliedToMessage.content.length > 200 ? '...' : '';
                        referencedMessageContextParts.push({
                            text: `(In reply to ${repliedToMessage.author.username} (${repliedToMessage.author.id}): "${truncatedContent}${contentSuffix}")`
                        });
                    }
                } catch (error) {
                    console.warn(`Failed to fetch replied-to message (${message.reference.messageId}):`, error.message);
                }
            }

            // Get conversation history for the currently active personality
            const conversationHistory = conversationManager.getConversationHistory(conversationContextIdentifier, channelId, activePersonality);
            let geminiContent = [];

            // Add personality's current opinion about the mentioned user (if any)
            if (mentionedUser) {
                const userOpinion = conversationManager.getUserProfileOpinion(mentionedUser.id, activePersonality);
                if (userOpinion) {
                    geminiContent.push({
                        role: 'user',
                        parts: [{ text: `My previous opinion about ${mentionedUser.username} (${mentionedUser.id}) is: "${userOpinion}"` }]
                    });
                    geminiContent.push({ // Model's acknowledgment of the opinion for a continuous flow
                        role: 'model',
                        parts: [{ text: `Understood, considering my previous thoughts on ${mentionedUser.username}.` }]
                    });
                }
            }


            conversationHistory.forEach(msg => {
                geminiContent.push({
                            role: msg.authorId === client.user.id ? 'model' : 'user',
                            parts: [{ text: msg.content }]
                        });
                    });

            if (referencedMessageContextParts.length > 0) {
                geminiContent.push({
                    role: 'user',
                    parts: referencedMessageContextParts
                });
            }

            geminiContent.push({
                role: 'user',
                parts: currentUserMessageParts
            });

            // Prompt Gemini to form an opinion about the mentioned user
            let geminiPrompt = "";
            if (mentionedUser) {
                geminiPrompt = `The current user is asking about ${mentionedUser.username} (${mentionedUser.id}). Please provide your thoughts on this user, incorporating any previous opinions you might have of them. If you form a new or updated opinion, summarize it concisely at the end of your response, starting with "My opinion of ${mentionedUser.username} is: "`;
            } else {
                geminiPrompt = "Continue the conversation naturally.";
            }

            // Pass sessionId to generateResponse for personality-specific chat history
            const rawGeminiResponse = await geminiHandler.generateResponse(geminiContent, systemInstructions + "\n" + geminiPrompt, conversationContextIdentifier + '-' + activePersonality);

            // Extract new opinion if present in the response
            const opinionPattern = new RegExp(`My opinion of ${mentionedUser ? mentionedUser.username : ".*"} is: (.*)`, 'i');
            const opinionMatch = rawGeminiResponse.match(opinionPattern);
            if (mentionedUser && opinionMatch && opinionMatch[1]) {
                const newOpinion = opinionMatch[1].trim();
                conversationManager.addOrUpdateUserProfileOpinion(mentionedUser.id, newOpinion, activePersonality);
                // Added log to check in-memory map size after opinion storage
                console.log(`[User Profile] Stored new opinion for ${mentionedUser.username}: "${newOpinion}". Total user profiles in memory: ${conversationManager.userProfiles.size}`);
                // Remove the opinion statement from the response sent to Discord
                return rawGeminiResponse.replace(opinionPattern, '').trim();
            } else {
                return rawGeminiResponse;
            }

        })();

        const [_, finalGeminiResponse] = await Promise.all([
            new Promise(resolve => setTimeout(resolve, TYPING_DURATION_MS)),
            geminiProcessingPromise
        ]);
        geminiResponse = finalGeminiResponse;

    } catch (error) {
        console.error('Error during Gemini processing or response generation:', error);
        try {
            await message.channel.send('Oops! I encountered an error trying to respond. Please try again later.');
        } catch (sendError) {
            console.error(`Failed to send error message to Discord in channel ${channelId}:`, sendError.message);
            discordSendFailed = true;
        }
        geminiResponse = null;
    }

    if (geminiResponse && !discordSendFailed) {
        try {
            await message.channel.send(geminiResponse);

            const guild = message.guild;
            if (guild) {
                 await sendResponseToTextChannel(guild.id, geminiResponse);
            }

            if (Math.random() <= BOT_RESPONSE_REACTION_CHANCE) {
                const randomEmoji = REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)];
                try {
                    await message.react(randomEmoji);
                    console.log(`Reacted to original message from ${message.author.tag} with ${randomEmoji} after responding.`);
                } catch (reactionError) {
                    console.error(`Failed to react to original message after response with ${randomEmoji}:`, reactionError);
                }
            }

            // Conversation history is updated with bot's response for the active personality
            conversationManager.addOrUpdateConversation(conversationContextIdentifier, channelId, geminiResponse, client.user.id, activePersonality);
            console.log(`Bot's response added to history for context ${conversationContextIdentifier} in channel ${channelId} with personality ${activePersonality}.`);
        } catch (sendError) {
            console.error(`Failed to send main Gemini response to Discord in channel ${channelId}:`, sendError.message);
        }
    } else if (!geminiResponse && !discordSendFailed) {
        console.log("Gemini did not return a response (e.g., no valid content). No message sent to Discord.");
    }
})

client.login(process.env.DISCORD_USER_TOKEN)
