import type { FastifyInstance } from 'fastify'
import { buildIcs, type IcsEvent } from '../lib/ics.js'

/** Public (token-authenticated) iCal feed that Google Calendar can subscribe to. */
export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  app.get('/calendar/:token/the-fold.ics', async (req, reply) => {
    const { token } = req.params as { token: string }
    const hh = app.db.prepare('SELECT id, name FROM households WHERE calendar_token = ?').get(token) as
      | { id: string; name: string }
      | undefined
    if (!hh) {
      reply.code(404)
      return { error: 'Unknown calendar' }
    }

    const events: IcsEvent[] = []

    const trips = app.db
      .prepare(
        `SELECT id, name, emoji, location, start_date, end_date FROM trips
         WHERE household_id = ? AND start_date IS NOT NULL AND status IN ('planned', 'active')`,
      )
      .all(hh.id) as { id: string; name: string; emoji: string | null; location: string | null; start_date: string; end_date: string | null }[]
    for (const trip of trips) {
      events.push({
        uid: `trip-${trip.id}`,
        title: `${trip.emoji ? trip.emoji + ' ' : ''}${trip.name}`,
        start: trip.start_date,
        end: trip.end_date ?? trip.start_date,
        location: trip.location ?? undefined,
        description: 'Trip planned in The Fold',
      })
    }

    const stops = app.db
      .prepare(
        `SELECT s.id, s.name, s.location, s.arrive_date, s.depart_date, s.lodging, t.name AS trip_name
         FROM trip_stops s JOIN trips t ON t.id = s.trip_id
         WHERE t.household_id = ? AND s.arrive_date IS NOT NULL AND t.status IN ('planned', 'active')`,
      )
      .all(hh.id) as { id: string; name: string; location: string | null; arrive_date: string; depart_date: string | null; lodging: string | null; trip_name: string }[]
    for (const stop of stops) {
      events.push({
        uid: `stop-${stop.id}`,
        title: `${stop.trip_name}: ${stop.name}`,
        start: stop.arrive_date,
        end: stop.depart_date ?? stop.arrive_date,
        location: stop.location ?? undefined,
        description: stop.lodging ? `Staying at ${stop.lodging}` : undefined,
      })
    }

    const items = app.db
      .prepare(
        `SELECT li.id, li.text, li.due_date, l.name AS list_name, u.name AS assignee
         FROM list_items li
         JOIN lists l ON l.id = li.list_id
         LEFT JOIN users u ON u.id = li.assignee_user_id
         WHERE l.household_id = ? AND li.due_date IS NOT NULL AND li.done = 0`,
      )
      .all(hh.id) as { id: string; text: string; due_date: string; list_name: string; assignee: string | null }[]
    for (const item of items) {
      events.push({
        uid: `item-${item.id}`,
        title: `☑️ ${item.text}${item.assignee ? ` (${item.assignee})` : ''}`,
        start: item.due_date,
        description: `From the "${item.list_name}" list in The Fold`,
      })
    }

    reply.header('Content-Type', 'text/calendar; charset=utf-8')
    return buildIcs(`${hh.name} — The Fold`, events)
  })
}
