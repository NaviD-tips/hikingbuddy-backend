const express = require('express');
const router = express.Router();
const multer = require('multer');
const auth = require('../middleware/auth');

// PDFs can be a few MB. 10 MB cap is generous and protects against abuse.
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
});

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// ── Helper: forward a request to Anthropic and return the parsed JSON ──
async function callAnthropic(body) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const err = new Error('ANTHROPIC_API_KEY not configured on server');
    err.status = 500;
    throw err;
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Anthropic API returned ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── POST /api/travel/ai/parse-pdf — multipart upload, returns Anthropic response
router.post('/parse-pdf', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const base64 = req.file.buffer.toString('base64');
    const today  = new Date().toISOString().split('T')[0];

    const prompt = `You are a travel itinerary parser. Extract the itinerary from this PDF and return structured JSON.

Today's date is ${today}.

IMPORTANT: The PDF may have information spread across multiple pages or tables. For example, dates and activities may be on one page, while accommodation details for the same dates are on another page. You must correlate them by date/row position to produce complete day entries.

Rules:
- Output ONLY a JSON array, no markdown, no explanation.
- Each element represents one day with these fields:
  - date: "YYYY-MM-DD" string. Convert dates like "10/03/2026" to "2026-03-10".
  - dayName: day-of-week or label — string
  - activities: all activities for that day as one string — string
  - hotel: accommodation name for that night — string
  - location: city or country for that day — string
  - notes: any notes — string
  - booked: true if marked Y or Yes or Booked, otherwise false
  - accomJPY: accommodation cost in JPY as a number (0 if not present)
  - accomAUD: accommodation cost in AUD as a number (0 if not present)
- Match accommodation rows to date rows by their position (first accom row = first date row, etc).
- Skip summary rows, totals, exchange rates, and non-day content.
- If a field doesn't exist for a day, use empty string or 0.
- Include ALL days even if they have no activities or accommodation.`;

    const data = await callAnthropic({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: prompt },
        ],
      }],
    });

    res.json(data);
  } catch (error) {
    console.error('parse-pdf error:', error.message);
    res.status(error.status || 500).json({ message: error.message || 'PDF parsing failed' });
  }
});

// ── POST /api/travel/ai/parse-excel — { rows: string[][] } body
router.post('/parse-excel', auth, async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows) return res.status(400).json({ message: 'Missing rows array' });

    const sample  = rows.slice(0, 60).map(r => (r || []).map(c => String(c ?? '').trim()));
    const rawText = sample.map((r, i) => `Row ${i}: [${r.join(' | ')}]`).join('\n');
    const today   = new Date().toISOString().split('T')[0];

    const prompt = `You are a travel itinerary parser. I will give you raw rows from an Excel file. Map them to structured JSON.

Today's date is ${today}.

Rules:
- Output ONLY a JSON array, no markdown, no explanation.
- Each element represents one day with these fields:
  - date: "YYYY-MM-DD" string. If the file has no real dates but has a day number (1, 2, 3...), assign dates starting from the trip start date you can infer, or use today + day offset.
  - dayName: day-of-week name or label (e.g. "Monday", "Day 1") — string
  - activities: combine all activity columns into one string separated by " | " — string
  - hotel: accommodation name or city if no hotel listed — string
  - location: city or country — string
  - notes: any notes — string
  - booked: true/false (default false)
  - accomJPY: number (0 if not present)
  - accomAUD: number (0 if not present)
- Skip rows that are clearly headers or empty.
- If a column doesn't exist, use empty string or 0.

Raw Excel rows:
${rawText}`;

    const data = await callAnthropic({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    res.json(data);
  } catch (error) {
    console.error('parse-excel error:', error.message);
    res.status(error.status || 500).json({ message: error.message || 'Excel parsing failed' });
  }
});

// ── POST /api/travel/ai/suggestions — { location, customPrompt? }
router.post('/suggestions', auth, async (req, res) => {
  try {
    const location     = String(req.body?.location || '').trim() || 'Tokyo, Japan';
    const customPrompt = String(req.body?.customPrompt || '').trim();

    const focusLine = customPrompt
      ? `The user is specifically interested in: ${customPrompt}. All suggestions must relate to this.`
      : `Suggest things that suit someone who enjoys culture, history, cycling, and authentic local experiences.`;

    const prompt = `Search the web for real things to do in ${location}. ${focusLine}

Using only results you find via web search, return exactly 4 real attractions, activities, or restaurants that genuinely exist and are open to tourists in ${location}.

Return ONLY a JSON array, no markdown:
[{"name":"Exact real place name","desc":"One factual sentence about what it is and why it is worth visiting"}]`;

    const data = await callAnthropic({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    });

    res.json(data);
  } catch (error) {
    console.error('suggestions error:', error.message);
    res.status(error.status || 500).json({ message: error.message || 'Suggestions failed' });
  }
});

module.exports = router;