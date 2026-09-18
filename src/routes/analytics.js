import express from 'express';
import mongoose from 'mongoose';

import {
  Event,
  Registration
} from '../models/index.js';

import {
  requireAuth,
  requireRole
} from '../middleware/auth.js';

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function toNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

function round(value, decimals = 1) {
  const multiplier =
    10 ** decimals;

  return (
    Math.round(
      Number(value) * multiplier
    ) / multiplier
  );
}

/*
|--------------------------------------------------------------------------
| GET /api/analytics/organizer
|--------------------------------------------------------------------------
|
| Organizer dashboard analytics.
|
| Returns:
| - totalEvents
| - ticketsSold
| - revenue
| - attendanceRate
| - averageRating
| - feedbackCount
| - totalAttended
| - salesByEvent
| - revenueByEvent
| - attendanceByEvent
| - revenueTrend
| - events
|
|--------------------------------------------------------------------------
*/

router.get(
  '/organizer',
  requireAuth,
  requireRole('organizer'),
  async (req, res) => {
    try {
      const organizerId =
        req.user._id;

      /*
      |--------------------------------------------------------------------------
      | Load organizer events
      |--------------------------------------------------------------------------
      */

      const events =
        await Event.find({
          organizer: organizerId
        })
          .sort({
            date: 1
          })
          .lean();

      const eventIds =
        events.map(
          (event) =>
            event._id
        );

      /*
      |--------------------------------------------------------------------------
      | If organizer has no events
      |--------------------------------------------------------------------------
      */

      if (!eventIds.length) {
        return res.json({
          totalEvents: 0,
          ticketsSold: 0,
          revenue: 0,
          attendanceRate: 0,
          averageRating: 0,
          feedbackCount: 0,
          totalAttended: 0,

          salesByEvent: [],
          revenueByEvent: [],
          attendanceByEvent: [],
          revenueTrend: [],

          events: []
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Load registrations
      |--------------------------------------------------------------------------
      |
      | We intentionally load all registrations for these events.
      |
      | Paid registrations are used for:
      | - tickets sold
      | - revenue
      | - attendance
      | - attendee feedback
      |
      */

      const registrations =
        await Registration.find({
          event: {
            $in: eventIds
          }
        }).lean();

      /*
      |--------------------------------------------------------------------------
      | Create event map
      |--------------------------------------------------------------------------
      */

      const eventMap =
        new Map();

      events.forEach(
        (event) => {
          eventMap.set(
            String(event._id),
            event
          );
        }
      );

      /*
      |--------------------------------------------------------------------------
      | Create statistics map
      |--------------------------------------------------------------------------
      */

      const statistics =
        new Map();

      events.forEach(
        (event) => {
          statistics.set(
            String(event._id),
            {
              id: event._id,

              title:
                event.title,

              status:
                event.status,

              sold: 0,

              attended: 0,

              revenue: 0,

              feedbackCount: 0,

              ratingTotal: 0,

              averageRating: 0,

              attendanceRate: 0
            }
          );
        }
      );

      /*
      |--------------------------------------------------------------------------
      | Process registrations
      |--------------------------------------------------------------------------
      */

      registrations.forEach(
        (registration) => {
          const eventId =
            String(
              registration.event
            );

          const stats =
            statistics.get(
              eventId
            );

          if (!stats) {
            return;
          }

          /*
          |--------------------------------------------------------------------------
          | Only paid registrations count as sales.
          |--------------------------------------------------------------------------
          */

          const isPaid =
            registration.paymentStatus ===
            'paid';

          if (!isPaid) {
            return;
          }

          /*
          |--------------------------------------------------------------------------
          | Quantity
          |--------------------------------------------------------------------------
          */

          const quantity =
            Math.max(
              0,
              toNumber(
                registration.quantity
              )
            );

          /*
          |--------------------------------------------------------------------------
          | Tickets sold
          |--------------------------------------------------------------------------
          */

          stats.sold +=
            quantity;

          /*
          |--------------------------------------------------------------------------
          | Revenue
          |--------------------------------------------------------------------------
          */

          stats.revenue +=
            toNumber(
              registration.amount
            );

          /*
          |--------------------------------------------------------------------------
          | Attendance
          |--------------------------------------------------------------------------
          |
          | One registration can contain
          | multiple tickets.
          |
          | If attended=true, count the
          | registration quantity.
          |--------------------------------------------------------------------------
          */

          if (
            registration.attended ===
            true
          ) {
            stats.attended +=
              quantity;
          }

          /*
          |--------------------------------------------------------------------------
          | Feedback
          |--------------------------------------------------------------------------
          */

          const rating =
            toNumber(
              registration
                .feedback
                ?.rating
            );

          if (
            rating >= 1 &&
            rating <= 5
          ) {
            stats.ratingTotal +=
              rating;

            stats.feedbackCount +=
              1;
          }
        }
      );

      /*
      |--------------------------------------------------------------------------
      | Calculate event-level metrics
      |--------------------------------------------------------------------------
      */

      const eventPerformance =
        Array.from(
          statistics.values()
        ).map(
          (stats) => {
            const attendanceRate =
              stats.sold > 0
                ? (
                    stats.attended /
                    stats.sold
                  ) *
                  100
                : 0;

            const averageRating =
              stats.feedbackCount >
              0
                ? stats.ratingTotal /
                  stats.feedbackCount
                : 0;

            return {
              _id: stats.id,

              id: stats.id,

              title:
                stats.title,

              status:
                stats.status,

              sold:
                stats.sold,

              attended:
                stats.attended,

              attendanceRate:
                round(
                  attendanceRate,
                  1
                ),

              revenue:
                round(
                  stats.revenue,
                  2
                ),

              averageRating:
                round(
                  averageRating,
                  1
                ),

              feedbackCount:
                stats.feedbackCount
            };
          }
        );

      /*
      |--------------------------------------------------------------------------
      | Summary metrics
      |--------------------------------------------------------------------------
      */

      const totalEvents =
        events.length;

      const ticketsSold =
        eventPerformance.reduce(
          (
            total,
            event
          ) =>
            total +
            event.sold,
          0
        );

      const totalAttended =
        eventPerformance.reduce(
          (
            total,
            event
          ) =>
            total +
            event.attended,
          0
        );

      const revenue =
        eventPerformance.reduce(
          (
            total,
            event
          ) =>
            total +
            event.revenue,
          0
        );

      /*
      |--------------------------------------------------------------------------
      | Overall attendance rate
      |--------------------------------------------------------------------------
      */

      const attendanceRate =
        ticketsSold > 0
          ? (
              totalAttended /
              ticketsSold
            ) *
            100
          : 0;

      /*
      |--------------------------------------------------------------------------
      | Overall rating
      |--------------------------------------------------------------------------
      |
      | Weighted by feedback count.
      |
      | Example:
      |
      | Event A = 5 rating, 1 feedback
      | Event B = 4 rating, 3 feedback
      |
      | Overall:
      |
      | (5×1 + 4×3) / 4
      |--------------------------------------------------------------------------
      */

      let ratingTotal = 0;

      let feedbackCount = 0;

      eventPerformance.forEach(
        (event) => {
          if (
            event.averageRating >
              0 &&
            event.feedbackCount >
              0
          ) {
            ratingTotal +=
              event.averageRating *
              event.feedbackCount;

            feedbackCount +=
              event.feedbackCount;
          }
        }
      );

      const averageRating =
        feedbackCount > 0
          ? ratingTotal /
            feedbackCount
          : 0;

      /*
      |--------------------------------------------------------------------------
      | Sales by event
      |--------------------------------------------------------------------------
      */

      const salesByEvent =
        eventPerformance.map(
          (event) => ({
            id: event.id,

            name:
              event.title,

            title:
              event.title,

            value:
              event.sold,

            sold:
              event.sold
          })
        );

      /*
      |--------------------------------------------------------------------------
      | Revenue by event
      |--------------------------------------------------------------------------
      */

      const revenueByEvent =
        eventPerformance.map(
          (event) => ({
            id: event.id,

            name:
              event.title,

            title:
              event.title,

            value:
              event.revenue,

            revenue:
              event.revenue
          })
        );

      /*
      |--------------------------------------------------------------------------
      | Attendance by event
      |--------------------------------------------------------------------------
      */

      const attendanceByEvent =
        eventPerformance.map(
          (event) => ({
            id: event.id,

            name:
              event.title,

            title:
              event.title,

            value:
              event.attendanceRate,

            attendanceRate:
              event.attendanceRate,

            sold:
              event.sold,

            attended:
              event.attended
          })
        );

      /*
      |--------------------------------------------------------------------------
      | Revenue trend
      |--------------------------------------------------------------------------
      |
      | Group paid registrations by date.
      |--------------------------------------------------------------------------
      */

      const revenueTrendMap =
        new Map();

      registrations.forEach(
        (registration) => {
          if (
            registration.paymentStatus !==
            'paid'
          ) {
            return;
          }

          const event =
            eventMap.get(
              String(
                registration.event
              )
            );

          if (!event) {
            return;
          }

          const createdAt =
            registration.createdAt;

          if (!createdAt) {
            return;
          }

          const date =
            new Date(
              createdAt
            );

          if (
            Number.isNaN(
              date.getTime()
            )
          ) {
            return;
          }

          /*
            YYYY-MM-DD
          */

          const key =
            date
              .toISOString()
              .slice(0, 10);

          const existing =
            revenueTrendMap.get(
              key
            ) || {
              date: key,
              revenue: 0,
              ticketsSold: 0
            };

          existing.revenue +=
            toNumber(
              registration.amount
            );

          existing.ticketsSold +=
            Math.max(
              0,
              toNumber(
                registration.quantity
              )
            );

          revenueTrendMap.set(
            key,
            existing
          );
        }
      );

      const revenueTrend =
        Array.from(
          revenueTrendMap.values()
        )
          .sort(
            (a, b) =>
              new Date(a.date) -
              new Date(b.date)
          )
          .map(
            (item) => ({
              ...item,

              revenue:
                round(
                  item.revenue,
                  2
                )
            })
          );

      /*
      |--------------------------------------------------------------------------
      | Final response
      |--------------------------------------------------------------------------
      */

      return res.json({
        totalEvents,

        ticketsSold,

        revenue:
          round(
            revenue,
            2
          ),

        attendanceRate:
          round(
            attendanceRate,
            1
          ),

        averageRating:
          round(
            averageRating,
            1
          ),

        feedbackCount,

        totalAttended,

        salesByEvent,

        revenueByEvent,

        attendanceByEvent,

        revenueTrend,

        events:
          eventPerformance
      });
    } catch (error) {
      console.error(
        'Organizer analytics error:',
        error
      );

      return res.status(500).json({
        message:
          'Failed to load organizer analytics.'
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| GET /api/analytics/event/:eventId
|--------------------------------------------------------------------------
|
| Analytics for one event.
|
| Accessible to:
| - organizer who owns the event
| - admin
|
|--------------------------------------------------------------------------
*/

router.get(
  '/event/:eventId',
  requireAuth,
  requireRole(
    'organizer',
    'admin'
  ),
  async (req, res) => {
    try {
      const {
        eventId
      } = req.params;

      if (
        !mongoose.Types.ObjectId.isValid(
          eventId
        )
      ) {
        return res.status(400).json({
          message:
            'Invalid event ID.'
        });
      }

      const event =
        await Event.findById(
          eventId
        ).lean();

      if (!event) {
        return res.status(404).json({
          message:
            'Event not found.'
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Organizer ownership check
      |--------------------------------------------------------------------------
      */

      if (
        req.user.role ===
          'organizer' &&
        String(
          event.organizer
        ) !==
          String(
            req.user._id
          )
      ) {
        return res.status(403).json({
          message:
            'You can only view analytics for your own events.'
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Registrations
      |--------------------------------------------------------------------------
      */

      const registrations =
        await Registration.find({
          event: eventId
        }).lean();

      let ticketsSold = 0;

      let revenue = 0;

      let attended = 0;

      let feedbackCount = 0;

      let ratingTotal = 0;

      registrations.forEach(
        (registration) => {
          if (
            registration.paymentStatus !==
            'paid'
          ) {
            return;
          }

          const quantity =
            Math.max(
              0,
              toNumber(
                registration.quantity
              )
            );

          ticketsSold +=
            quantity;

          revenue +=
            toNumber(
              registration.amount
            );

          if (
            registration.attended ===
            true
          ) {
            attended +=
              quantity;
          }

          const rating =
            toNumber(
              registration
                .feedback
                ?.rating
            );

          if (
            rating >= 1 &&
            rating <= 5
          ) {
            ratingTotal +=
              rating;

            feedbackCount +=
              1;
          }
        }
      );

      const attendanceRate =
        ticketsSold > 0
          ? (
              attended /
              ticketsSold
            ) *
            100
          : 0;

      const averageRating =
        feedbackCount > 0
          ? ratingTotal /
            feedbackCount
          : 0;

      /*
      |--------------------------------------------------------------------------
      | Ticket inventory
      |--------------------------------------------------------------------------
      */

      const ticketTypes =
        (
          event.ticketTypes ||
          []
        ).map(
          (ticket) => {
            const quantity =
              toNumber(
                ticket.quantity
              );

            const sold =
              toNumber(
                ticket.sold
              );

            return {
              _id:
                ticket._id,

              name:
                ticket.name,

              price:
                toNumber(
                  ticket.price
                ),

              quantity,

              sold,

              available:
                Math.max(
                  0,
                  quantity -
                    sold
                )
            };
          }
        );

      /*
      |--------------------------------------------------------------------------
      | Response
      |--------------------------------------------------------------------------
      */

      return res.json({
        event: {
          _id:
            event._id,

          title:
            event.title,

          status:
            event.status,

          date:
            event.date,

          location:
            event.location
        },

        totalRegistrations:
          registrations.length,

        ticketsSold,

        attended,

        attendanceRate:
          round(
            attendanceRate,
            1
          ),

        revenue:
          round(
            revenue,
            2
          ),

        averageRating:
          round(
            averageRating,
            1
          ),

        feedbackCount,

        ticketTypes
      });
    } catch (error) {
      console.error(
        'Event analytics error:',
        error
      );

      return res.status(500).json({
        message:
          'Failed to load event analytics.'
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| GET /api/analytics/admin
|--------------------------------------------------------------------------
|
| Admin analytics.
|
| This is kept separate from organizer
| analytics so organizers only see their
| own events.
|
|--------------------------------------------------------------------------
*/

router.get(
  '/admin',
  requireAuth,
  requireRole('admin'),
  async (req, res) => {
    try {
      const events =
        await Event.find({})
          .sort({
            date: 1
          })
          .lean();

      const eventIds =
        events.map(
          (event) =>
            event._id
        );

      const registrations =
        eventIds.length
          ? await Registration.find({
              event: {
                $in: eventIds
              }
            }).lean()
          : [];

      let ticketsSold = 0;

      let revenue = 0;

      let attended = 0;

      let feedbackCount = 0;

      let ratingTotal = 0;

      registrations.forEach(
        (registration) => {
          if (
            registration.paymentStatus !==
            'paid'
          ) {
            return;
          }

          const quantity =
            Math.max(
              0,
              toNumber(
                registration.quantity
              )
            );

          ticketsSold +=
            quantity;

          revenue +=
            toNumber(
              registration.amount
            );

          if (
            registration.attended ===
            true
          ) {
            attended +=
              quantity;
          }

          const rating =
            toNumber(
              registration
                .feedback
                ?.rating
            );

          if (
            rating >= 1 &&
            rating <= 5
          ) {
            ratingTotal +=
              rating;

            feedbackCount +=
              1;
          }
        }
      );

      const attendanceRate =
        ticketsSold > 0
          ? (
              attended /
              ticketsSold
            ) *
            100
          : 0;

      const averageRating =
        feedbackCount > 0
          ? ratingTotal /
            feedbackCount
          : 0;

      return res.json({
        totalEvents:
          events.length,

        ticketsSold,

        revenue:
          round(
            revenue,
            2
          ),

        attended,

        attendanceRate:
          round(
            attendanceRate,
            1
          ),

        averageRating:
          round(
            averageRating,
            1
          ),

        feedbackCount
      });
    } catch (error) {
      console.error(
        'Admin analytics error:',
        error
      );

      return res.status(500).json({
        message:
          'Failed to load admin analytics.'
      });
    }
  }
);

export default router;