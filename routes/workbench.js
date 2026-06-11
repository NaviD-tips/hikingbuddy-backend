// backend/routes/workbench.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const mammoth = require('mammoth');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const Conversation = require('../models/Conversation');
const auth = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB per file
});

// Pandoc lives at ./bin/pandoc (installed by scripts/install-pandoc.sh during Render build).
// Override via env var PANDOC_PATH if installed elsewhere (e.g. dev machine).
const PANDOC = process.env.PANDOC_PATH || path.resolve(__dirname, '..', 'bin', 'pandoc');

// ── Hidden access: only listed usernames can use the workbench ──
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

// Returns { text, keepBinary } — keepBinary is true for .docx (we store the
// original to use as a pandoc reference-doc during export).
async function extractFileContent(file) {
  const name = file.originalname || 'file';
  const lower = name.toLowerCase();

  if (lower.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return { text: result.value, keepBinary: true };
  }
  // .bpmn, .xml, .txt, .md, .json, .csv, .html, etc — treat as UTF-8 text
  return { text: file.buffer.toString('utf8'), keepBinary: false };
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

// ── Get one conversation ──
// We strip binary blobs from the response so the JSON payload stays light —
// the UI doesn't need the docx binary, only the backend does (for export).
router.get('/conversations/:id', auth, gateKeeper, async (req, res) => {
  try {
    const conv = await Conversation.findOne({ _id: req.params.id, userId: req.user.id }).lean();
    if (!conv) return res.status(404).json({ message: 'Not found' });
    // Strip binary fields from attachments before sending to client
    if (conv.messages) {
      conv.messages.forEach(m => {
        if (m.attachments) {
          m.attachments.forEach(a => { delete a.binary; });
        }
      });
    }
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
      { new: true, lean: true }
    );
    if (!conv) return res.status(404).json({ message: 'Not found' });
    // Strip binaries from response
    if (conv.messages) {
      conv.messages.forEach(m => {
        if (m.attachments) m.attachments.forEach(a => { delete a.binary; });
      });
    }
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

    let combinedText = '';
    const attachmentMeta = [];
    for (const f of files) {
      const { text, keepBinary } = await extractFileContent(f);
      combinedText += `<attached_file name="${f.originalname}">\n${text}\n</attached_file>\n\n`;
      attachmentMeta.push({
        name: f.originalname,
        mimeType: f.mimetype,
        size: f.size,
        binary: keepBinary ? f.buffer : null
      });
    }
    combinedText += userText;

    conv.messages.push({
      role: 'user',
      content: combinedText,
      displayText: userText,
      attachments: attachmentMeta,
      timestamp: new Date()
    });

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
      conv.messages.pop();
      await conv.save();
      return res.status(anthropicRes.status).json({
        message: data.error?.message || `Anthropic API error (${anthropicRes.status})`,
        details: data
      });
    }

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

    if (conv.title === 'New conversation' && userText) {
      conv.title = userText.slice(0, 60).replace(/\s+/g, ' ').trim();
    }

    await conv.save();

    // Strip binaries from response payload
    const convOut = conv.toObject();
    convOut.messages.forEach(m => {
      if (m.attachments) m.attachments.forEach(a => { delete a.binary; });
    });

    res.json({
      conversation: convOut,
      assistantMessage: convOut.messages[convOut.messages.length - 1]
    });
  } catch (e) {
    console.error('message error:', e);
    res.status(500).json({ message: e.message });
  }
});

// ── Export an assistant message as .docx via pandoc ──
// Uses the most recent uploaded .docx in the conversation as a pandoc
// reference-doc to apply that template's styles (fonts, headings, etc.).
// Falls back to generic styling if no .docx template found.
router.post('/conversations/:id/messages/:idx/export', auth, gateKeeper, async (req, res) => {
  let tmpDir;
  try {
    const conv = await Conversation.findOne({ _id: req.params.id, userId: req.user.id });
    if (!conv) return res.status(404).json({ message: 'Not found' });

    const idx = parseInt(req.params.idx, 10);
    const msg = conv.messages[idx];
    if (!msg || msg.role !== 'assistant') {
      return res.status(400).json({ message: 'Invalid message index (must point to an assistant message)' });
    }

    // Walk back through messages to find the most recent docx with stored binary
    let templateBinary = null;
    let templateName = null;
    for (let i = idx - 1; i >= 0; i--) {
      const m = conv.messages[i];
      if (m.attachments && m.attachments.length) {
        for (const a of m.attachments) {
          if (a.name?.toLowerCase().endsWith('.docx') && a.binary && a.binary.length > 0) {
            templateBinary = a.binary;
            templateName = a.name;
            break;
          }
        }
      }
      if (templateBinary) break;
    }

    // Create a temp working directory
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wb-export-'));
    const mdPath  = path.join(tmpDir, 'input.md');
    const outPath = path.join(tmpDir, 'output.docx');
    await fsp.writeFile(mdPath, msg.content, 'utf8');

    const args = [mdPath, '-o', outPath, '-f', 'markdown', '-t', 'docx'];

    if (templateBinary) {
      const tplPath = path.join(tmpDir, 'template.docx');
      await fsp.writeFile(tplPath, templateBinary);
      args.push(`--reference-doc=${tplPath}`);
    }

    // Run pandoc
    try {
      await execFileAsync(PANDOC, args, { timeout: 30000 });
    } catch (e) {
      console.error('pandoc error:', e);
      return res.status(500).json({
        message: `Pandoc failed: ${e.message}`,
        hint: 'Check that pandoc is installed at ' + PANDOC + ' (run scripts/install-pandoc.sh on Render)'
      });
    }

    const buf = await fsp.readFile(outPath);

    // Filename: derive from conversation title or template name
    const safeTitle = (conv.title || 'sop')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 60);
    const filename = `${safeTitle}-${Date.now()}.docx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Template-Used', templateName || 'none');
    res.send(buf);
  } catch (e) {
    console.error('export error:', e);
    res.status(500).json({ message: e.message });
  } finally {
    if (tmpDir) {
      fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
});

module.exports = router;