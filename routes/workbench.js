// backend/routes/workbench.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const mammoth = require('mammoth');
const Conversation = require('../models/Conversation');
const auth = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB per file
});

// ── Hidden access: only listed usernames can use the workbench ──
// Set WORKBENCH_USERS env var on Render to a comma-separated list, e.g. "clintmorrison"
const ALLOWED = (process.env.WORKBENCH_USERS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function gateKeeper(req, res, next) {
  if (ALLOWED.length > 0 && !ALLOWED.includes(req.user.username)) {
    return res.status(404).json({ message: 'Not found' });
  }
  next();
}

// ── Built-in system prompts ──
const PRESETS = {
  'general': 'You are Claude, an AI assistant by Anthropic. Be direct, accurate, and helpful. Avoid unnecessary preamble.',

  'bpmn-edit':
`You are a BPMN 2.0 round-trip editor for Enlighten Operational Excellence (bpmn.io format).

When the user provides a BPMN XML file and requests changes:
- Preserve ALL existing element IDs. Do not rename them.
- Preserve the existing bpmndi:BPMNDiagram layout exactly for unchanged elements.
- For new elements, generate fresh unique IDs and add matching bpmndi:BPMNShape / bpmndi:BPMNEdge entries with explicit coordinates and bounds.
- Always return the COMPLETE modified BPMN XML, ready to re-import.
- Wrap the BPMN XML in a single fenced code block tagged \`\`\`xml.
- Briefly summarise the changes you made above the code block. No filler.`,

  'bpmn-analysis':
`You are a BPMN 2.0 process analyst.

When reviewing a BPMN file:
- Ignore the bpmndi:BPMNDiagram layout section. Focus on the logical process structure.
- Cite specific element IDs when referring to tasks, gateways, events, or flows.
- Look for: missing exception paths, ambiguous gateway conditions, orphan elements, unreachable nodes, naming inconsistencies, and gaps where a control or handoff is implied but not shown.
- Suggest concrete improvements with reasoning.
- Do NOT return modified XML. Analysis only. If the user wants edits made, tell them to switch to the BPMN Edit preset.`,

  'sop-build':
`You are an operational excellence consultant building Standard Operating Procedures from BPMN process maps.

House SOP structure (use this unless told otherwise):
1. Document Control Information
2. Purpose
3. Scope
4. Definitions & Acronyms
5. Roles and Responsibilities
6. Compliance
7. Procedure (group by phase; numbered steps ONLY when sequence matters, prose otherwise)
8. Quality Control
9. References
10. Version History

Rules:
- Reference BPMN element IDs in the Procedure section so SOP and process map stay traceable.
- If information is missing or ambiguous, add an "Open Questions" section at the end listing the gaps explicitly. NEVER fabricate process detail.
- Plain Australian English. No AI-flavoured filler ("delve", "navigate the complexities", "in today's fast-paced world", etc.).`
};

function buildSystem(conv) {
  const base = conv.preset === 'custom'
    ? (conv.customSystemPrompt || PRESETS.general)
    : (PRESETS[conv.preset] || PRESETS.general);

  return [{ type: 'text', text: base, cache_control: { type: 'ephemeral' } }];
}

async function extractFileText(file) {
  const name = file.originalname || 'file';
  const lower = name.toLowerCase();
  const buffer = file.buffer;

  if (lower.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  // .bpmn, .xml, .txt, .md, .json, .csv, .html, etc — treat as UTF-8 text
  return buffer.toString('utf8');
}

// ── List conversations ──
router.get('/conversations', auth, gateKeeper, async (req, res) => {
  try {
    const convs = await Conversation.find({ userId: req.user.id })
      .select('title preset model updatedAt')
      .sort({ updatedAt: -1 })
      .limit(200);
    res.json(convs);
  } catch (e) {
    console.error('list:', e);
    res.status(500).json({ message: e.message });
  }
});

// ── Get one conversation (full messages) ──
router.get('/conversations/:id', auth, gateKeeper, async (req, res) => {
  try {
    const conv = await Conversation.findOne({ _id: req.params.id, userId: req.user.id });
    if (!conv) return res.status(404).json({ message: 'Not found' });
    res.json(conv);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Create new conversation ──
router.post('/conversations', auth, gateKeeper, async (req, res) => {
  try {
    const { title, preset, customSystemPrompt, model, maxTokens, thinkingEnabled, thinkingBudget } = req.body;
    const conv = await Conversation.create({
      userId: req.user.id,
      title: title || 'New conversation',
      preset: preset || 'general',
      customSystemPrompt: customSystemPrompt || '',
      model: model || 'claude-sonnet-4-6',
      maxTokens: maxTokens || 32000,
      thinkingEnabled: !!thinkingEnabled,
      thinkingBudget: thinkingBudget || 5000
    });
    res.status(201).json(conv);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Update conversation settings / rename ──
router.patch('/conversations/:id', auth, gateKeeper, async (req, res) => {
  try {
    const allowed = ['title', 'preset', 'customSystemPrompt', 'model', 'maxTokens', 'thinkingEnabled', 'thinkingBudget'];
    const updates = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    const conv = await Conversation.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      updates,
      { new: true }
    );
    if (!conv) return res.status(404).json({ message: 'Not found' });
    res.json(conv);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Delete conversation ──
router.delete('/conversations/:id', auth, gateKeeper, async (req, res) => {
  try {
    await Conversation.deleteOne({ _id: req.params.id, userId: req.user.id });
    res.json({ message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Send a message (with optional attached files) ──
router.post('/conversations/:id/message', auth, gateKeeper, upload.array('files', 10), async (req, res) => {
  try {
    const conv = await Conversation.findOne({ _id: req.params.id, userId: req.user.id });
    if (!conv) return res.status(404).json({ message: 'Not found' });

    const userText = (req.body.text || '').trim();
    const files = req.files || [];
    if (!userText && files.length === 0) {
      return res.status(400).json({ message: 'Empty message' });
    }

    // Build combined content (file text + user text) for the API
    let combinedText = '';
    const attachmentMeta = [];
    for (const f of files) {
      const txt = await extractFileText(f);
      combinedText += `<attached_file name="${f.originalname}">\n${txt}\n</attached_file>\n\n`;
      attachmentMeta.push({ name: f.originalname, mimeType: f.mimetype, size: f.size });
    }
    combinedText += userText;

    // Persist the user message
    conv.messages.push({
      role: 'user',
      content: combinedText,
      displayText: userText,
      attachments: attachmentMeta,
      timestamp: new Date()
    });

    // Build the Anthropic request
    const apiMessages = conv.messages.map(m => ({
      role: m.role,
      content: m.content
    }));

    const apiPayload = {
      model: conv.model,
      max_tokens: conv.maxTokens,
      system: buildSystem(conv),
      messages: apiMessages
    };

    if (conv.thinkingEnabled) {
      apiPayload.thinking = { type: 'enabled', budget_tokens: conv.thinkingBudget };
      // Note: temperature must NOT be set when thinking is enabled.
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ message: 'ANTHROPIC_API_KEY not configured' });

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(apiPayload)
    });

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      // Roll back the user message we just added so it can be retried
      conv.messages.pop();
      await conv.save();
      return res.status(anthropicRes.status).json({
        message: data.error?.message || `Anthropic API error (${anthropicRes.status})`,
        details: data
      });
    }

    // Extract text + thinking blocks from response
    const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const thinkingBlocks = (data.content || []).filter(b => b.type === 'thinking').map(b => b.thinking).join('\n');

    conv.messages.push({
      role: 'assistant',
      content: textBlocks,
      displayText: textBlocks,
      thinking: thinkingBlocks || '',
      usage: data.usage || {},
      timestamp: new Date()
    });

    // Auto-title from first user message
    if (conv.title === 'New conversation' && userText) {
      conv.title = userText.slice(0, 60).replace(/\s+/g, ' ').trim();
    }

    await conv.save();
    res.json({
      conversation: conv,
      assistantMessage: conv.messages[conv.messages.length - 1]
    });
  } catch (e) {
    console.error('message error:', e);
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;