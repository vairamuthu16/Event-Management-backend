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


// ============================================================
// ADMIN AUTHENTICATION
// ============================================================

router.use(
  requireAuth,
  requireRole('admin')
);


// ============================================================
// HELPER
// ============================================================

const paidFilter = {
  paymentStatus: 'paid'
};


// ============================================================
// OVERVIEW
// GET /api/admin/overview
// ============================================================

router.get('/overview', async (req, res) => {
  try {
    const [
      users,
      organizers,
      attendees,
      events,
      pendingEvents,
      registrations,
      supportTickets,
      revenueResult
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

      Registration.countDocuments(
        paidFilter
      ),

      SupportTicket.countDocuments({
        status: {
          $in: [
            'open',
            'in_progress'
          ]
        }
      }),

      Registration.aggregate([
        {
          $match: paidFilter
        },
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $ifNull: [
                  '$amount',
                  0
                ]
              }
            }
          }
        }
      ])

    ]);


    const revenue =
      Number(
        revenueResult?.[0]?.total
      ) || 0;


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

    console.error(
      'Admin overview error:',
      error
    );

    res.status(500).json({
      message:
        'Failed to load admin overview'
    });
  }
});


// ============================================================
// ALL EVENTS
// GET /api/admin/events
// ============================================================

router.get('/events', async (req, res) => {
  try {

    const events =
      await Event.find()
        .populate(
          'organizer',
          'name email role'
        )
        .sort({
          createdAt: -1
        });

    res.json(events);

  } catch (error) {

    console.error(
      'Admin events error:',
      error
    );

    res.status(500).json({
      message:
        'Failed to load events'
    });
  }
});


// ============================================================
// APPROVE / REJECT EVENT
// PATCH /api/admin/events/:id/status
// ============================================================

router.patch(
  '/events/:id/status',
  async (req, res) => {

    try {

      const {
        status
      } = req.body;


      const allowedStatuses = [
        'pending',
        'approved',
        'rejected'
      ];


      if (
        !allowedStatuses.includes(
          status
        )
      ) {
        return res.status(400).json({
          message:
            'Invalid event status'
        });
      }


      const event =
        await Event.findByIdAndUpdate(
          req.params.id,
          {
            status
          },
          {
            new: true,
            runValidators: true
          }
        )
        .populate(
          'organizer',
          'name email role'
        );


      if (!event) {
        return res.status(404).json({
          message:
            'Event not found'
        });
      }


      res.json(event);

    } catch (error) {

      console.error(
        'Update event status error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to update event status'
      });
    }
  }
);


// ============================================================
// USERS
// GET /api/admin/users
// ============================================================

router.get('/users', async (req, res) => {
  try {

    const users =
      await User.find()
        .select(
          '-passwordHash'
        )
        .sort({
          createdAt: -1
        });

    res.json(users);

  } catch (error) {

    console.error(
      'Admin users error:',
      error
    );

    res.status(500).json({
      message:
        'Failed to load users'
    });
  }
});


// ============================================================
// UPDATE USER ROLE
// PATCH /api/admin/users/:id/role
// ============================================================

router.patch(
  '/users/:id/role',
  async (req, res) => {

    try {

      const {
        role
      } = req.body;


      const allowedRoles = [
        'attendee',
        'organizer',
        'admin'
      ];


      if (
        !allowedRoles.includes(
          role
        )
      ) {
        return res.status(400).json({
          message:
            'Invalid user role'
        });
      }


      const user =
        await User.findByIdAndUpdate(
          req.params.id,
          {
            role
          },
          {
            new: true,
            runValidators: true
          }
        )
        .select(
          '-passwordHash'
        );


      if (!user) {
        return res.status(404).json({
          message:
            'User not found'
        });
      }


      res.json(user);

    } catch (error) {

      console.error(
        'Update user role error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to update user role'
      });
    }
  }
);


// ============================================================
// TRANSACTIONS
// GET /api/admin/transactions
// ============================================================

router.get(
  '/transactions',
  async (req, res) => {

    try {

      const transactions =
        await Registration.find(
          paidFilter
        )
        .populate(
          'user',
          'name email'
        )
        .populate(
          'event',
          'title date status organizer'
        )
        .sort({
          createdAt: -1
        });


      res.json(
        transactions
      );

    } catch (error) {

      console.error(
        'Admin transactions error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to load transactions'
      });
    }
  }
);


// ============================================================
// REPORTS
// GET /api/admin/reports
// ============================================================

router.get(
  '/reports',
  async (req, res) => {

    try {

      // --------------------------------------------------------
      // EVENT STATISTICS
      // --------------------------------------------------------

      const eventStats =
        await Registration.aggregate([

          {
            $match: paidFilter
          },

          {
            $group: {
              _id: '$event',

              tickets: {
                $sum: {
                  $ifNull: [
                    '$quantity',
                    1
                  ]
                }
              },

              revenue: {
                $sum: {
                  $ifNull: [
                    '$amount',
                    0
                  ]
                }
              },

              attended: {
                $sum: {
                  $cond: [
                    {
                      $eq: [
                        '$attended',
                        true
                      ]
                    },
                    {
                      $ifNull: [
                        '$quantity',
                        1
                      ]
                    },
                    0
                  ]
                }
              }
            }
          },

          {
            $lookup: {
              from: 'events',
              localField: '_id',
              foreignField: '_id',
              as: 'event'
            }
          },

          {
            $unwind: {
              path: '$event',
              preserveNullAndEmptyArrays: true
            }
          },

          {
            $project: {
              _id: 0,

              eventId: '$_id',

              name: {
                $ifNull: [
                  '$event.title',
                  'Unknown event'
                ]
              },

              tickets: 1,

              revenue: 1,

              attended: 1,

              attendanceRate: {
                $cond: [
                  {
                    $gt: [
                      '$tickets',
                      0
                    ]
                  },
                  {
                    $multiply: [
                      {
                        $divide: [
                          '$attended',
                          '$tickets'
                        ]
                      },
                      100
                    ]
                  },
                  0
                ]
              }
            }
          },

          {
            $sort: {
              revenue: -1
            }
          }

        ]);


      // --------------------------------------------------------
      // MONTHLY REVENUE
      // --------------------------------------------------------

      const monthly =
        await Registration.aggregate([

          {
            $match: paidFilter
          },

          {
            $group: {
              _id: {
                year: {
                  $year: '$createdAt'
                },

                month: {
                  $month: '$createdAt'
                }
              },

              revenue: {
                $sum: {
                  $ifNull: [
                    '$amount',
                    0
                  ]
                }
              },

              tickets: {
                $sum: {
                  $ifNull: [
                    '$quantity',
                    1
                  ]
                }
              }
            }
          },

          {
            $sort: {
              '_id.year': 1,
              '_id.month': 1
            }
          },

          {
            $project: {
              _id: {
                $concat: [
                  {
                    $toString:
                      '$_id.year'
                  },
                  '-',
                  {
                    $cond: [
                      {
                        $lt: [
                          '$_id.month',
                          10
                        ]
                      },
                      '0',
                      ''
                    ]
                  },
                  {
                    $toString:
                      '$_id.month'
                  }
                ]
              },

              revenue: 1,

              tickets: 1
            }
          }

        ]);


      // --------------------------------------------------------
      // ATTENDANCE
      // --------------------------------------------------------

      const attendanceResult =
        await Registration.aggregate([

          {
            $match: paidFilter
          },

          {
            $group: {
              _id: null,

              tickets: {
                $sum: {
                  $ifNull: [
                    '$quantity',
                    1
                  ]
                }
              },

              attended: {
                $sum: {
                  $cond: [
                    {
                      $eq: [
                        '$attended',
                        true
                      ]
                    },
                    {
                      $ifNull: [
                        '$quantity',
                        1
                      ]
                    },
                    0
                  ]
                }
              }
            }
          }

        ]);


      const attendance =
        attendanceResult?.[0] || {
          tickets: 0,
          attended: 0
        };


      const attendanceRate =
        Number(
          attendance.tickets
        ) > 0
          ? (
              Number(
                attendance.attended
              ) /
              Number(
                attendance.tickets
              )
            ) * 100
          : 0;


      // --------------------------------------------------------
      // FEEDBACK / RATINGS
      // --------------------------------------------------------

      const feedbackResult =
        await Registration.aggregate([

          {
            $match: {
              'feedback.rating': {
                $gte: 1,
                $lte: 5
              }
            }
          },

          {
            $group: {
              _id: null,

              average: {
                $avg:
                  '$feedback.rating'
              },

              count: {
                $sum: 1
              }
            }
          }

        ]);


      const feedback =
        feedbackResult?.[0]
          ? {
              average:
                Number(
                  feedbackResult[0]
                    .average
                ) || 0,

              count:
                Number(
                  feedbackResult[0]
                    .count
                ) || 0
            }
          : {
              average: 0,
              count: 0
            };


      // --------------------------------------------------------
      // TOTAL REVENUE
      // --------------------------------------------------------

      const revenueResult =
        await Registration.aggregate([

          {
            $match: paidFilter
          },

          {
            $group: {
              _id: null,

              total: {
                $sum: {
                  $ifNull: [
                    '$amount',
                    0
                  ]
                }
              }
            }
          }

        ]);


      const totalRevenue =
        Number(
          revenueResult?.[0]?.total
        ) || 0;


      // --------------------------------------------------------
      // TOTAL PAID REGISTRATIONS
      // --------------------------------------------------------

      const totalRegistrations =
        await Registration.countDocuments(
          paidFilter
        );


      // --------------------------------------------------------
      // RESPONSE
      // --------------------------------------------------------

      res.json({

        // Existing frontend fields
        eventStats,

        monthly,

        feedback,


        // Additional useful report data
        revenue:
          totalRevenue,

        registrations:
          totalRegistrations,

        attendance: {
          tickets:
            Number(
              attendance.tickets
            ) || 0,

          attended:
            Number(
              attendance.attended
            ) || 0,

          rate:
            Number(
              attendanceRate.toFixed(2)
            )
        }

      });

    } catch (error) {

      console.error(
        'Admin reports error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to load admin reports'
      });
    }
  }
);


// ============================================================
// SUPPORT
// GET /api/admin/support
// ============================================================

router.get(
  '/support',
  async (req, res) => {

    try {

      const tickets =
        await SupportTicket.find()
          .populate(
            'user',
            'name email'
          )
          .sort({
            createdAt: -1
          });

      res.json(
        tickets
      );

    } catch (error) {

      console.error(
        'Admin support error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to load support tickets'
      });
    }
  }
);


// ============================================================
// UPDATE SUPPORT
// PATCH /api/admin/support/:id
// ============================================================

router.patch(
  '/support/:id',
  async (req, res) => {

    try {

      const {
        status,
        adminReply
      } = req.body;


      const allowedStatuses = [
        'open',
        'in_progress',
        'resolved'
      ];


      if (
        status &&
        !allowedStatuses.includes(
          status
        )
      ) {
        return res.status(400).json({
          message:
            'Invalid support status'
        });
      }


      const update = {};


      if (status) {
        update.status = status;
      }


      if (
        adminReply !== undefined
      ) {
        update.adminReply =
          String(
            adminReply || ''
          ).trim();
      }


      const ticket =
        await SupportTicket.findByIdAndUpdate(
          req.params.id,
          update,
          {
            new: true,
            runValidators: true
          }
        )
        .populate(
          'user',
          'name email'
        );


      if (!ticket) {
        return res.status(404).json({
          message:
            'Support ticket not found'
        });
      }


      res.json(ticket);

    } catch (error) {

      console.error(
        'Update support error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to update support ticket'
      });
    }
  }
);


// ============================================================
// MARK REGISTRATION ATTENDANCE
// PATCH /api/admin/registrations/:id/attendance
// ============================================================

router.patch(
  '/registrations/:id/attendance',
  async (req, res) => {

    try {

      const {
        attended
      } = req.body;


      const registration =
        await Registration.findById(
          req.params.id
        );


      if (!registration) {
        return res.status(404).json({
          message:
            'Registration not found'
        });
      }


      registration.attended =
        Boolean(attended);


      await registration.save();


      const updatedRegistration =
        await Registration.findById(
          registration._id
        )
        .populate(
          'user',
          'name email'
        )
        .populate(
          'event',
          'title date status organizer'
        );


      res.json(
        updatedRegistration
      );

    } catch (error) {

      console.error(
        'Update attendance error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to update attendance'
      });
    }
  }
);

/* | CREATE ADMIN ACCOUNT
|--------------------------------------------------------------------------
| POST /api/admin/users
|--------------------------------------------------------------------------
*/

router.post(
  '/users',
  async (req, res) => {
    try {
      const {
        name,
        email,
        password
      } = req.body;

      const normalizedEmail =
        String(email || '')
          .trim()
          .toLowerCase();

      if (
        !name ||
        !normalizedEmail ||
        !password
      ) {
        return res.status(400).json({
          message:
            'Name, email and password are required'
        });
      }

      if (String(password).length < 6) {
        return res.status(400).json({
          message:
            'Password must be at least 6 characters'
        });
      }

      const existingUser =
        await User.findOne({
          email: normalizedEmail
        });

      if (existingUser) {
        return res.status(409).json({
          message:
            'Email already registered'
        });
      }

      const bcrypt =
        await import('bcryptjs');

      const passwordHash =
        await bcrypt.default.hash(
          String(password),
          12
        );

      const admin =
        await User.create({
          name: String(name).trim(),

          email: normalizedEmail,

          passwordHash,

          role: 'admin'
        });

      const publicAdmin = {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        avatar: admin.avatar
      };

      res.status(201).json(
        publicAdmin
      );

    } catch (error) {
      console.error(
        'Create admin account error:',
        error
      );

      res.status(500).json({
        message:
          'Failed to create admin account'
      });
    }
  }
);

export default router;