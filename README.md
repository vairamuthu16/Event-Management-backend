# EventHub — Complete MERN Event Management Platform

Assessment-ready event management platform built with React + Vite + TailwindCSS, Node.js + Express, MongoDB/Mongoose, JWT authentication, Razorpay Test Mode and Recharts.

## Features

### Attendee / User
- Secure registration and login
- Role-aware authentication
- User profile and password settings
- Search/filter approved events
- Event details, schedules and ticket types
- Razorpay payment flow
- Purchased ticket dashboard
- Registration cancellation
- Event feedback and ratings
- Support inquiry submission

### Organizer
- Dedicated `/organizer/login`
- Event creation/editing
- Ticket types and capacity
- Schedule management
- Approval status tracking
- Ticket sales and revenue KPIs
- Attendance tracking
- Attendance rate
- Event performance tables
- Recharts ticket/revenue graphs
- Revenue trend graph

### Admin
- Dedicated `/admin/login`
- Admin dashboard
- Event approval/rejection
- User account and role management
- Payment transaction monitoring
- Attendance marking
- Revenue and event reports
- Monthly revenue graph
- Ticket/revenue by event charts
- Attendee feedback reporting
- Support inquiry management

## Project structure

```text
client/src/
  components/
  context/
  pages/
  services/
  utils/
server/src/
  middleware/
  models/
  routes/
  scripts/
  utils/
```

## Setup

### 1. Backend

```bash
cd server
npm install
copy .env.example .env
```

Set `server/.env`:

```env
PORT=5000
MONGO_URI=mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/eventhub?retryWrites=true&w=majority
JWT_SECRET=replace-with-a-long-random-secret
CLIENT_URL=http://localhost:5173
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_razorpay_test_secret
ADMIN_NAME=Administrator
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-this-password
```

For Atlas, make sure your current IP is allowed in Network Access and the database user password is URL-encoded if it contains reserved URI characters.

Create/promote the admin:

```bash
npm run create-admin
```

Optional: create sample organizer/attendee accounts, approved events, paid registrations, attendance and feedback for a demo: 

```bash
npm run seed-demo
```

The demo defaults are `organizer@example.com`, `attendee@example.com`, password `Demo@12345`; change the `DEMO_*` environment variables if needed.

Start API:

```bash
npm run dev
```

### 2. Frontend

```bash
cd client
npm install
npm run dev
```

Open `http://localhost:5173`.

## Login routes

- Attendee: `/login`
- Organizer: `/organizer/login`
- Admin: `/admin/login`

Public registration can create attendee or organizer accounts. Admin accounts are created/promoted using `npm run create-admin`.

## Razorpay Test Mode

Use Razorpay Test Mode and `rzp_test_...` credentials. Never put the Key Secret in the frontend. Test Mode does not charge real money.

## Important security notes

- Never commit `.env` files.
- Never share MongoDB or Razorpay secrets.
- Rotate any credential that has been exposed.
- The backend verifies Razorpay signatures before marking a registration paid.

## Deployment

The client can be deployed to Netlify and the server to Render or another Node hosting provider. Set production environment variables and update `CLIENT_URL`/`VITE_API_URL` accordingly.

## Validation

The source files are kept separated for maintainability. Backend JavaScript syntax can be checked with `node --check`. Install dependencies locally and run `npm run build` in the client before deployment.
