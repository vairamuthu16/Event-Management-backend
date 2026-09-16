import express from 'express';

import {
  SupportTicket
} from '../models/index.js';

import {
  requireAuth
} from '../middleware/auth.js';

const router = express.Router();


/*
|--------------------------------------------------------------------------
| GET MY SUPPORT TICKETS
|--------------------------------------------------------------------------
| GET /api/support/mine
*/

router.get(
  '/mine',
  requireAuth,
  async (req, res) => {
    try {
      const tickets =
        await SupportTicket.find({
          user: req.user._id
        })
          .populate(
            'user',
            'name email'
          )
          .sort({
            createdAt: -1
          });

      res.json(tickets);

    } catch (error) {
      console.error(
        'Get support tickets error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to load support tickets'
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| CREATE SUPPORT TICKET
|--------------------------------------------------------------------------
| POST /api/support
*/

router.post(
  '/',
  requireAuth,
  async (req, res) => {
    try {
      const {
        subject,
        message,
        category
      } = req.body;

      if (!subject || !message) {
        return res.status(400).json({
          message:
            'Subject and message are required'
        });
      }

      const ticket =
        await SupportTicket.create({
          user: req.user._id,

          subject:
            String(subject).trim(),

          message:
            String(message).trim(),

          category:
            String(
              category || 'General'
            ).trim(),

          status: 'open'
        });

      const populatedTicket =
        await SupportTicket.findById(
          ticket._id
        ).populate(
          'user',
          'name email'
        );

      res.status(201).json(
        populatedTicket
      );

    } catch (error) {
      console.error(
        'Create support ticket error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to create support ticket'
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| CLIENT FEEDBACK
|--------------------------------------------------------------------------
| PATCH /api/support/:id/feedback
*/

router.patch(
  '/:id/feedback',
  requireAuth,
  async (req, res) => {
    try {
      const {
        rating,
        comment
      } = req.body;

      const numericRating =
        Number(rating);

      if (
        !Number.isFinite(
          numericRating
        ) ||
        numericRating < 1 ||
        numericRating > 5
      ) {
        return res.status(400).json({
          message:
            'Rating must be between 1 and 5'
        });
      }

      const ticket =
        await SupportTicket.findById(
          req.params.id
        );

      if (!ticket) {
        return res.status(404).json({
          message:
            'Support ticket not found'
        });
      }

      if (
        String(ticket.user) !==
        String(req.user._id)
      ) {
        return res.status(403).json({
          message:
            'You can only review your own support ticket'
        });
      }

      if (ticket.status !== 'resolved') {
        return res.status(400).json({
          message:
            'Feedback can only be submitted after the ticket is resolved'
        });
      }

      ticket.feedback = {
        rating: numericRating,

        comment:
          String(
            comment || ''
          ).trim(),

        submittedAt: new Date()
      };

      await ticket.save();

      const updatedTicket =
        await SupportTicket.findById(
          ticket._id
        ).populate(
          'user',
          'name email'
        );

      res.json(updatedTicket);

    } catch (error) {
      console.error(
        'Support feedback error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to submit support feedback'
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| CLIENT REOPEN
|--------------------------------------------------------------------------
| PATCH /api/support/:id/reopen
*/

router.patch(
  '/:id/reopen',
  requireAuth,
  async (req, res) => {
    try {
      const ticket =
        await SupportTicket.findById(
          req.params.id
        );

      if (!ticket) {
        return res.status(404).json({
          message:
            'Support ticket not found'
        });
      }

      if (
        String(ticket.user) !==
        String(req.user._id)
      ) {
        return res.status(403).json({
          message:
            'You can only reopen your own support ticket'
        });
      }

      if (ticket.status !== 'resolved') {
        return res.status(400).json({
          message:
            'Only resolved tickets can be reopened'
        });
      }

      ticket.status = 'open';

      /*
       * Keep the previous admin reply and
       * feedback for history.
       */
      await ticket.save();

      const updatedTicket =
        await SupportTicket.findById(
          ticket._id
        ).populate(
          'user',
          'name email'
        );

      res.json(updatedTicket);

    } catch (error) {
      console.error(
        'Reopen support ticket error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to reopen support ticket'
      });
    }
  }
);


export default router;