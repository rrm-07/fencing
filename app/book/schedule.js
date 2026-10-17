// The weekly training timetable. Edit this file to change sessions; every
// session is identified by its weekday + id, so keep ids stable once people
// have booked.

export const CLUB = {
  title: 'Training',
  subtitle: 'Book your place',
  timeZone: 'Europe/London',
};

/** Places per session. Bookings beyond this go on the waitlist. */
export const CAPACITY = 30;

/** How far ahead people can book. */
export const WEEKS_AHEAD = 2;

export const VENUES = {
  clfc: {
    name: 'Central London FC',
    short: 'Central London FC',
    color: 'orange',
    badge: 'Offsite',
    note: 'Offsite · bring your own kit',
  },
  mandela: {
    name: 'Mandela Studio, TeamUCL Gym',
    short: 'Mandela Studio',
    color: 'blue',
  },
};

// day: 0 = Sunday … 6 = Saturday. Times are UK local time (24h).
export const SCHEDULE = [
  { id: 'mon-clfc', day: 1, venue: 'clfc', start: '19:00', end: '21:00' },
  { id: 'wed-mandela', day: 3, venue: 'mandela', start: '11:30', end: '13:30' },
  { id: 'wed-clfc', day: 3, venue: 'clfc', start: '19:00', end: '21:00' },
  { id: 'thu-mandela', day: 4, venue: 'mandela', start: '15:00', end: '17:00' },
  { id: 'sat-mandela', day: 6, venue: 'mandela', start: '10:00', end: '13:00' },
];
