// backend/models/Conversation.js
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  // `content` is what gets sent to Anthropic — includes embedded file text
  content: { type: String, required: true },
  // `displayText` is what we render in the UI for the user (clean, no file dump)
  displayText: { type: String, default: '' },
  attachments: [{
    name: String,
    type: String,
    size: Number
  }],
  thinking: { type: String, default: '' },
  usage: {
    input_tokens: Number,
    output_tokens: Number,
    cache_read_input_tokens: Number,
    cache_creation_input_tokens: Number
  },
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

const conversationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, default: 'New conversation' },
  preset: {
    type: String,
    enum: ['general', 'bpmn-edit', 'bpmn-analysis', 'sop-build', 'custom'],
    default: 'general'
  },
  customSystemPrompt: { type: String, default: '' },
  model: { type: String, default: 'claude-sonnet-4-6' },
  maxTokens: { type: Number, default: 32000 },
  thinkingEnabled: { type: Boolean, default: false },
  thinkingBudget: { type: Number, default: 5000 },
  messages: [messageSchema]
}, { timestamps: true });

conversationSchema.index({ userId: 1, updatedAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);