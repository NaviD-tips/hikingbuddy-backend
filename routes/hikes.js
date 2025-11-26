const express = require('express');
const router = express.Router();
const Hike = require('../models/Hike');
const HikeEntry = require('../models/HikeEntry');
const auth = require('../middleware/auth');

// Get all hikes for the authenticated user
router.get('/', auth, async (req, res) => {
  try {
    const hikes = await Hike.find({ userId: req.user.id, isActive: true })
      .sort({ createdAt: -1 });
    res.json(hikes);
  } catch (error) {
    console.error('Error fetching hikes:', error);
    res.status(500).json({ message: 'Failed to fetch hikes' });
  }
});

// Get a specific hike
router.get('/:id', auth, async (req, res) => {
  try {
    const hike = await Hike.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    });
    
    if (!hike) {
      return res.status(404).json({ message: 'Hike not found' });
    }
    
    res.json(hike);
  } catch (error) {
    console.error('Error fetching hike:', error);
    res.status(500).json({ message: 'Failed to fetch hike' });
  }
});

// Create a new hike
router.post('/', auth, async (req, res) => {
  try {
    const { name, totalDistance, preHikeBudget, onTrailBudget } = req.body;

      // Validation
      if (!name || !totalDistance || onTrailBudget === undefined) {
        return res.status(400).json({ message: 'All fields are required' });
      }

    if (totalDistance <= 0 || onTrailBudget <= 0) {
      return res.status(400).json({ message: 'Distance and on-trail budget must be positive numbers' });
    }

    const hike = new Hike({
      name,
      totalDistance,
      preHikeBudget: preHikeBudget || 0,
      onTrailBudget,
      budget: onTrailBudget, // Keep for backward compatibility
      userId: req.user.id
    });

    await hike.save();
    res.status(201).json(hike);
  } catch (error) {
    console.error('Error creating hike:', error);
    res.status(500).json({ message: 'Failed to create hike' });
  }
});

// Update a hike
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, totalDistance, budget, isActive } = req.body;

    const hike = await Hike.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    });

    if (!hike) {
      return res.status(404).json({ message: 'Hike not found' });
    }

    if (name) hike.name = name;
    if (totalDistance !== undefined) hike.totalDistance = totalDistance;
    if (budget !== undefined) hike.budget = budget;
    if (isActive !== undefined) hike.isActive = isActive;

    await hike.save();
    res.json(hike);
  } catch (error) {
    console.error('Error updating hike:', error);
    res.status(500).json({ message: 'Failed to update hike' });
  }
});

// Delete a hike (soft delete)
router.delete('/:id', auth, async (req, res) => {
  try {
    const hike = await Hike.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    });

    if (!hike) {
      return res.status(404).json({ message: 'Hike not found' });
    }

    hike.isActive = false;
    await hike.save();
    
    res.json({ message: 'Hike deleted successfully' });
  } catch (error) {
    console.error('Error deleting hike:', error);
    res.status(500).json({ message: 'Failed to delete hike' });
  }
});

// Get entries for a hike (with optional date filter)
router.get('/:id/entries', auth, async (req, res) => {
  try {
    const query = {
      hikeId: req.params.id,
      userId: req.user.id
    };

    // If date parameter provided, filter by date
    if (req.query.date) {
      const startOfDay = new Date(req.query.date);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(req.query.date);
      endOfDay.setHours(23, 59, 59, 999);
      
      query.date = {
        $gte: startOfDay,
        $lte: endOfDay
      };
    }

    const entries = await HikeEntry.find(query).sort({ date: 1 });
    res.json(entries);
  } catch (error) {
    console.error('Error fetching entries:', error);
    res.status(500).json({ message: 'Failed to fetch entries' });
  }
});

// Create a new hike entry
router.post('/:id/entries', auth, async (req, res) => {
  try {
    const hike = await Hike.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    });

    if (!hike) {
      return res.status(404).json({ message: 'Hike not found' });
    }

    const {
      date,
      kmTravelled,
      rpe,
      expenses,
      mood,
      sleepQuality,
      overallFeeling,
      caloriesSpent,
      weatherTemp,
      weatherType,
      notes,
      locationFrom,
      locationTo  
    } = req.body;

    // Validation
    if (!date || !rpe || !mood || !sleepQuality || !overallFeeling || 
        caloriesSpent === undefined || !weatherTemp || !weatherType) {
      return res.status(400).json({ message: 'Required fields are missing' });
    }

    // Validate expenses
    if (!expenses || !Array.isArray(expenses)) {
      return res.status(400).json({ message: 'Expenses must be an array' });
    }

    // Calculate total money spent
    const moneySpent = expenses && expenses.length > 0 
    ? expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0) 
    : 0;

    const entry = new HikeEntry({
      hikeId: req.params.id,
      userId: req.user.id,
      date,
      kmTravelled: kmTravelled || 0,
      rpe,
      expenses,
      moneySpent,
      mood,
      sleepQuality,
      overallFeeling,
      caloriesSpent,
      weatherTemp,
      weatherType,
      notes,
      locationFrom: locationFrom || { name: '', lat: null, lng: null }, 
      locationTo: locationTo || { name: '', lat: null, lng: null }  
    });

    await entry.save();
    res.status(201).json(entry);
  } catch (error) {
    console.error('Error creating hike entry:', error);
    res.status(500).json({ message: 'Failed to create hike entry' });
  }
});

// Update a hike entry
router.put('/:hikeId/entries/:entryId', auth, async (req, res) => {
  try {
    const entry = await HikeEntry.findOne({
      _id: req.params.entryId,
      hikeId: req.params.hikeId,
      userId: req.user.id
    });

    if (!entry) {
      return res.status(404).json({ message: 'Entry not found' });
    }

      // Update fields
      const updateFields = [
        'date', 'kmTravelled', 'rpe', 'mood', 
        'sleepQuality', 'overallFeeling', 'caloriesSpent', 'weatherTemp', 'weatherType', 'notes'
      ];

      updateFields.forEach(field => {
        if (req.body[field] !== undefined) {
          entry[field] = req.body[field];
        }
      });

      // Handle expenses separately
      if (req.body.expenses && Array.isArray(req.body.expenses)) {
        entry.expenses = req.body.expenses;
        entry.moneySpent = req.body.expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);
      }

      // Handle locations separately (like expenses)
      if (req.body.locationFrom) {
        entry.locationFrom = req.body.locationFrom;
      }
      if (req.body.locationTo) {
        entry.locationTo = req.body.locationTo;
      }

    await entry.save();
    res.json(entry);
  } catch (error) {
    console.error('Error updating hike entry:', error);
    res.status(500).json({ message: 'Failed to update hike entry' });
  }
});

// Delete a hike entry
router.delete('/:hikeId/entries/:entryId', auth, async (req, res) => {
  try {
    const result = await HikeEntry.deleteOne({
      _id: req.params.entryId,
      hikeId: req.params.hikeId,
      userId: req.user.id
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Entry not found' });
    }

    res.json({ message: 'Entry deleted successfully' });
  } catch (error) {
    console.error('Error deleting hike entry:', error);
    res.status(500).json({ message: 'Failed to delete hike entry' });
  }
});

// Get statistics for a hike
router.get('/:id/stats', auth, async (req, res) => {
  try {
    const hike = await Hike.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    });

    if (!hike) {
      return res.status(404).json({ message: 'Hike not found' });
    }

    const entries = await HikeEntry.find({ hikeId: req.params.id })
      .sort({ date: 1 });

    // Calculate totals
    const totalKmTravelled = entries.reduce((sum, entry) => sum + entry.kmTravelled, 0);
    const totalMoneySpent = entries.reduce((sum, entry) => sum + entry.moneySpent, 0);

    // Count only entries with distance for daily average
    const entriesWithDistance = entries.filter(entry => entry.kmTravelled > 0).length;

    // Calculate category breakdowns
    const categoryTotals = {
      Food: 0,
      Accommodation: 0,
      Travel: 0,
      Equipment: 0,
      General: 0,
      'Pre-Hike': 0
    };

    entries.forEach(entry => {
      if (entry.expenses && Array.isArray(entry.expenses)) {
        entry.expenses.forEach(expense => {
          if (categoryTotals.hasOwnProperty(expense.category)) {
            categoryTotals[expense.category] += expense.amount;
          }
        });
      }
    });

    // Calculate pre-hike vs on-trail spending
    const preHikeSpent = categoryTotals['Pre-Hike'];
    const onTrailSpent = totalMoneySpent - preHikeSpent;

    // Calculate remaining
    const distanceRemaining = Math.max(0, hike.totalDistance - totalKmTravelled);
    const preHikeBudgetRemaining = Math.max(0, (hike.preHikeBudget || 0) - preHikeSpent);
    const onTrailBudgetRemaining = Math.max(0, (hike.onTrailBudget || hike.budget) - onTrailSpent);

    // Calculate percentages
    const distancePercentage = hike.totalDistance > 0 
      ? ((totalKmTravelled / hike.totalDistance) * 100).toFixed(1)
      : 0;
    const preHikeBudgetPercentage = (hike.preHikeBudget || 0) > 0
      ? ((preHikeSpent / hike.preHikeBudget) * 100).toFixed(1)
      : 0;
    const onTrailBudgetPercentage = (hike.onTrailBudget || hike.budget) > 0 
      ? ((onTrailSpent / (hike.onTrailBudget || hike.budget)) * 100).toFixed(1)
      : 0;


    res.json({
      hike,
      entries,
      stats: {
        totalKmTravelled,
        totalMoneySpent,
        preHikeSpent,
        onTrailSpent,
        categoryTotals,
        distanceRemaining,
        preHikeBudgetRemaining,
        onTrailBudgetRemaining,
        distancePercentage,
        preHikeBudgetPercentage,
        onTrailBudgetPercentage,
        totalEntries: entries.length,
        entriesWithDistance: entriesWithDistance
      }
    });
  } catch (error) {
    console.error('Error fetching hike stats:', error);
    res.status(500).json({ message: 'Failed to fetch hike statistics' });
  }
});

module.exports = router;
