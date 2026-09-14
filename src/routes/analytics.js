import express from 'express';
import { Event, Registration } from '../models/index.js';
import { protect, roles } from '../middleware/auth.js';

const router = express.Router();

router.get('/event/:eventId', protect, roles('organizer','admin'), async (req,res) => {
  const event = await Event.findById(req.params.eventId);
  if (!event) return res.status(404).json({message:'Event not found'});
  if (req.user.role !== 'admin' && String(event.organizer) !== String(req.user._id))
    return res.status(403).json({message:'Not your event'});
  const regs = await Registration.find({event:event._id});
  const paid = regs.filter(r=>r.paymentStatus==='paid' && r.status!=='cancelled');
  const ticketsSold = paid.reduce((s,r)=>s+r.quantity,0);
  const revenue = paid.reduce((s,r)=>s+r.amount,0);
  const byTicket = {};
  paid.forEach(r=>{ byTicket[String(r.ticketType)] = (byTicket[String(r.ticketType)]||0)+r.quantity; });
  res.json({
    event:{id:event._id,title:event.title,capacity:event.capacity||event.ticketTypes.reduce((s,t)=>s+t.quantity,0)},
    registrations:regs.length, ticketsSold, revenue,
    attendanceRate:event.capacity ? Math.round(ticketsSold/event.capacity*100) : 0,
    ticketBreakdown:event.ticketTypes.map(t=>({name:t.name,sold:byTicket[String(t._id)]||0,capacity:t.quantity,price:t.price}))
  });
});

router.get('/organizer', protect, roles('organizer','admin'), async (req,res) => {
  const filter = req.user.role==='admin' ? {} : {organizer:req.user._id};
  const events = await Event.find(filter);
  const ids = events.map(e=>e._id);
  const regs = await Registration.find({event:{$in:ids},paymentStatus:'paid'});
  const revenue = regs.reduce((s,r)=>s+r.amount,0);
  res.json({
    totalEvents:events.length,
    approved:events.filter(e=>e.status==='approved').length,
    pending:events.filter(e=>e.status==='pending').length,
    ticketsSold:regs.reduce((s,r)=>s+r.quantity,0),
    revenue,
    events:events.map(e=>{
      const er=regs.filter(r=>String(r.event)===String(e._id));
      return {id:e._id,title:e.title,status:e.status,sold:er.reduce((s,r)=>s+r.quantity,0),revenue:er.reduce((s,r)=>s+r.amount,0)};
    })
  });
});

export default router;
