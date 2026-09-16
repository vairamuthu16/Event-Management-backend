import express from 'express';

import {
  User,
  Event,
  Registration,
  SupportTicket
} from '../models/index.js';

import {
  requireAuth,
  requireRole
} from '../middleware/auth.js';

const router = express.Router();

/*
|--------------------------------------------------------------------------
| ADMIN AUTHENTICATION
|--------------------------------------------------------------------------
*/

router.use(requireAuth);
router.use(requireRole('admin'));

/*
|--------------------------------------------------------------------------
| ADMIN OVERVIEW
|--------------------------------------------------------------------------
| GET /api/admin/overview
*/

router.get('/overview', async (req, res) => {
  try {
    const [
      users,
      organizers,
      attendees,
      events,
      pendingEvents,
      registrations,
      supportTickets
    ] = await Promise.all([
      User.countDocuments(),

      User.countDocuments({
        role: 'organizer'
      }),

      User.countDocuments({
        role: 'attendee'
      }),

      Event.countDocuments(),

      Event.countDocuments({
        status: 'pending'
      }),

      Registration.countDocuments(),

      SupportTicket.countDocuments({
        status: {
          $in: ['open', 'pending']
        }
      })
    ]);

    const revenueResult = await Registration.aggregate([
      {
        $match: {
          status: {
            $in: ['paid', 'confirmed', 'completed']
          }
        }
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $ifNull: ['$amount', 0]
            }
          }
        }
      }
    ]);

    const revenue =
      revenueResult.length > 0
        ? revenueResult[0].total
        : 0;

    res.json({
      users,
      organizers,
      attendees,
      events,
      pendingEvents,
      registrations,
      supportTickets,
      revenue
    });

  } catch (error) {
    console.error('Admin overview error:', error);

    res.status(500).json({
      message: 'Failed to load admin overview'
    });
  }
});

/*
|--------------------------------------------------------------------------
| ADMIN EVENTS
|--------------------------------------------------------------------------
| GET /api/admin/events
*/

router.get('/events', async (req, res) => {
  try {
    const events = await Event.find()
      .sort({
        createdAt: -1
      })
      .populate(
        'organizer',
        'name email role'
      );

    res.json(events);

  } catch (error) {
    console.error('Admin events error:', error);

    res.status(500).json({
      message: 'Failed to load events'
    });
  }
});

/*
|--------------------------------------------------------------------------
| APPROVE / REJECT EVENT
|--------------------------------------------------------------------------
| PATCH /api/admin/events/:id/status
|
| Body:
| {
|   "status": "approved"
| }
|
| or
|
| {
|   "status": "rejected"
| }
*/

router.patch('/events/:id/status', async (req, res) => {
  try {
    const {
      status
    } = req.body;

    const allowedStatuses = [
      'pending',
      'approved',
      'rejected'
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        message:
          'Invalid status. Use pending, approved, or rejected.'
      });
    }

    const event = await Event.findByIdAndUpdate(
      req.params.id,
      {
        status
      },
      {
        new: true,
        runValidators: true
      }
    ).populate(
      'organizer',
      'name email role'
    );

    if (!event) {
      return res.status(404).json({
        message: 'Event not found'
      });
    }

    res.json(event);

  } catch (error) {
    console.error(
      'Update event status error:',
      error
    );

    res.status(500).json({
      message: 'Failed to update event status'
    });
  }
});

/*
|--------------------------------------------------------------------------
| ADMIN USERS
|--------------------------------------------------------------------------
| GET /api/admin/users
*/

router.get('/users', async (req, res) => {
  try {
    const users = await User.find()
      .select('-passwordHash')
      .sort({
        createdAt: -1
      });

    res.json(users);

  } catch (error) {
    console.error('Admin users error:', error);

    res.status(500).json({
      message: 'Failed to load users'
    });
  }
});

/*
|--------------------------------------------------------------------------
| CHANGE USER ROLE
|--------------------------------------------------------------------------
| PATCH /api/admin/users/:id/role
|
| Body:
| {
|   "role": "organizer"
| }
*/

router.patch('/users/:id/role', async (req, res) => {
  try {
    const {
      role
    } = req.body;

    const allowedRoles = [
      'attendee',
      'organizer',
      'admin'
    ];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        message:
          'Invalid role. Use attendee, organizer, or admin.'
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        role
      },
      {
        new: true,
        runValidators: true
      }
    ).select('-passwordHash');

    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      });
    }

    res.json(user);

  } catch (error) {
    console.error(
      'Update user role error:',
      error
    );

    res.status(500).json({
      message: 'Failed to update user role'
    });
  }
});

/*
|--------------------------------------------------------------------------
| ADMIN TRANSACTIONS
|--------------------------------------------------------------------------
| GET /api/admin/transactions
*/

router.get('/transactions', async (req, res) => {
  try {
    const transactions = await Registration.find()
      .sort({
        createdAt: -1
      })
      .populate(
        'user',
        'name email'
      )
      .populate(
        'event',
        'title date location'
      );

    res.json(transactions);

  } catch (error) {
    console.error(
      'Admin transactions error:',
      error
    );

    res.status(500).json({
      message: 'Failed to load transactions'
    });
  }
});

/*
|--------------------------------------------------------------------------
| ADMIN REPORTS
|--------------------------------------------------------------------------
| GET /api/admin/reports
|
| Returns dashboard/report statistics.
|--------------------------------------------------------------------------
*/

router.get('/reports', async (req, res) => {
  try {
    const [
      totalUsers,
      totalOrganizers,
      totalAttendees,
      totalEvents,
      approvedEvents,
      pendingEvents,
      rejectedEvents,
      totalRegistrations,
      attendedRegistrations
    ] = await Promise.all([
      User.countDocuments(),

      User.countDocuments({
        role: 'organizer'
      }),

      User.countDocuments({
        role: 'attendee'
      }),

      Event.countDocuments(),

      Event.countDocuments({
        status: 'approved'
      }),

      Event.countDocuments({
        status: 'pending'
      }),

      Event.countDocuments({
        status: 'rejected'
      }),

      Registration.countDocuments(),

      Registration.countDocuments({
        attended: true
      })
    ]);

    const revenueResult =
      await Registration.aggregate([
        {
          $match: {
            status: {
              $in: [
                'paid',
                'confirmed',
                'completed'
              ]
            }
          }
        },
        {
          $group: {
            _id: null,

            totalRevenue: {
              $sum: {
                $ifNull: [
                  '$amount',
                  0
                ]
              }
            },

            transactionCount: {
              $sum: 1
            }
          }
        }
      ]);

    const revenue =
      revenueResult.length > 0
        ? revenueResult[0].totalRevenue
        : 0;

    const transactionCount =
      revenueResult.length > 0
        ? revenueResult[0].transactionCount
        : 0;

    const attendanceRate =
      totalRegistrations > 0
        ? Number(
            (
              (attendedRegistrations /
                totalRegistrations) *
              100
            ).toFixed(2)
          )
        : 0;

    res.json({
      users: {
        total: totalUsers,
        organizers: totalOrganizers,
        attendees: totalAttendees
      },

      events: {
        total: totalEvents,
        approved: approvedEvents,
        pending: pendingEvents,
        rejected: rejectedEvents
      },

      registrations: {
        total: totalRegistrations,
        attended: attendedRegistrations,
        attendanceRate
      },

      revenue: {
        total: revenue,
        transactions: transactionCount
      }
    });

  } catch (error) {
    console.error(
      'Admin reports error:',
      error
    );

    res.status(500).json({
      message: 'Failed to load admin reports'
    });
  }
});

/*
|--------------------------------------------------------------------------
| ADMIN SUPPORT TICKETS
|--------------------------------------------------------------------------
| GET /api/admin/support
|--------------------------------------------------------------------------
*/

router.get('/support', async (req, res) => {
  try {
    const tickets = await SupportTicket.find()
      .sort({
        createdAt: -1
      })
      .populate(
        'user',
        'name email role'
      );

    res.json(tickets);

  } catch (error) {
    console.error(
      'Admin support error:',
      error
    );

    res.status(500).json({
      message: 'Failed to load support tickets'
    });
  }
});

/*
|--------------------------------------------------------------------------
| UPDATE SUPPORT TICKET
|--------------------------------------------------------------------------
| PATCH /api/admin/support/:id
|
| Body:
| {
|   "status": "resolved"
| }
|
| Optional:
| {
|   "status": "resolved",
|   "adminResponse": "Your issue has been resolved."
| }
|--------------------------------------------------------------------------
*/

router.patch('/support/:id', async (req, res) => {
  try {
    const {
      status,
      adminResponse
    } = req.body;

    const allowedStatuses = [
      'open',
      'pending',
      'resolved',
      'closed'
    ];

    const update = {};

    if (status !== undefined) {
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          message:
            'Invalid support ticket status'
        });
      }

      update.status = status;
    }

    if (adminResponse !== undefined) {
      update.adminResponse =
        String(adminResponse).trim();
    }

    const ticket =
      await SupportTicket.findByIdAndUpdate(
        req.params.id,
        update,
        {
          new: true,
          runValidators: true
        }
      ).populate(
        'user',
        'name email role'
      );

    if (!ticket) {
      return res.status(404).json({
        message: 'Support ticket not found'
      });
    }

    res.json(ticket);

  } catch (error) {
    console.error(
      'Update support ticket error:',
      error
    );

    res.status(500).json({
      message:
        'Failed to update support ticket'
    });
  }
});

/*
|--------------------------------------------------------------------------
| REGISTRATION ATTENDANCE
|--------------------------------------------------------------------------
| PATCH /api/admin/registrations/:id/attendance
|
| Body:
| {
|   "attended": true
| }
|--------------------------------------------------------------------------
*/

router.patch(
  '/registrations/:id/attendance',
  async (req, res) => {
    try {
      const {
        attended
      } = req.body;

      if (typeof attended !== 'boolean') {
        return res.status(400).json({
          message:
            'attended must be true or false'
        });
      }

      const registration =
        await Registration.findByIdAndUpdate(
          req.params.id,
          {
            attended
          },
          {
            new: true,
            runValidators: true
          }
        )
          .populate(
            'user',
            'name email'
          )
          .populate(
            'event',
            'title date location'
          );

      if (!registration) {
        return res.status(404).json({
          message:
            'Registration not found'
        });
      }

      res.json(registration);

    } catch (error) {
      console.error(
        'Attendance update error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to update attendance'
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| END
|--------------------------------------------------------------------------
*/

export default router;