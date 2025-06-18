// utils/geminiHandler.js
const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiHandler {
    constructor(apiKeys) {
        if (!apiKeys || apiKeys.length === 0) {
            throw new Error("At least one Google API Key must be provided.");
        }
        this.apiKeys = apiKeys;
        this.apiKeyIndex = 0; // Keep track of the current API key being used
        this.genAIs = this.apiKeys.map(key => new GoogleGenerativeAI(key));
        this.models = this.genAIs.map(genAI => genAI.getGenerativeModel({
            model: "gemini-2.0-flash", // Using gemini-pro for text and multimodal content
            // Explicitly set safety settings to BLOCK_NONE AT THE MODEL LEVEL
            safetySettings: [
                {
                    category: "HARM_CATEGORY_HARASSMENT",
                    threshold: "BLOCK_NONE"
                },
                {
                    category: "HARM_CATEGORY_HATE_SPEECH",
                    threshold: "BLOCK_NONE"
                },
                {
                    category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                    threshold: "BLOCK_NONE"
                },
                {
                    category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                    threshold: "BLOCK_NONE"
                },
            ],
        }));
        this.chatInstances = new Map(); // Stores chat sessions per unique ID (e.g., channel ID + personality)
        this.MAX_RETRIES = 3; // Max attempts for API calls on recoverable errors
    }

    /**
     * Cycles through API keys in case of rate limits or errors.
     * @returns {object} The current generative model instance.
     */
    getCurrentModel() {
        // Increment and wrap around to use the next API key/model
        this.apiKeyIndex = (this.apiKeyIndex + 1) % this.models.length;
        console.log(`[GeminiHandler] Cycling to API Key Index: ${this.apiKeyIndex}`);
        return this.models[this.apiKeyIndex];
    }

    /**
     * Generates a text response from Gemini based on conversation history.
     * @param {Array<Object>} history The conversation history as an array of message objects.
     * This array contains { role: string, parts: Array<Object> } objects.
     * @param {string} systemInstruction The system instruction string for the model.
     * @param {string} sessionId A unique ID for the chat session (e.g., channelId-personalityName).
     * @returns {Promise<string>} The generated text response.
     */
    async generateResponse(history, systemInstruction, sessionId = 'default-chat') {
        let model = this.getCurrentModel();
        let retries = 0;
        let responseText = null;
        let apiError = null;

        // This `initialContext` includes the system instruction and the bot's acknowledgment.
        // It's part of the persistent chat history for the session.
        const initialContextForChat = [{ role: 'user', parts: [{ text: systemInstruction }] }, { role: 'model', parts: [{ text: "Understood." }] }];

        // The `history` array passed to this function from `index.js`
        // already contains the conversation from `conversationManager`,
        // including the current user's message at the end.
        const currentUserMessage = history[history.length - 1]; // Extract the current user's message
        const priorConversationHistory = history.slice(0, history.length - 1); // Extract prior history

        do {
            try {
                let chat = this.chatInstances.get(sessionId);

                // If a chat instance for this sessionId doesn't exist, create and initialize it.
                if (!chat) {
                    console.log(`[GeminiHandler] Starting new chat session for sessionId: ${sessionId}`);
                    chat = model.startChat({
                        history: [...initialContextForChat, ...priorConversationHistory],
                        generationConfig: {
                            maxOutputTokens: 2048,
                        },
                    });
                    this.chatInstances.set(sessionId, chat);
                } else {
                    console.log(`[GeminiHandler] Using existing chat session for sessionId: ${sessionId}`);
                }

                const result = await chat.sendMessage(currentUserMessage.parts);
                const response = result.response;
                responseText = response.text();
                apiError = null; // Clear any previous error if successful
                break; // Exit loop on success
            } catch (error) {
                apiError = error;
                console.error(`[GeminiHandler Error] Attempt ${retries + 1}/${this.MAX_RETRIES} for sessionId ${sessionId}. Error:`, error.message);

                // Check for 503 (Service Unavailable) or 429 (Rate Limit) to retry
                if (error.status === 503 || error.status === 429) {
                    retries++;
                    if (retries < this.MAX_RETRIES) {
                        const delay = 2000 * retries; // Simple exponential backoff
                        console.log(`[GeminiHandler] Retrying in ${delay / 1000} seconds due to ${error.status} error.`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        model = this.getCurrentModel(); // Cycle API key for next retry
                    } else {
                        console.error(`[GeminiHandler] Max retries reached for sessionId ${sessionId}. Giving up.`);
                    }
                } else {
                    // For other errors, rethrow or handle differently
                    console.error(`[GeminiHandler] Non-retryable error encountered for sessionId ${sessionId}. Not retrying.`, error);
                    break; // Do not retry for non-503/429 errors
                }
            }
        } while (retries < this.MAX_RETRIES);

        if (responseText) {
            return responseText;
        } else {
            console.error(`[GeminiHandler] Failed to get a response after all retries for sessionId ${sessionId}. Last error:`, apiError);
            return "I apologize, but I encountered an error while trying to process that. The AI model is currently unavailable or overloaded. Please try again later.";
        }
    }

    /**
     * Decides whether the bot should join a conversation based on recent messages.
     * This method typically uses a separate, lighter model or a simpler prompt.
     * @param {Array<Object>} recentMessages A short history of recent messages.
     * @param {string} systemInstruction The system instruction string for the decision model.
     * @returns {Promise<string>} 'yes' or 'no'
     */
    async decideToJoin(recentMessages, systemInstruction) {
        let model = this.getCurrentModel();
        let retries = 0;
        let decisionResult = 'no'; // Default to 'no'
        let apiError = null;

        do {
            try {
                // For decision making, we create a new, temporary chat session for each decision.
                const decisionChat = model.startChat({
                    history: [{ role: 'user', parts: [{ text: systemInstruction }] }, { role: 'model', parts: [{ text: "Understood." }] }, ...recentMessages],
                    generationConfig: {
                        maxOutputTokens: 50, // Keep response short for decision making
                    },
                });

                const prompt = `Given the following recent conversation, should I join in? Respond only with 'yes' or 'no'.`;
                const result = await decisionChat.sendMessage(prompt);
                const response = result.response;
                const text = response.text().toLowerCase().trim();

                if (text.includes('yes')) {
                    decisionResult = 'yes';
                } else {
                    decisionResult = 'no';
                }
                apiError = null; // Clear any previous error if successful
                break; // Exit loop on success
            } catch (error) {
                apiError = error;
                console.error(`[GeminiHandler Error] Decision attempt ${retries + 1}/${this.MAX_RETRIES}. Error:`, error.message);

                if (error.status === 503 || error.status === 429) {
                    retries++;
                    if (retries < this.MAX_RETRIES) {
                        const delay = 2000 * retries;
                        console.log(`[GeminiHandler] Retrying decision in ${delay / 1000} seconds due to ${error.status} error.`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        model = this.getCurrentModel(); // Cycle API key for next retry
                    } else {
                        console.error(`[GeminiHandler] Max retries reached for decision. Giving up.`);
                    }
                } else {
                    console.error(`[GeminiHandler] Non-retryable error encountered for decision. Not retrying.`, error);
                    break;
                }
            }
        } while (retries < this.MAX_RETRIES);

        if (apiError) {
             console.error(`[GeminiHandler] Failed to get a decision after all retries. Defaulting to 'no'. Last error:`, apiError);
        }
        return decisionResult; // Returns 'yes' or 'no' or 'no' by default if errors persist
    }
}

module.exports = GeminiHandler;
