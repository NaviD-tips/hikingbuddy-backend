const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../middleware/auth');

// ── Inline model ──
const travelDaySchema = new mongoose.Schema({
  date:       { type: String, required: true },
  dayName:    { type: String, default: '' },
  activities: { type: String, default: '' },
  notes:      { type: String, default: '' },
  hotel:      { type: String, default: '' },
  location:   { type: String, default: '' },
  booked:     { type: Boolean, default: false },
  accomJPY:   { type: Number, default: 0 },
  accomAUD:   { type: Number, default: 0 },
});

const TravelItinerary = mongoose.models.TravelItinerary ||
  mongoose.model('TravelItinerary', new mongoose.Schema({
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tripName: { type: String, default: 'My Trip' },
    days:     [travelDaySchema],
  }, { timestamps: true }));

console.log('TravelItinerary ready:', typeof TravelItinerary.findOne);

// ── GET /api/travel/trips — list all trips for user (id + name + date range only)
router.get('/trips', auth, async (req, res) => {
  try {
    const trips = await TravelItinerary.find({ userId: req.user.id })
      .select('tripName createdAt updatedAt days')
      .lean();
    const summary = trips.map(t => ({
      _id: t._id,
      tripName: t.tripName,
      updatedAt: t.updatedAt,
      dayCount: t.days.length,
      dateRange: t.days.length > 0
        ? `${t.days[0].date} → ${t.days[t.days.length - 1].date}`
        : '',
    }));
    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch trips' });
  }
});

// ── GET /api/travel/itinerary/:tripId — fetch one full trip
router.get('/itinerary/:tripId', auth, async (req, res) => {
  try {
    const itinerary = await TravelItinerary.findOne({ _id: req.params.tripId, userId: req.user.id });
    if (!itinerary) return res.status(404).json({ message: 'Trip not found' });
    res.json(itinerary);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch itinerary' });
  }
});

// ── GET /api/travel/itinerary — fetch most recently updated trip (backwards compat)
router.get('/itinerary', auth, async (req, res) => {
  try {
    const itinerary = await TravelItinerary.findOne({ userId: req.user.id }).sort({ updatedAt: -1 });
    if (!itinerary) return res.json({ days: [] });
    res.json(itinerary);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch itinerary' });
  }
});

// ── POST /api/travel/itinerary — create a new trip (always creates new document)
router.post('/itinerary', auth, async (req, res) => {
  try {
    const { tripName, days } = req.body;
    if (!days || !Array.isArray(days)) {
      return res.status(400).json({ message: 'days must be an array' });
    }
    const itinerary = await TravelItinerary.create({
      userId: req.user.id,
      tripName: tripName || 'My Trip',
      days,
    });
    res.status(201).json(itinerary);
  } catch (error) {
    res.status(500).json({ message: 'Failed to save itinerary' });
  }
});

// ── PATCH /api/travel/itinerary/:tripId/rename
router.patch('/itinerary/:tripId/rename', auth, async (req, res) => {
  try {
    const { tripName } = req.body;
    const itinerary = await TravelItinerary.findOneAndUpdate(
      { _id: req.params.tripId, userId: req.user.id },
      { tripName },
      { new: true }
    );
    if (!itinerary) return res.status(404).json({ message: 'Trip not found' });
    res.json({ _id: itinerary._id, tripName: itinerary.tripName });
  } catch (error) {
    res.status(500).json({ message: 'Failed to rename trip' });
  }
});

// ── PUT /api/travel/itinerary/:tripId/:date — update single day
router.put('/itinerary/:tripId/:date', auth, async (req, res) => {
  try {
    const { tripId, date } = req.params;
    const updates = req.body;
    const itinerary = await TravelItinerary.findOne({ _id: tripId, userId: req.user.id });
    if (!itinerary) return res.status(404).json({ message: 'Trip not found' });
    const dayIndex = itinerary.days.findIndex(d => d.date === date);
    if (dayIndex === -1) return res.status(404).json({ message: `No day found for date ${date}` });
    const allowedFields = ['activities', 'notes', 'hotel', 'location', 'booked', 'accomJPY', 'accomAUD', 'dayName'];
    allowedFields.forEach(field => {
      if (updates[field] !== undefined) itinerary.days[dayIndex][field] = updates[field];
    });
    itinerary.markModified('days');
    await itinerary.save();
    res.json(itinerary.days[dayIndex]);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update day' });
  }
});

// ── DELETE /api/travel/itinerary/:tripId — delete one trip
router.delete('/itinerary/:tripId', auth, async (req, res) => {
  try {
    await TravelItinerary.deleteOne({ _id: req.params.tripId, userId: req.user.id });
    res.json({ message: 'Trip deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete trip' });
  }
});

module.exports = router;