import axios from 'axios';

class AIService {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('OpenRouter API key is required');
    }
    this.apiKey = apiKey;
    this.baseUrl = 'https://openrouter.ai/api/v1';
    this.defaultModel = process.env.AI_MODEL_CHAT || 'anthropic/claude-3.5-sonnet';
    this.embeddingModel = process.env.AI_MODEL_EMBEDDINGS || 'openai/text-embedding-ada-002';
  }

  /**
   * Generate a chat completion
   * @param {Array} messages - Array of message objects with role and content
   * @param {Object} options - Additional options for the API call
   * @returns {Promise<Object>} - The AI's response
   */
  async chat(messages, options = {}) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: options.model || this.defaultModel,
          messages,
          temperature: options.temperature || 0.7,
          max_tokens: options.max_tokens || 1000,
          ...options
        },
        {
          headers: this._getHeaders()
        }
      );

      return response.data.choices[0].message;
    } catch (error) {
      console.error('Error in AI chat completion:', error.response?.data || error.message);
      throw new Error(`AI service error: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Generate embeddings for a text or array of texts
   * @param {string|string[]} input - Text or array of texts to generate embeddings for
   * @returns {Promise<Array>} - Array of embedding vectors
   */
  async getEmbeddings(input) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/embeddings`,
        {
          model: this.embeddingModel,
          input: Array.isArray(input) ? input : [input]
        },
        {
          headers: this._getHeaders()
        }
      );

      return response.data.data.map(item => ({
        embedding: item.embedding,
        index: item.index
      }));
    } catch (error) {
      console.error('Error generating embeddings:', error.response?.data || error.message);
      throw new Error(`Failed to generate embeddings: ${error.message}`);
    }
  }

  /**
   * Generate a summary of the provided text
   * @param {string} text - Text to summarize
   * @param {Object} options - Additional options for summarization
   * @returns {Promise<string>} - Generated summary
   */
  async summarize(text, options = {}) {
    try {
      const response = await this.chat(
        [
          {
            role: 'system',
            content: 'You are a helpful research assistant. Provide a concise summary of the following text.'
          },
          {
            role: 'user',
            content: `Please summarize the following text:\n\n${text}`
          }
        ],
        {
          temperature: 0.3,
          max_tokens: 500,
          ...options
        }
      );

      return response.content;
    } catch (error) {
      console.error('Error generating summary:', error);
      throw new Error(`Failed to generate summary: ${error.message}`);
    }
  }

  /**
   * Answer a question based on the provided context
   * @param {string} question - The question to answer
   * @param {string} context - Context to base the answer on
   * @param {Object} options - Additional options
   * @returns {Promise<string>} - The answer to the question
   */
  async answerQuestion(question, context, options = {}) {
    try {
      const response = await this.chat(
        [
          {
            role: 'system',
            content: `You are a helpful research assistant. Answer the question based on the context provided. If the context doesn't contain the answer, say "I don't know."`
          },
          {
            role: 'user',
            content: `Context: ${context}\n\nQuestion: ${question}`
          }
        ],
        {
          temperature: 0.3,
          max_tokens: 500,
          ...options
        }
      );

      return response.content;
    } catch (error) {
      console.error('Error generating answer:', error);
      throw new Error(`Failed to generate answer: ${error.message}`);
    }
  }

  /**
   * Get the current model information
   * @returns {Promise<Object>} - Model information
   */
  async getModelInfo() {
    try {
      const response = await axios.get(
        `${this.baseUrl}/models`,
        {
          headers: this._getHeaders()
        }
      );

      // Find the current model in the list of available models
      const currentModel = response.data.data.find(
        model => model.id === this.defaultModel
      );

      return {
        currentModel: this.defaultModel,
        modelInfo: currentModel || {},
        availableModels: response.data.data
      };
    } catch (error) {
      console.error('Error getting model info:', error);
      throw new Error(`Failed to get model info: ${error.message}`);
    }
  }

  /**
   * Get the request headers with authentication
   * @private
   */
  _getHeaders() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/yourusername/research-bot',
      'X-Title': 'Idaho PUC Research Assistant'
    };
  }
}

// Create a singleton instance
export const aiService = new AIService(process.env.OPENROUTER_API_KEY);

export default AIService;
