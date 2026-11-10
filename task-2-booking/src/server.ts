import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { bookingRepo, masters, services } from './store.ts';
import { getSlots } from './slots.ts';
import { BookingError, cancelBooking, createBooking } from './booking.ts';
import { isDate } from './time.ts';

const port = Number(process.env.PORT ?? 3002);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    if (req.method === 'GET' && url.pathname === '/masters') {
      return send(res, 200, masters);
    }

    if (req.method === 'GET' && url.pathname === '/services') {
      return send(res, 200, services);
    }

    if (req.method === 'GET' && parts[0] === 'masters' && parts[2] === 'slots' && parts.length === 3) {
      const master = masters.find((m) => m.id === parts[1]);
      if (!master) return send(res, 404, { error: 'master_not_found' });

      const serviceId = url.searchParams.get('serviceId');
      const date = url.searchParams.get('date');
      if (!serviceId || !date || !isDate(date)) return send(res, 400, { error: 'bad_request' });

      const service = services.find((s) => s.id === serviceId);
      if (!service) return send(res, 404, { error: 'service_not_found' });
      if (!service.masterIds.includes(master.id)) {
        return send(res, 400, { error: 'service_not_available' });
      }

      const bookings = await bookingRepo.listByMaster(master.id);
      const slots = getSlots(master, service, date, bookings);
      return send(res, 200, { masterId: master.id, serviceId: service.id, date, slots });
    }

    if (req.method === 'POST' && url.pathname === '/bookings') {
      const body = await readJson(req);
      if (!body || typeof body !== 'object') return send(res, 400, { error: 'bad_request' });

      const input = body as Record<string, unknown>;
      const booking = await createBooking({
        masterId: input.masterId,
        serviceId: input.serviceId,
        start: input.start,
        clientPhone: input.clientPhone,
      });
      return send(res, 201, booking);
    }

    if (req.method === 'DELETE' && parts[0] === 'bookings' && parts.length === 2) {
      const booking = await cancelBooking(parts[1]);
      return send(res, 200, booking);
    }

    send(res, 404, { error: 'not_found' });
  } catch (err) {
    if (err instanceof BookingError) {
      return send(res, errorStatus(err.code), { error: err.code });
    }
    if (err instanceof SyntaxError) {
      return send(res, 400, { error: 'bad_request' });
    }
    console.error(err);
    send(res, 500, { error: 'internal' });
  }
});

function errorStatus(code: BookingError['code']): number {
  if (code === 'master_not_found' || code === 'service_not_found' || code === 'booking_not_found') {
    return 404;
  }
  if (code === 'slot_unavailable' || code === 'too_late') return 409;
  return 400;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : null;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

server.listen(port, () => {
  console.log(`booking: http://localhost:${port}`);
});
