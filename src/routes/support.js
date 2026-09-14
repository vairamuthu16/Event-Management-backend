import express from 'express';
import { SupportTicket } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/*
  GET /api/support/mine
  Get support tickets created by the logged-in user
*/
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const tickets = await SupportTicket.find({
      user: req.user.id
    })
      .sort({ createdAt: -1 })
      .populate('user', 'name email');

    res.json(tickets);
  } catch (error) {
    console.error('Get support tickets error:', error);
    res.status(500).json({
      message: 'Failed to load support tickets'
    });
  }
});

/*
  POST /api/support
  Create a new support ticket
*/
router.post('/', requireAuth, async (req, res) => {
  try {
    const { subject, message, category } = req.body;

    if (!subject || !message) {
      return res.status(400).json({
        message: 'Subject and message are required'
      });
    }

    const ticket = await SupportTicket.create({
      user: req.user.id,
      subject: subject.trim(),
      message: message.trim(),
      category: category || 'General',
      status: 'open'
    });

    const populatedTicket = await SupportTicket.findById(ticket._id)
      .populate('user', 'name email');

    res.status(201).json(populatedTicket);
  } catch (error) {
    console.error('Create support ticket error:', error);
    res.status(500).json({
      message: 'Failed to create support ticket'
    });
  }
});

export default router;