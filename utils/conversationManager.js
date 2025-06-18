// utils/conversationManager.js
const fsPromises = require('node:fs/promises');
const path = require('node:path');

// Helper function to recursively serialize a Map to a plain object structure
function serializeMap(map) {
    if (!(map instanceof Map)) {
        return map; 
    }
    const obj = {};
    for (let [key, value] of map) {
        if (value instanceof Map) { 
            obj[key] = serializeMap(value);
        } else {
            obj[key] = value;
        }
    }
    return obj;
}

// Helper function to recursively deserialize a plain object structure back to a Map
function deserializeMap(obj) {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
        return obj;
    }
    const map = new Map();
    for (let key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
                map.set(key, deserializeMap(obj[key]));
            } else {
                map.set(key, obj[key]);
            }
        }
    }
    return map;
}


class ConversationManager {
    // Stores conversation history:
    // Map<contextIdentifier, Map<channelId, Map<personalityName, Array<Object>>>>
    constructor(conversationsFilePath, userProfilesFilePath) {
        this.conversationsFilePath = conversationsFilePath; 
        this.userProfilesFilePath = userProfilesFilePath; 
        this.conversations = new Map();
        // Stores user opinions: Map<userId, Map<personalityName, string>>
        this.userProfiles = new Map(); 
        this.activeUsers = new Map(); 
        this.TIMEOUT_MS = 5 * 60 * 1000; 
        this.timeouts = new Map(); 
        this.isSavingConversations = false; 
        this.isSavingUserProfiles = false;
    }

    /**
     * Adds a message to the conversation history for a specific context, channel, and personality.
     * Also marks the user/channel as active and triggers a save.
     * @param {string} contextIdentifier The identifier for the conversation context (userId for DMs, channelId for guild/group DMs).
     * @param {string} channelId The ID of the channel where the message was sent.
     * @param {string} messageContent The content of the message.
     * @param {string} authorId The ID of the author of the message.
     * @param {string} personalityName The name of the active personality for this conversation.
     */
    addOrUpdateConversation(contextIdentifier, channelId, messageContent, authorId, personalityName) {
        console.log(`[ConversationManager] Add/Update Conv: context=${contextIdentifier}, channel=${channelId}, personality=${personalityName}, content=${messageContent.substring(0, Math.min(messageContent.length, 30))}...`);
        if (!this.conversations.has(contextIdentifier)) {
            this.conversations.set(contextIdentifier, new Map());
            console.log(`[ConversationManager] Created new context Map for ${contextIdentifier}`);
        }
        const channelMap = this.conversations.get(contextIdentifier);

        if (!channelMap.has(channelId)) {
            channelMap.set(channelId, new Map());
            console.log(`[ConversationManager] Created new channel Map for ${channelId} in context ${contextIdentifier}`);
        }
        const personalityMap = channelMap.get(channelId);

        if (!personalityMap.has(personalityName)) {
            personalityMap.set(personalityName, []);
            console.log(`[ConversationManager] Created new personality history for ${personalityName} in channel ${channelId}`);
        }
        const history = personalityMap.get(personalityName);

        history.push({ content: messageContent, authorId: authorId, timestamp: Date.now() });
        if (history.length > 20) { 
            history.shift();
            console.log(`[ConversationManager] Trimmed history for ${personalityName} in ${channelId}. New length: ${history.length}`);
        }

        if (!this.activeUsers.has(contextIdentifier)) {
            this.activeUsers.set(contextIdentifier, new Set());
        }
        const activeChannels = this.activeUsers.get(contextIdentifier);
        activeChannels.add(channelId);

        this.resetActivityTimeout(contextIdentifier, channelId);

        this.saveConversations(); 
    }

    /**
     * Retrieves the conversation history for a specific context, channel, and personality.
     * @param {string} contextIdentifier The identifier for the conversation context.
     * @param {string} channelId The ID of the channel.
     * @param {string} personalityName The name of the active personality for this conversation.
     * @returns {Array<Object>} An array of message objects representing the conversation history.
     */
    getConversationHistory(contextIdentifier, channelId, personalityName) {
        const channelMap = this.conversations.get(contextIdentifier);
        if (!channelMap) {
            console.log(`[ConversationManager] Get History: No history found for context ${contextIdentifier}.`);
            return [];
        }
        const personalityMap = channelMap.get(channelId);
        if (!personalityMap) {
            console.log(`[ConversationManager] Get History: No history found for channel ${channelId} in context ${contextIdentifier}.`);
            return [];
        }
        const history = personalityMap.get(personalityName);
        console.log(`[ConversationManager] Get History: Retrieved history for personality ${personalityName} in context ${contextIdentifier}, channel ${channelId}. Length: ${history ? history.length : 0}`);
        return history || [];
    }

    /**
     * Adds or updates the bot's opinion about a specific user for a given personality.
     * @param {string} targetUserId The ID of the user being described.
     * @param {string} opinionText The bot's opinion/summary of the user.
     * @param {string} personalityName The personality for which this opinion is stored.
     */
    addOrUpdateUserProfileOpinion(targetUserId, opinionText, personalityName) {
        console.log(`[ConversationManager] Add/Update User Opinion: targetUser=${targetUserId}, personality=${personalityName}, opinion=${opinionText.substring(0, Math.min(opinionText.length, 50))}...`);
        if (!this.userProfiles.has(targetUserId)) {
            this.userProfiles.set(targetUserId, new Map());
            console.log(`[ConversationManager] Created new user profile Map for ${targetUserId}`);
        }
        const personalityOpinionMap = this.userProfiles.get(targetUserId);
        personalityOpinionMap.set(personalityName, opinionText);
        // Ensure this save is attempted every time an opinion is added/updated
        this.saveUserProfiles(); 
    }

    /**
     * Retrieves the bot's stored opinion about a specific user for a given personality.
     * @param {string} targetUserId The ID of the user to retrieve the opinion for.
     * @param {string} personalityName The personality for which to retrieve the opinion.
     * @returns {string|null} The stored opinion, or null if not found.
     */
    getUserProfileOpinion(targetUserId, personalityName) {
        const personalityOpinionMap = this.userProfiles.get(targetUserId);
        if (!personalityOpinionMap) {
            console.log(`[ConversationManager] Get User Opinion: No profile found for user ${targetUserId}.`);
            return null;
        }
        const opinion = personalityOpinionMap.get(personalityName);
        console.log(`[ConversationManager] Get User Opinion: Retrieved opinion for user ${targetUserId}, personality ${personalityName}. Opinion exists: ${!!opinion}`);
        return opinion || null;
    }

    /**
     * Checks if a user/channel is currently considered "active" in a conversation.
     * @param {string} contextIdentifier The identifier for the conversation context.
     * @param {string} channelId The ID of the channel.
     * @returns {boolean} True if active, false otherwise.
     */
    isUserActive(contextIdentifier, channelId) {
        const activeChannels = this.activeUsers.get(contextIdentifier);
        const isActive = activeChannels ? activeChannels.has(channelId) : false;
        return isActive;
    }

    /**
     * Resets the activity timeout for a given context and channel.
     * If no new messages arrive within the timeout, the context/channel is marked inactive.
     * @param {string} contextIdentifier The identifier for the conversation context.
     * @param {string} channelId The ID of the channel.
     */
    resetActivityTimeout(contextIdentifier, channelId) {
        const key = `${contextIdentifier}-${channelId}`;
        if (this.timeouts.has(key)) {
            clearTimeout(this.timeouts.get(key));
        }

        const timeout = setTimeout(() => {
            const activeChannels = this.activeUsers.get(contextIdentifier);
            if (activeChannels) {
                activeChannels.delete(channelId);
                if (activeChannels.size === 0) {
                    this.activeUsers.delete(contextIdentifier);
                }
            }
            this.timeouts.delete(key);
            console.log(`[ConversationManager] Context ${contextIdentifier} in channel ${channelId} is now inactive due to timeout.`);
        }, this.TIMEOUT_MS);
        this.timeouts.set(key, timeout);
    }

    /**
     * Clears the entire conversation history for a specific personality within a context and channel.
     * Useful for resetting a persona's memory in a specific chat.
     * Triggers a save after clearing.
     * @param {string} contextIdentifier The identifier for the conversation context.
     * @param {string} channelId The ID of the channel.
     * @param {string} personalityName The name of the personality whose history to clear.
     */
    clearConversationHistory(contextIdentifier, channelId, personalityName) {
        console.log(`[ConversationManager] Clear History: Attempting to clear history for personality "${personalityName}" in context ${contextIdentifier}, channel ${channelId}.`);
        const channelMap = this.conversations.get(contextIdentifier);
        if (channelMap) {
            const personalityMap = channelMap.get(channelId);
            if (personalityMap) {
                personalityMap.delete(personalityName);
                if (personalityMap.size === 0) {
                    channelMap.delete(channelId);
                    console.log(`[ConversationManager] Clear History: No more personalities in channel ${channelId}, deleting channel map.`);
                }
                if (channelMap.size === 0) {
                    this.conversations.delete(contextIdentifier);
                    console.log(`[ConversationManager] Clear History: No more channels in context ${contextIdentifier}, deleting context map.`);
                }
            }
        }
        console.log(`[ConversationManager] Clear History: History cleared for personality "${personalityName}" in context ${contextIdentifier}, channel ${channelId}.`);
        this.saveConversations(); 
    }

    /**
     * Loads conversation data from the specified JSON file.
     */
    async loadConversations() {
        console.log(`[ConversationManager] Attempting to load conversations from "${this.conversationsFilePath}"`);
        try {
            const data = await fsPromises.readFile(this.conversationsFilePath, 'utf8');
            const parsedData = JSON.parse(data);
            this.conversations = deserializeMap(parsedData); 
            console.log(`[ConversationManager] Successfully loaded conversations from "${this.conversationsFilePath}". Map size: ${this.conversations.size}`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`[ConversationManager] No existing conversation file found at "${this.conversationsFilePath}". Starting fresh.`);
            } else {
                console.error(`[ConversationManager] Error loading conversations from "${this.conversationsFilePath}":`, error); 
            }
            this.conversations = new Map(); 
        }
    }

    /**
     * Saves conversation data to the specified JSON file.
     * Uses a flag to prevent multiple concurrent save operations.
     */
    async saveConversations() {
        if (this.isSavingConversations) {
            console.log("[ConversationManager] Conversations save in progress, skipping concurrent save request.");
            return;
        }
        this.isSavingConversations = true;
        console.log(`[ConversationManager] Initiating conversation save to "${this.conversationsFilePath}"...`);
        try {
            const dir = path.dirname(this.conversationsFilePath);
            await fsPromises.mkdir(dir, { recursive: true });

            const dataToSave = serializeMap(this.conversations); 
            await fsPromises.writeFile(this.conversationsFilePath, JSON.stringify(dataToSave, null, 2), 'utf8');
            console.log(`[ConversationManager] Successfully saved conversations to "${this.conversationsFilePath}"`);
        } catch (error) {
            console.error(`[ConversationManager] Error saving conversations to "${this.conversationsFilePath}":`, error); 
        } finally {
            this.isSavingConversations = false;
            console.log("[ConversationManager] Conversation save process finished. isSavingConversations set to false.");
        }
    }

    /**
     * Loads user profile data from the specified JSON file.
     */
    async loadUserProfiles() {
        console.log(`[ConversationManager] Attempting to load user profiles from "${this.userProfilesFilePath}"`);
        try {
            const data = await fsPromises.readFile(this.userProfilesFilePath, 'utf8');
            const parsedData = JSON.parse(data);
            this.userProfiles = deserializeMap(parsedData); 
            console.log(`[ConversationManager] Successfully loaded user profiles from "${this.userProfilesFilePath}". Total profiles loaded: ${this.userProfiles.size}`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`[ConversationManager] No existing user profiles file found at "${this.userProfilesFilePath}". Starting fresh.`);
            } else {
                console.error(`[ConversationManager] Error loading user profiles from "${this.userProfilesFilePath}":`, error); 
            }
            this.userProfiles = new Map(); 
        }
    }

    /**
     * Saves user profile data to the specified JSON file.
     * Uses a flag to prevent multiple concurrent save operations.
     */
    async saveUserProfiles() {
        if (this.isSavingUserProfiles) {
            console.log("[ConversationManager] User profiles save in progress, skipping concurrent save request.");
            return;
        }
        this.isSavingUserProfiles = true;
        console.log(`[ConversationManager] Initiating user profiles save to "${this.userProfilesFilePath}"...`);
        try {
            const dir = path.dirname(this.userProfilesFilePath);
            await fsPromises.mkdir(dir, { recursive: true });

            const dataToSave = serializeMap(this.userProfiles); 
            await fsPromises.writeFile(this.userProfilesFilePath, JSON.stringify(dataToSave, null, 2), 'utf8');
            console.log(`[ConversationManager] Successfully saved user profiles to "${this.userProfilesFilePath}". Current in-memory size: ${this.userProfiles.size}`);
        } catch (error) {
            console.error(`[ConversationManager] Error saving user profiles to "${this.userProfilesFilePath}":`, error); 
            // Log the error object to get more details about the file system issue
            console.error(error); 
        } finally {
            this.isSavingUserProfiles = false;
            console.log("[ConversationManager] User profiles save process finished. isSavingUserProfiles set to false.");
        }
    }
}

module.exports = ConversationManager;
