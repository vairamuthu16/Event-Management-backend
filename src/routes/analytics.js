import express from 'express';

import {
  Event,
  Registration
} from '../models/index.js';

import {
  protect,
  roles
} from '../middleware/auth.js';

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Event Analytics
|--------------------------------------------------------------------------
*/

router.get(
  '/event/:eventId',
  protect,
  roles('organizer', 'admin'),
  async (req, res) => {
    try {
      const event = await Event.findById(req.params.eventId);

      if (!event) {
        return res.status(404).json({
          message: 'Event not found'
        });
      }

      if (
        req.user.role !== 'admin' &&
        String(event.organizer) !== String(req.user._id)
      ) {
        return res.status(403).json({
          message: 'Not your event'
        });
      }

      const regs = await Registration.find({
        event: event._id
      });

      const paid = regs.filter(
        (r) =>
          r.paymentStatus === 'paid' &&
          r.status !== 'cancelled'
      );

      const ticketsSold = paid.reduce(
        (sum, r) => sum + (Number(r.quantity) || 0),
        0
      );

      const revenue = paid.reduce(
        (sum, r) => sum + (Number(r.amount) || 0),
        0
      );

      const attended = paid.reduce(
        (sum, r) =>
          sum +
          (r.attended
            ? Number(r.quantity) || 0
            : 0),
        0
      );

      const attendanceRate =
        ticketsSold > 0
          ? Number(
              ((attended / ticketsSold) * 100).toFixed(2)
            )
          : 0;

      const ratings = regs
        .map((r) => Number(r.feedback?.rating))
        .filter(
          (rating) =>
            Number.isFinite(rating) &&
            rating >= 1 &&
            rating <= 5
        );

      const averageRating =
        ratings.length > 0
          ? Number(
              (
                ratings.reduce(
                  (sum, rating) => sum + rating,
                  0
                ) / ratings.length
              ).toFixed(2)
            )
          : 0;

      const feedbackCount = ratings.length;

      const byTicket = {};

      paid.forEach((r) => {
        const ticketTypeId = String(r.ticketType);

        byTicket[ticketTypeId] =
          (byTicket[ticketTypeId] || 0) +
          (Number(r.quantity) || 0);
      });

      res.json({
        event: {
          id: event._id,
          title: event.title,
          capacity:
            event.capacity ||
            event.ticketTypes.reduce(
              (sum, ticket) =>
                sum + (Number(ticket.quantity) || 0),
              0
            )
        },

        registrations: regs.length,

        ticketsSold,

        revenue,

        attended,

        attendanceRate,

        averageRating,

        feedbackCount,

        ticketBreakdown: event.ticketTypes.map(
          (ticket) => ({
            name: ticket.name,
            sold:
              byTicket[String(ticket._id)] || 0,
            capacity: ticket.quantity,
            price: ticket.price
          })
        )
      });
    } catch (error) {
      console.error(
        'Event analytics error:',
        error
      );

      res.status(500).json({
        message: 'Failed to load event analytics'
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| Organizer Analytics
|--------------------------------------------------------------------------
*/

router.get(
  '/organizer',
  protect,
  roles('organizer', 'admin'),
  async (req, res) => {
    try {
      /*
       * Organizers only see their own events.
       * Admins can see all events.
       */
      const eventFilter =
        req.user.role === 'admin'
          ? {}
          : {
              organizer: req.user._id
            };

      const events = await Event.find(eventFilter)
        .sort({ createdAt: -1 });

      const eventIds = events.map(
        (event) => event._id
      );

      /*
       * Only paid registrations are included
       * in sales/revenue/attendance analytics.
       */
      const regs =
        eventIds.length > 0
          ? await Registration.find({
              event: { $in: eventIds },
              paymentStatus: 'paid',
              status: { $ne: 'cancelled' }
            }).sort({ createdAt: 1 })
          : [];

      /*
       * Overall ticket sales
       */
      const ticketsSold = regs.reduce(
        (sum, registration) =>
          sum +
          (Number(registration.quantity) || 0),
        0
      );

      /*
       * Overall revenue
       */
      const revenue = regs.reduce(
        (sum, registration) =>
          sum +
          (Number(registration.amount) || 0),
        0
      );

      /*
       * Overall attendance
       */
      const attended = regs.reduce(
        (sum, registration) =>
          sum +
          (registration.attended
            ? Number(registration.quantity) || 0
            : 0),
        0
      );

      const attendanceRate =
        ticketsSold > 0
          ? Number(
              (
                (attended / ticketsSold) *
                100
              ).toFixed(2)
            )
          : 0;

      /*
       * Overall feedback / rating
       */
      const ratings = regs
        .map((registration) =>
          Number(
            registration.feedback?.rating
          )
        )
        .filter(
          (rating) =>
            Number.isFinite(rating) &&
            rating >= 1 &&
            rating <= 5
        );

      const feedbackCount = ratings.length;

      const averageRating =
        feedbackCount > 0
          ? Number(
              (
                ratings.reduce(
                  (sum, rating) =>
                    sum + rating,
                  0
                ) / feedbackCount
              ).toFixed(2)
            )
          : 0;

      /*
       * Event-level analytics
       */
      const eventPerformance = events.map(
        (event) => {
          const eventRegs = regs.filter(
            (registration) =>
              String(registration.event) ===
              String(event._id)
          );

          const sold = eventRegs.reduce(
            (sum, registration) =>
              sum +
              (Number(registration.quantity) || 0),
            0
          );

          const eventRevenue =
            eventRegs.reduce(
              (sum, registration) =>
                sum +
                (Number(registration.amount) || 0),
              0
            );

          const eventAttended =
            eventRegs.reduce(
              (sum, registration) =>
                sum +
                (registration.attended
                  ? Number(
                      registration.quantity
                    ) || 0
                  : 0),
              0
            );

          const eventAttendanceRate =
            sold > 0
              ? Number(
                  (
                    (eventAttended / sold) *
                    100
                  ).toFixed(2)
                )
              : 0;

          const eventRatings =
            eventRegs
              .map((registration) =>
                Number(
                  registration.feedback?.rating
                )
              )
              .filter(
                (rating) =>
                  Number.isFinite(rating) &&
                  rating >= 1 &&
                  rating <= 5
              );

          const eventFeedbackCount =
            eventRatings.length;

          const eventAverageRating =
            eventFeedbackCount > 0
              ? Number(
                  (
                    eventRatings.reduce(
                      (sum, rating) =>
                        sum + rating,
                      0
                    ) /
                    eventFeedbackCount
                  ).toFixed(2)
                )
              : 0;

          return {
            id: event._id,
            title: event.title,
            status: event.status,

            sold,

            attended: eventAttended,

            attendanceRate:
              eventAttendanceRate,

            revenue: eventRevenue,

            averageRating:
              eventAverageRating,

            feedbackCount:
              eventFeedbackCount
          };
        }
      );

      /*
       * Ticket sales chart
       */
      const salesByEvent =
        eventPerformance.map((event) => ({
          name: event.title,
          value: event.sold
        }));

      /*
       * Revenue chart
       */
      const revenueByEvent =
        eventPerformance.map((event) => ({
          name: event.title,
          value: event.revenue
        }));

      /*
       * Revenue trend
       *
       * Group paid registrations by month.
       */
      const revenueTrendMap = {};

      regs.forEach((registration) => {
        const date =
          registration.createdAt
            ? new Date(
                registration.createdAt
              )
            : null;

        if (
          !date ||
          Number.isNaN(date.getTime())
        ) {
          return;
        }

        const year = date.getFullYear();

        const month = String(
          date.getMonth() + 1
        ).padStart(2, '0');

        const key = `${year}-${month}`;

        if (!revenueTrendMap[key]) {
          revenueTrendMap[key] = {
            name: key,
            value: 0
          };
        }

        revenueTrendMap[key].value +=
          Number(registration.amount) || 0;
      });

      const revenueTrend = Object.values(
        revenueTrendMap
      ).sort((a, b) =>
        a.name.localeCompare(b.name)
      );

      /*
       * Response used by Organizer.jsx
       */
      res.json({
        totalEvents: events.length,

        approved: events.filter(
          (event) =>
            event.status === 'approved'
        ).length,

        pending: events.filter(
          (event) =>
            event.status === 'pending'
        ).length,

        ticketsSold,

        revenue,

        attended,

        attendanceRate,

        averageRating,

        feedbackCount,

        salesByEvent,

        revenueByEvent,

        revenueTrend,

        events: eventPerformance
      });
    } catch (error) {
      console.error(
        'Organizer analytics error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to load organizer analytics'
      });
    }
  }
);

export default router;